// AI topic filter. AIShorts only publishes AI news, but ingest pulls whatever a
// source feed contains — so a broad feed (e.g. general "BBC Tech") would drip
// non-AI stories into the pipeline. This gate keeps only AI-related items.
//
// Two layers use it:
//   1. ingest() runs isAiRelated() on each item's title + teaser and simply
//      doesn't store non-AI items. Doing it here (not at summarize time) is
//      important: summarizePending() takes the freshest N raw items BEFORE
//      relevance is known, so unfiltered noise would crowd out real AI news.
//   2. the LLM summarize path double-checks with the model on the fuller article
//      text, catching keyword false positives (e.g. a phone review that merely
//      mentions "AI features").
//
// Set AI_TOPIC_FILTER=off to disable filtering entirely (ingest everything).

// Curated AI vocabulary. ANY match marks the text AI-related. Kept deliberately
// broad — company and product names, not just "artificial intelligence" — so
// genuine stories that never spell out "AI" (an OpenAI or Claude story, an arXiv
// paper whose abstract mentions "neural network") still pass. Terms too generic
// on their own (model, agent, training, GPU, inference, transformer) are left
// out to avoid false positives from ordinary tech/business news.
const AI_TERMS: string[] = [
  // Core concepts
  'artificial intelligence',
  'artificial general intelligence',
  '\\bA\\.?I\\.?\\b', // "AI", "A.I." (word-bounded; won't match air/aid/bai)
  '\\bAGI\\b',
  'machine learning',
  'deep learning',
  'reinforcement learning',
  'neural network',
  'large language model',
  '\\bLLMs?\\b',
  'foundation model',
  'generative a\\.?i',
  'gen\\s?ai', // "gen ai", "genai"
  'diffusion model',
  'computer vision',
  'natural language processing',
  '\\bNLP\\b',
  'multimodal',
  'fine[-\\s]?tun', // fine-tune / fine-tuning
  'prompt engineering',
  'retrieval[-\\s]?augmented',
  'chatbot',
  'conversational a\\.?i',
  'ai agent',
  'agentic',
  'superintelligence',
  'hallucinat', // AI hallucinations
  'word embeddings',
  'text embeddings',
  // Models / products
  '\\bGPT\\b',
  'gpt-?\\d',
  'chatgpt',
  '\\bclaude\\b',
  'dall-?e',
  'midjourney',
  'stable diffusion',
  '\\bsora\\b',
  '\\bgemini\\b',
  '\\bllama\\b',
  '\\bmistral\\b',
  'copilot',
  '\\bgrok\\b',
  'deepseek',
  '\\bqwen\\b',
  // AI-first companies / labs
  'openai',
  'anthropic',
  'deepmind',
  'hugging\\s?face',
  '\\bcohere\\b',
  'perplexity a\\.?i',
  'stability a\\.?i',
  'scale a\\.?i',
];

const AI_REGEX = new RegExp(AI_TERMS.join('|'), 'i');

/** Whether the AI topic filter is active (AI_TOPIC_FILTER=off disables it). */
export function relevanceFilterEnabled(): boolean {
  return (process.env.AI_TOPIC_FILTER ?? 'on').toLowerCase() !== 'off';
}

/**
 * True if the text looks AI-related (or filtering is disabled). Match against an
 * article's title + teaser/body — the more text, the fewer false negatives.
 */
export function isAiRelated(text: string): boolean {
  if (!relevanceFilterEnabled()) return true;
  return AI_REGEX.test(text);
}
