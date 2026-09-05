import {
  prisma,
  Prisma,
  CATEGORIES,
  cardDraftSchema,
  computeRankScore,
  RANK_DEFAULT,
  type CardDraft,
  type CategoryName,
} from '@aishorts/shared';
import { chatJson, activeProvider, activeModel, llmAvailable } from './llm';
import { extractArticle } from './articles';
import { resolveCardImage } from './media';

// The category set is built per-run from the live DB list (see summarizePending),
// so newly-added admin categories are offered to the model too.
function systemPrompt(categories: string[]): string {
  return `You are the editor for "AIShorts", a daily app that explains the AI world in tiny, swipeable cards (Inshorts-style).
For each article you are given, write ONE card. Rules:
- "title": a catchy, appealing headline that makes someone want to tap — specific and vivid, not clickbait, no trailing punctuation. <= 70 characters. This same title is reused as a push-notification headline, so it must stand alone.
- "summary": MUST be 50-65 words — about 3 to 4 full sentences. A one- or two-sentence summary is WRONG and will be rejected. Use the article excerpt to cover what happened, who is involved, and the most important detail or number. Plain, engaging, factual, in your own words — never copy sentences, never invent facts not in the excerpt, no "click here"/"read more".
- "whyItMatters": one short sentence on why a reader should care.
- "category": exactly one of: ${categories.join(', ')}.
- "tags": up to 5 short lowercase topic tags.
- "importance": an integer 1-5 judging how much this story matters to the world. 1 = a top, world-shaping story (a major model launch, a landmark regulation or lawsuit, a huge acquisition, a safety incident). 3 = normal, noteworthy news. 5 = minor, niche, or incremental. Be discerning: most stories are 3; reserve 1-2 for genuinely big news.
- "aiRelated": boolean. true ONLY if the article is primarily about artificial intelligence / machine learning (AI models, tools, research, companies, policy, or how-tos). Set it false for general tech, business, or other news that merely mentions AI in passing — these are dropped and never shown.

Example of the REQUIRED summary length (61 words):
"OpenAI has released GPT-5, its most capable model yet, claiming sharp gains in reasoning, coding, and multimodal understanding. The company says the model cuts hallucinations by half and can handle far longer documents in a single pass. GPT-5 is rolling out to paid ChatGPT users first, with API access to follow. Rivals Google and Anthropic are expected to respond quickly."

Respond with ONLY a JSON object with keys: title, summary, whyItMatters, category, tags, importance, aiRelated. No markdown, no prose around it.`;
}

// Active category names from the DB, falling back to the seed list if the table
// is empty/unreadable. Read once per run and threaded through so we don't hit the
// DB per item.
async function activeCategoryNames(): Promise<string[]> {
  try {
    const rows = await prisma.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true },
    });
    if (rows.length) return rows.map((r) => r.name);
  } catch {
    /* table may not exist yet — fall back */
  }
  return [...CATEGORIES];
}

// Guarantee the ~60-word promise: if the model overshoots, keep whole
// sentences up to ~62 words (hard-cut as a last resort).
export function trimSummary(s: string, max = 62): string {
  const clean = s.trim().replace(/\s+/g, ' ');
  if (clean.split(' ').length <= max) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  let out = '';
  for (const sent of sentences) {
    const candidate = (out ? `${out} ${sent.trim()}` : sent.trim()).trim();
    if (candidate.split(' ').length > max) break;
    out = candidate;
  }
  if (!out) out = `${clean.split(' ').slice(0, max).join(' ')}…`;
  return out;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model output');
  return JSON.parse(raw.slice(start, end + 1));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Belt-and-suspenders cap on a single article's processing. Individual network
// calls have their own timeouts, but this guarantees that no combination of a
// slow fetch, LLM retry, and image download can ever freeze the whole run — the
// item is skipped and the loop moves on.
const ITEM_TIMEOUT_MS = Number(process.env.ITEM_TIMEOUT_MS ?? 90000);
// How long to wait on the LLM for one item before giving up and using the
// extractive fallback. Shorter than ITEM_TIMEOUT_MS so a Groq stall degrades to
// an editable draft quickly instead of burning the whole per-item budget.
const LLM_ITEM_BUDGET_MS = Number(process.env.LLM_ITEM_BUDGET_MS ?? 40000);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

async function draftFor(
  title: string,
  body: string,
  sourceName: string,
  categories: string[],
): Promise<{ draft: CardDraft; aiRelated: boolean }> {
  // Enough context for a real summary, but bounded for the free-tier TPM cap.
  const excerpt = body.slice(0, 2500);
  const prompt = `Source: ${sourceName}\nHeadline: ${title}\n\nArticle excerpt:\n${excerpt || '(no excerpt available — summarize from the headline only, do not invent specifics)'}`;
  const text = await chatJson(systemPrompt(categories), prompt);
  const obj = extractJson(text) as Record<string, unknown>;
  // Model's AI-relevance verdict on the fuller article text. Fail open (default
  // true) so a missing/garbled flag never silently drops a real card — only an
  // explicit false filters the item out.
  const aiRelated = obj.aiRelated !== false;
  // Keep any valid category the model returns (including admin-added ones). If it
  // invents something outside the live set, remap to the closest known bucket
  // from the title/summary rather than failing the parse.
  const allowed = new Set(categories.map((c) => c.toLowerCase()));
  if (typeof obj.category !== 'string' || !allowed.has((obj.category as string).toLowerCase())) {
    obj.category = guessCategory(`${obj.title ?? title} ${obj.summary ?? ''}`);
  }
  // Coerce/clamp the model's importance to a valid 1-5 int (default 3) so an
  // out-of-range or missing value doesn't fail the whole parse.
  obj.importance = clampImportance(obj.importance);
  // cardDraftSchema validates shape and trims to limits.
  const draft = cardDraftSchema.parse(obj);
  draft.summary = trimSummary(draft.summary);
  return { draft, aiRelated };
}

// ---- No-LLM extractive fallback --------------------------------------------
// When no LLM key is configured, we still want "Fetch new articles" to produce
// reviewable cards instead of skipping everything. These build a card from the
// article's own title + body (no AI): lower quality, clearly a draft for the
// admin to edit before publishing, but the flow never silently produces nothing.

// Decode the handful of HTML entities RSS titles/teasers commonly carry, so the
// extractive path (which reuses the raw text) reads cleanly. The LLM path never
// needs this because it rewrites everything in its own words.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”',
};
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

// Keep the title within the schema's 80-char limit, on a word boundary.
function clampTitle(t: string): string {
  const s = t.trim().replace(/\s+/g, ' ');
  if (s.length <= 80) return s;
  return `${s.slice(0, 77).replace(/\s+\S*$/, '')}…`;
}

// First-match wins, so order from most specific to most general. Defaults to
// "Models" — the most common bucket for an AI-news feed.
const CATEGORY_KEYWORDS: Array<[CategoryName, RegExp]> = [
  ['How-to', /\b(how to|guide|tutorial|step[- ]by[- ]step|walkthrough|tips)\b/i],
  ['Policy', /\b(regulat|policy|\blaw\b|lawsuit|court|\bban\b|privacy|copyright|\bact\b|government|antitrust|compliance)\b/i],
  ['Business', /\b(funding|raise[sd]?|valuation|revenue|acqui|\bipo\b|billion|million|startup|invest|market|\bdeal\b|earnings)\b/i],
  ['Research', /\b(research|paper|study|arxiv|benchmark|dataset|findings?|breakthrough)\b/i],
  ['Tools', /\b(tool|\bapp\b|plugin|\bapi\b|\bsdk\b|integration|feature|extension|assistant)\b/i],
  ['Models', /\b(model|\bgpt\b|\bllm\b|llama|gemini|claude|mistral|parameters?|training|fine[- ]tun|multimodal)\b/i],
];

function guessCategory(text: string): CategoryName {
  for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(text)) return cat;
  return 'Models';
}

// Coerce an arbitrary model value to a valid 1-5 importance, defaulting to the
// neutral middle when missing or nonsensical.
function clampImportance(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return RANK_DEFAULT;
  return Math.min(5, Math.max(1, Math.round(n)));
}

// Signals that a story is big (importance 2) vs merely incremental (importance 4).
// Used only by the no-LLM extractive path; the LLM judges importance directly.
const HIGH_IMPORTANCE = /\b(launch|unveil|announce|acqui|lawsuit|\bsue[sd]?\b|\bban\b|regulat|billion|breakthrough|first ever|major|landmark|record)\b/i;
const LOW_IMPORTANCE = /\b(minor|patch|hotfix|small|tips|roundup|weekly|rumou?r|reportedly|might|could|beta|preview)\b/i;

// Rough importance guess for the extractive fallback (no AI). Defaults to the
// neutral middle; nudges up/down on a few strong keyword signals.
function guessImportance(text: string): number {
  if (HIGH_IMPORTANCE.test(text)) return 2;
  if (LOW_IMPORTANCE.test(text)) return 4;
  return RANK_DEFAULT;
}

const TAG_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'your', 'this', 'that', 'says',
  'new', 'how', 'why', 'will', 'can', 'are', 'has', 'have', 'its', 'their',
  'over', 'after', 'amid', 'about', 'more', 'than', 'what', 'when', 'they',
]);

// A few lowercase topic tags pulled from the headline — no AI needed.
function extractTags(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !TAG_STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 4);
}

// Strip leading news-page chrome that extractors leave in front of the real
// article body: read-time badges, datelines with an "Updated/Published"
// timestamp, and photo captions/credits. These are never part of the story and
// look wrong in a card. Deliberately conservative — anchored to the start
// (read-time/dateline) and keyword-gated (credits need a slash or an agency
// name) so ordinary sentences and parentheticals are left untouched.
export function stripBoilerplate(s: string): string {
  let t = s;
  // "3 min read" badge at the very start.
  t = t.replace(/^\s*\d+\s*min read\b[\s:.,–—-]*/i, '');
  // Dateline + update/publish stamp, e.g. "New Delhi Updated: Aug 29, 2026 09:01 AM IST".
  t = t.replace(
    /^\s*[A-Z][A-Za-z.\s]{0,30}?\b(?:Updated|Published)\b.*?\b(?:IST|GMT|UTC|EDT|EST|PDT|PST|AM|PM)\b[\s:.,–—-]*/i,
    '',
  );
  // Bare leading "Updated: … IST" with no place prefix.
  t = t.replace(
    /^\s*(?:Updated|Published)\b.*?\b(?:IST|GMT|UTC|EDT|EST|PDT|PST|AM|PM)\b[\s:.,–—-]*/i,
    '',
  );
  // Photo caption/credit parenthetical — only when it looks like a credit.
  t = t.replace(
    /\((?:[^()]*(?:\/|Getty|Reuters|\bAP\b|AFP|Bloomberg|Photo|Image|via|New York Times)[^()]*)\)/gi,
    '',
  );
  return t.replace(/\s+/g, ' ').trim();
}

// Strip site chrome that leaks into scraped article text, and drop repeated
// sentences (extractors often duplicate a pull-quote and its caption).
function cleanBody(s: string): string {
  let t = stripBoilerplate(s.replace(/\s+/g, ' ').trim());
  t = t.replace(/^(skip to (main )?content\b[\s:–—-]*)/i, '').trim();
  const parts = t.match(/[^.!?]+[.!?]+/g);
  if (!parts) return t;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.trim().toLowerCase();
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(p.trim());
  }
  return out.join(' ');
}

// Build a valid CardDraft with zero LLM calls.
function draftExtractive(rawTitle: string, rawBody: string): CardDraft {
  const title = decodeEntities(rawTitle).replace(/\s+/g, ' ').trim();
  const clean = cleanBody(decodeEntities(rawBody || ''));
  const category = guessCategory(`${title} ${clean}`);
  const draft = {
    title: clampTitle(title),
    // Whole leading sentences up to ~60 words; fall back to the title itself.
    summary: trimSummary(clean || title, 60),
    whyItMatters: '',
    category,
    tags: extractTags(title),
    importance: guessImportance(`${title} ${clean}`),
  };
  // Validate against the same schema the LLM path uses.
  return cardDraftSchema.parse(draft);
}

// AIShorts is a DAILY news app, so we only ever draft cards for recent articles.
// This matters more than it looks: the first ingest of a blog pulls its whole
// archive, and processing oldest-first meant that backlog was summarized ahead of
// today's news indefinitely. Stale items stay in raw_items (nothing is deleted) —
// they simply stop being eligible. Raise this to mine the archive on purpose.
const MAX_ARTICLE_AGE_DAYS = Number(process.env.MAX_ARTICLE_AGE_DAYS ?? 30);

export async function summarizePending(
  limit = 25,
  onProgress?: (message: string) => void,
): Promise<{ created: number; skipped: number; filtered: number }> {
  const cutoff = new Date(Date.now() - MAX_ARTICLE_AGE_DAYS * 86_400_000);
  const eligible: Prisma.RawItemWhereInput = {
    processedAt: null,
    card: { is: null },
    OR: [
      { publishedAt: { gte: cutoff } },
      // Feeds that omit a date: fall back to when we fetched it.
      { publishedAt: null, fetchedAt: { gte: cutoff } },
    ],
  };

  // Freshest article first — the newest news becomes a card first.
  const items = await prisma.rawItem.findMany({
    where: eligible,
    orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { fetchedAt: 'desc' }],
    take: limit,
    // Source priority feeds each card's blended rankScore.
    include: { source: { select: { priority: true } } },
  });

  const staleBacklog = await prisma.rawItem.count({
    where: { processedAt: null, card: { is: null }, NOT: eligible },
  });

  const categories = await activeCategoryNames();
  const useLlm = llmAvailable();
  console.log(
    useLlm
      ? `Using ${activeProvider()} model "${activeModel()}" (${items.length} items queued)`
      : `No LLM key set — using extractive fallback for ${items.length} item(s). ` +
          `Set GROQ_API_KEY in .env for AI-written summaries.`,
  );
  if (staleBacklog) {
    console.log(
      `  (skipping ${staleBacklog} article(s) older than ${MAX_ARTICLE_AGE_DAYS} days — raise MAX_ARTICLE_AGE_DAYS to include them)`,
    );
  }
  let created = 0;
  let skipped = 0;
  let filtered = 0; // items the LLM judged not AI-related (no card created)

  for (const [i, item] of items.entries()) {
    // Live progress so the admin panel doesn't look frozen during a long run.
    onProgress?.(`Summarizing ${i + 1} of ${items.length}: ${item.title.slice(0, 60)}…`);
    try {
      // All network work for this item, capped so a stall can't freeze the run.
      const { draft, image, aiRelated } = await withTimeout(
        (async () => {
          let draft: CardDraft;
          // Whether this item is AI-related. The LLM sets it from the fuller
          // article text (default true = keep); the extractive path can't judge,
          // so it trusts the ingest-time keyword gate and leaves it true.
          let aiRelated = true;
          // Lead image scraped from the article page (og:image). Only captured on
          // the LLM path (which already fetches the page); the enclosure covers
          // the extractive path without an extra request.
          let ogImage: string | null = null;
          if (useLlm) {
            try {
              // The LLM rewrites everything, so give it the fullest text we can get.
              const article = await extractArticle(item.sourceUrl, item.rawText ?? '');
              ogImage = article.imageUrl;
              const result = await withTimeout(
                draftFor(item.title, article.text, item.sourceName, categories),
                LLM_ITEM_BUDGET_MS,
                'LLM summarize',
              );
              draft = result.draft;
              aiRelated = result.aiRelated;
            } catch (llmErr) {
              // The LLM stalled or errored for this item (e.g. Groq unreachable /
              // rate-limited). Don't drop the article — build an extractive draft
              // from its own text so the admin still gets an editable card.
              console.warn(
                `  ~ LLM failed for "${item.title.slice(0, 50)}" (${(llmErr as Error).message}); using extractive fallback`,
              );
              const teaser = (item.rawText ?? '').trim();
              if (teaser.length >= 120) {
                draft = draftExtractive(item.title, teaser);
              } else {
                const article = await extractArticle(item.sourceUrl, teaser);
                ogImage = article.imageUrl;
                draft = draftExtractive(item.title, article.text);
              }
            }
          } else {
            // Extractive: the RSS teaser is cleaner than a scraped page (no nav
            // chrome / duplicated captions). Only scrape when the feed gave us
            // little to work with.
            const teaser = (item.rawText ?? '').trim();
            if (teaser.length >= 120) {
              draft = draftExtractive(item.title, teaser);
            } else {
              const article = await extractArticle(item.sourceUrl, teaser);
              ogImage = article.imageUrl;
              draft = draftExtractive(item.title, article.text);
            }
          }
          // Self-host the image in the DB: source image (enclosure/og:image) →
          // sample library tile → blue panel (null). See media.ts.
          // Skip image work for items we're about to drop as non-AI.
          if (!aiRelated) return { draft, image: null, aiRelated };
          const image = await resolveCardImage({
            category: draft.category,
            tags: draft.tags,
            sourceUrls: [item.imageUrl, ogImage],
            seed: draft.title,
          });
          return { draft, image, aiRelated };
        })(),
        ITEM_TIMEOUT_MS,
        `item "${item.title.slice(0, 40)}"`,
      );

      // LLM judged the fuller article not actually about AI (a keyword false
      // positive that slipped the ingest gate). Mark it processed so it isn't
      // retried, but create no card.
      if (!aiRelated || !image) {
        await prisma.rawItem.update({
          where: { id: item.id },
          data: { processedAt: new Date() },
        });
        filtered++;
        console.log(`  – filtered (not AI): ${item.title.slice(0, 60)}`);
        if (useLlm) await sleep(1500);
        continue;
      }
      const sourcePriority = item.source?.priority ?? RANK_DEFAULT;
      const articleDate = item.publishedAt ?? null;
      await prisma.card.create({
        data: {
          type: 'news',
          title: draft.title,
          summary: draft.summary,
          whyItMatters: draft.whyItMatters || null,
          category: draft.category,
          tags: draft.tags,
          imageAssetId: image.imageAssetId,
          imageUrl: image.imageUrl,
          sourceName: item.sourceName,
          sourceUrl: item.sourceUrl,
          status: 'pending',
          rawItemId: item.id,
          importance: draft.importance,
          articlePublishedAt: articleDate,
          rankScore: computeRankScore({
            importance: draft.importance,
            sourcePriority,
            articleDate,
          }),
        },
      });
      await prisma.rawItem.update({ where: { id: item.id }, data: { processedAt: new Date() } });
      created++;
      console.log(`  + ${draft.category}: ${draft.title}`);
    } catch (err) {
      skipped++;
      console.warn(`  ! skipped "${item.title.slice(0, 60)}": ${(err as Error).message}`);
    }
    if (useLlm) await sleep(1500); // smooth out tokens-per-minute usage on the free tier
  }

  console.log(
    `Summarize: ${created} draft cards created, ${skipped} skipped` +
      (filtered ? `, ${filtered} filtered out (not AI-related).` : '.'),
  );
  return { created, skipped, filtered };
}

if (require.main === module) {
  summarizePending()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
