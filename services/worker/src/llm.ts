import Anthropic from '@anthropic-ai/sdk';

// Provider-agnostic summarization backend. Default = Groq (free tier).
// Switch with LLM_PROVIDER=groq|anthropic in .env.
export type LlmProvider = 'groq' | 'anthropic';

export function activeProvider(): LlmProvider {
  return (process.env.LLM_PROVIDER as LlmProvider) || 'groq';
}

export function activeModel(): string {
  if (activeProvider() === 'anthropic') return process.env.CLAUDE_MODEL_BULK || 'claude-haiku-4-5';
  return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
}

// Is a real LLM usable right now? True only when the active provider has its key.
// When false, the worker uses an extractive (no-AI) fallback instead of throwing,
// so "Fetch new articles" always produces reviewable cards.
export function llmAvailable(): boolean {
  return activeProvider() === 'anthropic'
    ? !!process.env.ANTHROPIC_API_KEY
    : !!process.env.GROQ_API_KEY;
}

// Send a system + user prompt and return the model's reply text.
// Both providers are asked for a single JSON object (the caller parses it).
export async function chatJson(system: string, user: string): Promise<string> {
  return activeProvider() === 'anthropic' ? anthropic(system, user) : groq(system, user);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Groq — OpenAI-compatible Chat Completions with JSON mode.
// Retries on 429 (free-tier tokens-per-minute limit) and transient 5xx.
async function groq(system: string, user: string): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set — add it to .env');
  const backoffs = [1500, 4000, 8000, 15000, 25000];
  // Per-request cap: a stalled connection must not hang the whole pipeline.
  const REQUEST_TIMEOUT_MS = 30000;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: activeModel(),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4,
          max_tokens: 700,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // A timeout/network drop is transient — retry with backoff like a 5xx.
      if (attempt < backoffs.length) {
        await sleep(backoffs[attempt]);
        continue;
      }
      throw new Error(`Groq request failed: ${(err as Error).message}`);
    }
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? '';
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < backoffs.length) {
      const hdr = Number(res.headers.get('retry-after')) * 1000;
      await sleep(Number.isFinite(hdr) && hdr > 0 ? hdr : backoffs[attempt]);
      continue;
    }
    throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// Anthropic (optional fallback) — requires account credits.
let _anthropic: Anthropic | null = null;
async function anthropic(system: string, user: string): Promise<string> {
  _anthropic ??= new Anthropic();
  const res = await _anthropic.messages.create({
    model: activeModel(),
    max_tokens: 700,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}
