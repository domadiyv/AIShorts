import { prisma, Prisma, CATEGORIES, DIFFICULTIES, cardDraftSchema, type CardDraft, type Category } from '@aishorts/shared';
import { chatJson, activeProvider, activeModel, llmAvailable } from './llm';
import { getArticleText } from './articles';
import { resolveCardImage } from './media';

const SYSTEM = `You are the editor for "AIShorts", a daily app that explains the AI world in tiny, swipeable cards (Inshorts-style).
For each article you are given, write ONE card. Rules:
- "summary": MUST be 50-65 words — about 3 to 4 full sentences. A one- or two-sentence summary is WRONG and will be rejected. Use the article excerpt to cover what happened, who is involved, and the most important detail or number. Plain, engaging, factual, in your own words — never copy sentences, never invent facts not in the excerpt, no "click here"/"read more".
- "title": punchy, <= 70 characters.
- "whyItMatters": one short sentence on why a reader should care.
- "category": exactly one of: ${CATEGORIES.join(', ')}.
- "difficulty": "beginner" (anyone), "intermediate" (follows AI casually), or "advanced" (practitioner/technical).
- "tags": up to 5 short lowercase topic tags.

Example of the REQUIRED summary length (61 words):
"OpenAI has released GPT-5, its most capable model yet, claiming sharp gains in reasoning, coding, and multimodal understanding. The company says the model cuts hallucinations by half and can handle far longer documents in a single pass. GPT-5 is rolling out to paid ChatGPT users first, with API access to follow. Rivals Google and Anthropic are expected to respond quickly."

Respond with ONLY a JSON object with keys: title, summary, whyItMatters, category, difficulty, tags. No markdown, no prose around it.`;

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

async function draftFor(title: string, body: string, sourceName: string): Promise<CardDraft> {
  // Enough context for a real summary, but bounded for the free-tier TPM cap.
  const excerpt = body.slice(0, 2500);
  const prompt = `Source: ${sourceName}\nHeadline: ${title}\n\nArticle excerpt:\n${excerpt || '(no excerpt available — summarize from the headline only, do not invent specifics)'}`;
  const text = await chatJson(SYSTEM, prompt);
  const obj = extractJson(text) as Record<string, unknown>;
  // The model occasionally invents a category outside our fixed set (e.g.
  // "Security"). Don't drop an otherwise-good card over it — remap to the
  // closest valid bucket from the title/summary instead of failing the parse.
  if (typeof obj.category !== 'string' || !CATEGORIES.includes(obj.category as Category)) {
    obj.category = guessCategory(`${obj.title ?? title} ${obj.summary ?? ''}`);
  }
  // cardDraftSchema enforces category/difficulty enums and trims to limits.
  const draft = cardDraftSchema.parse(obj);
  draft.summary = trimSummary(draft.summary);
  return draft;
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
const CATEGORY_KEYWORDS: Array<[Category, RegExp]> = [
  ['How-to', /\b(how to|guide|tutorial|step[- ]by[- ]step|walkthrough|tips)\b/i],
  ['Policy', /\b(regulat|policy|\blaw\b|lawsuit|court|\bban\b|privacy|copyright|\bact\b|government|antitrust|compliance)\b/i],
  ['Business', /\b(funding|raise[sd]?|valuation|revenue|acqui|\bipo\b|billion|million|startup|invest|market|\bdeal\b|earnings)\b/i],
  ['Research', /\b(research|paper|study|arxiv|benchmark|dataset|findings?|breakthrough)\b/i],
  ['Tools', /\b(tool|\bapp\b|plugin|\bapi\b|\bsdk\b|integration|feature|extension|assistant)\b/i],
  ['Models', /\b(model|\bgpt\b|\bllm\b|llama|gemini|claude|mistral|parameters?|training|fine[- ]tun|multimodal)\b/i],
];

function guessCategory(text: string): Category {
  for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(text)) return cat;
  return 'Models';
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

// Strip site chrome that leaks into scraped article text, and drop repeated
// sentences (extractors often duplicate a pull-quote and its caption).
function cleanBody(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
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
    difficulty: 'intermediate' as const,
    tags: extractTags(title),
  };
  // Validate against the same schema the LLM path uses.
  return cardDraftSchema.parse(draft);
}

// AIShorts is a DAILY news app, so we only ever draft cards for recent articles.
// This matters more than it looks: the first ingest of a blog pulls its whole
// archive, and processing oldest-first meant that backlog was summarized ahead of
// today's news indefinitely. Stale items stay in raw_items (nothing is deleted) —
// they simply stop being eligible. Raise this to mine the archive on purpose.
const MAX_ARTICLE_AGE_DAYS = Number(process.env.MAX_ARTICLE_AGE_DAYS ?? 21);

export async function summarizePending(
  limit = 25,
  onProgress?: (message: string) => void,
): Promise<{ created: number; skipped: number }> {
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
  });

  const staleBacklog = await prisma.rawItem.count({
    where: { processedAt: null, card: { is: null }, NOT: eligible },
  });

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

  for (const [i, item] of items.entries()) {
    // Live progress so the admin panel doesn't look frozen during a long run.
    onProgress?.(`Summarizing ${i + 1} of ${items.length}: ${item.title.slice(0, 60)}…`);
    try {
      // All network work for this item, capped so a stall can't freeze the run.
      const { draft, imageUrl } = await withTimeout(
        (async () => {
          let draft: CardDraft;
          if (useLlm) {
            try {
              // The LLM rewrites everything, so give it the fullest text we can get.
              const body = await getArticleText(item.sourceUrl, item.rawText ?? '');
              draft = await withTimeout(
                draftFor(item.title, body, item.sourceName),
                LLM_ITEM_BUDGET_MS,
                'LLM summarize',
              );
            } catch (llmErr) {
              // The LLM stalled or errored for this item (e.g. Groq unreachable /
              // rate-limited). Don't drop the article — build an extractive draft
              // from its own text so the admin still gets an editable card.
              console.warn(
                `  ~ LLM failed for "${item.title.slice(0, 50)}" (${(llmErr as Error).message}); using extractive fallback`,
              );
              const teaser = (item.rawText ?? '').trim();
              const body =
                teaser.length >= 120 ? teaser : await getArticleText(item.sourceUrl, teaser);
              draft = draftExtractive(item.title, body);
            }
          } else {
            // Extractive: the RSS teaser is cleaner than a scraped page (no nav
            // chrome / duplicated captions). Only scrape when the feed gave us
            // little to work with.
            const teaser = (item.rawText ?? '').trim();
            const body =
              teaser.length >= 120 ? teaser : await getArticleText(item.sourceUrl, teaser);
            draft = draftExtractive(item.title, body);
          }
          // Self-host a license-clear image: Pexels → RSS enclosure → placeholder.
          const imageUrl = await resolveCardImage({
            title: draft.title,
            category: draft.category,
            tags: draft.tags,
            existing: item.imageUrl,
          });
          return { draft, imageUrl };
        })(),
        ITEM_TIMEOUT_MS,
        `item "${item.title.slice(0, 40)}"`,
      );
      await prisma.card.create({
        data: {
          type: 'news',
          title: draft.title,
          summary: draft.summary,
          whyItMatters: draft.whyItMatters || null,
          category: draft.category,
          difficulty: draft.difficulty,
          tags: draft.tags,
          imageUrl,
          sourceName: item.sourceName,
          sourceUrl: item.sourceUrl,
          status: 'pending',
          rawItemId: item.id,
        },
      });
      await prisma.rawItem.update({ where: { id: item.id }, data: { processedAt: new Date() } });
      created++;
      console.log(`  + ${draft.difficulty}/${draft.category}: ${draft.title}`);
    } catch (err) {
      skipped++;
      console.warn(`  ! skipped "${item.title.slice(0, 60)}": ${(err as Error).message}`);
    }
    if (useLlm) await sleep(1500); // smooth out tokens-per-minute usage on the free tier
  }

  console.log(`Summarize: ${created} draft cards created, ${skipped} skipped.`);
  return { created, skipped };
}

if (require.main === module) {
  summarizePending()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
