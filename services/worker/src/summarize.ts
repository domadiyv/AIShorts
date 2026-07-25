import { prisma, Prisma, CATEGORIES, DIFFICULTIES, cardDraftSchema, type CardDraft } from '@aishorts/shared';
import { chatJson, activeProvider, activeModel } from './llm';
import { getArticleText } from './articles';

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

async function draftFor(title: string, body: string, sourceName: string): Promise<CardDraft> {
  // Enough context for a real summary, but bounded for the free-tier TPM cap.
  const excerpt = body.slice(0, 2500);
  const prompt = `Source: ${sourceName}\nHeadline: ${title}\n\nArticle excerpt:\n${excerpt || '(no excerpt available — summarize from the headline only, do not invent specifics)'}`;
  const text = await chatJson(SYSTEM, prompt);
  // cardDraftSchema enforces category/difficulty enums and trims to limits.
  const draft = cardDraftSchema.parse(extractJson(text));
  draft.summary = trimSummary(draft.summary);
  return draft;
}

// AIShorts is a DAILY news app, so we only ever draft cards for recent articles.
// This matters more than it looks: the first ingest of a blog pulls its whole
// archive, and processing oldest-first meant that backlog was summarized ahead of
// today's news indefinitely. Stale items stay in raw_items (nothing is deleted) —
// they simply stop being eligible. Raise this to mine the archive on purpose.
const MAX_ARTICLE_AGE_DAYS = Number(process.env.MAX_ARTICLE_AGE_DAYS ?? 21);

export async function summarizePending(limit = 25): Promise<{ created: number; skipped: number }> {
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

  console.log(`Using ${activeProvider()} model "${activeModel()}" (${items.length} items queued)`);
  if (staleBacklog) {
    console.log(
      `  (skipping ${staleBacklog} article(s) older than ${MAX_ARTICLE_AGE_DAYS} days — raise MAX_ARTICLE_AGE_DAYS to include them)`,
    );
  }
  let created = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      const body = await getArticleText(item.sourceUrl, item.rawText ?? '');
      const draft = await draftFor(item.title, body, item.sourceName);
      await prisma.card.create({
        data: {
          type: 'news',
          title: draft.title,
          summary: draft.summary,
          whyItMatters: draft.whyItMatters || null,
          category: draft.category,
          difficulty: draft.difficulty,
          tags: draft.tags,
          imageUrl: item.imageUrl,
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
    await sleep(1500); // smooth out tokens-per-minute usage on the free tier
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
