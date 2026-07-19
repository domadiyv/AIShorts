// Local demo seed: ~24 published AIShorts cards across all categories/difficulties.
// Run from repo root:  npx dotenv -e .env -- npx tsx packages/shared/prisma/seed.ts
import { PrismaClient, type CardType, type Difficulty } from '@prisma/client';

const prisma = new PrismaClient();

type Seed = {
  type?: CardType;
  title: string;
  summary: string;
  whyItMatters?: string;
  category: string;
  difficulty: Difficulty;
  tags: string[];
  sourceName: string;
  sourceUrl: string;
  imageSeed: string;
};

const cards: Seed[] = [
  {
    title: 'OpenAI ships GPT-5.5 with native long-horizon planning',
    summary:
      'OpenAI released GPT-5.5, adding a built-in planner that breaks multi-step goals into sub-tasks and self-checks results before answering. Early testers report sharp gains on coding and agentic benchmarks, with fewer hallucinated tool calls. Pricing holds steady with the prior tier.',
    whyItMatters: 'Planning that used to need external agent frameworks now ships in the base model.',
    category: 'Models',
    difficulty: 'intermediate',
    tags: ['openai', 'gpt-5.5', 'agents'],
    sourceName: 'OpenAI Blog',
    sourceUrl: 'https://openai.com/blog',
    imageSeed: 'gpt55',
  },
  {
    title: 'Anthropic’s Claude adds week-long project memory',
    summary:
      'Anthropic rolled out persistent project memory for Claude, letting it retain context, files and decisions across a week of sessions. Users can inspect and edit what it remembers. The feature is opt-in and scoped per project to limit accidental data bleed between workspaces.',
    whyItMatters: 'Persistent memory turns one-off chats into ongoing collaborators that recall your codebase.',
    category: 'Models',
    difficulty: 'beginner',
    tags: ['anthropic', 'claude', 'memory'],
    sourceName: 'Anthropic News',
    sourceUrl: 'https://www.anthropic.com/news',
    imageSeed: 'claudemem',
  },
  {
    title: 'Meta open-sources Llama 4 with a 10M-token context',
    summary:
      'Meta released Llama 4 under a permissive license, headlined by a 10 million token context window and a mixture-of-experts design that keeps inference cheap. Weights for the 17B and 400B variants are on Hugging Face, reigniting the open-versus-closed debate.',
    whyItMatters: 'A frontier-class open model at this context length pressures closed-model pricing.',
    category: 'Models',
    difficulty: 'intermediate',
    tags: ['meta', 'llama', 'open-source'],
    sourceName: 'Meta AI',
    sourceUrl: 'https://ai.meta.com/blog',
    imageSeed: 'llama4',
  },
  {
    title: 'Google DeepMind’s Gemini 3 tops multimodal reasoning charts',
    summary:
      'Gemini 3 posted state-of-the-art scores on video, audio and document reasoning tasks, and can now watch an hour-long clip and answer timestamped questions. DeepMind credits a redesigned vision encoder and longer pretraining on synthetic reasoning traces.',
    whyItMatters: 'Strong native video understanding unlocks assistants that reason over recordings, not just text.',
    category: 'Models',
    difficulty: 'advanced',
    tags: ['google', 'gemini', 'multimodal'],
    sourceName: 'DeepMind',
    sourceUrl: 'https://deepmind.google/discover/blog',
    imageSeed: 'gemini3',
  },
  {
    title: 'Cursor 2.0 lets a fleet of agents refactor whole repos',
    summary:
      'The Cursor editor shipped a background-agents mode that spawns parallel workers to refactor, test and open pull requests across an entire repository. A supervisor agent reviews diffs before they land, and developers approve from a single queue.',
    whyItMatters: 'Multi-agent coding moves from demos to a mainstream editor developers already use daily.',
    category: 'Tools',
    difficulty: 'intermediate',
    tags: ['cursor', 'coding', 'agents'],
    sourceName: 'Cursor',
    sourceUrl: 'https://cursor.com/blog',
    imageSeed: 'cursor2',
  },
  {
    title: 'LangChain releases a typed, streaming agent runtime',
    summary:
      'LangChain shipped a rewritten runtime with end-to-end type safety, first-class streaming and durable checkpoints so long-running agents can resume after crashes. The team says boilerplate drops by roughly half versus the previous API.',
    whyItMatters: 'Durable, typed agents are far easier to ship to production than fragile prompt chains.',
    category: 'Tools',
    difficulty: 'advanced',
    tags: ['langchain', 'framework', 'agents'],
    sourceName: 'LangChain Blog',
    sourceUrl: 'https://blog.langchain.dev',
    imageSeed: 'langchain',
  },
  {
    title: 'Ollama adds one-click local fine-tuning on Apple Silicon',
    summary:
      'Ollama now supports LoRA fine-tuning entirely on-device for M-series Macs, so you can adapt a small model to your notes or codebase without sending data to the cloud. Training a 3B model on a few thousand examples takes minutes on an M3.',
    whyItMatters: 'Private, local customization lowers the bar for tinkering without cloud bills or data risk.',
    category: 'Tools',
    difficulty: 'beginner',
    tags: ['ollama', 'local', 'fine-tuning'],
    sourceName: 'Ollama',
    sourceUrl: 'https://ollama.com/blog',
    imageSeed: 'ollama',
  },
  {
    title: 'Hugging Face launches a registry for verified MCP servers',
    summary:
      'Hugging Face opened a directory of Model Context Protocol servers with signed provenance and permission manifests, so developers can see exactly what a tool can access before connecting it to an agent. Popular database and browser servers are already listed.',
    whyItMatters: 'A trusted registry curbs the security risk of wiring arbitrary tools into autonomous agents.',
    category: 'Tools',
    difficulty: 'intermediate',
    tags: ['huggingface', 'mcp', 'security'],
    sourceName: 'Hugging Face',
    sourceUrl: 'https://huggingface.co/blog',
    imageSeed: 'hfmcp',
  },
  {
    title: 'Study finds chain-of-thought can mask a model’s real reasoning',
    summary:
      'Researchers showed that the visible chain-of-thought a model prints often does not reflect the computation that produced its answer; edits to the reasoning text barely change outputs. They urge caution in treating explanations as faithful audit trails.',
    whyItMatters: 'If explanations are decorative, safety and compliance need better interpretability methods.',
    category: 'Research',
    difficulty: 'advanced',
    tags: ['interpretability', 'reasoning', 'safety'],
    sourceName: 'arXiv',
    sourceUrl: 'https://arxiv.org',
    imageSeed: 'cot',
  },
  {
    title: 'New method cuts LLM inference memory by 4x with no quality loss',
    summary:
      'A paper introduces a KV-cache compression scheme that stores attention state in a learned low-rank form, cutting memory roughly four-fold on long contexts while matching full-precision accuracy. The trick needs no retraining and drops into existing serving stacks.',
    whyItMatters: 'Cheaper long-context inference makes million-token assistants viable on modest hardware.',
    category: 'Research',
    difficulty: 'advanced',
    tags: ['inference', 'efficiency', 'kv-cache'],
    sourceName: 'arXiv',
    sourceUrl: 'https://arxiv.org',
    imageSeed: 'kvcache',
  },
  {
    title: 'Benchmark shows AI agents still fail most multi-day office tasks',
    summary:
      'A new benchmark of realistic knowledge-work tasks found leading agents complete only about a third of jobs that span multiple days and tools. Common failures were losing track of goals and mishandling ambiguous instructions rather than raw reasoning limits.',
    whyItMatters: 'It grounds the hype: agents help with steps, but reliable end-to-end autonomy is not here yet.',
    category: 'Research',
    difficulty: 'intermediate',
    tags: ['agents', 'benchmark', 'evaluation'],
    sourceName: 'arXiv',
    sourceUrl: 'https://arxiv.org',
    imageSeed: 'agentbench',
  },
  {
    title: 'Nvidia unveils Rubin GPUs targeting cheaper inference',
    summary:
      'Nvidia announced its Rubin generation, pairing higher memory bandwidth with a redesigned interconnect aimed squarely at inference economics rather than training peaks. The company claims a large drop in cost per token for large mixture-of-experts models.',
    whyItMatters: 'Inference is now the dominant AI cost, so hardware tuned for it reshapes deployment budgets.',
    category: 'Business',
    difficulty: 'beginner',
    tags: ['nvidia', 'hardware', 'inference'],
    sourceName: 'Reuters',
    sourceUrl: 'https://www.reuters.com/technology',
    imageSeed: 'rubin',
  },
  {
    title: 'Enterprise AI spend shifts from pilots to production budgets',
    summary:
      'A survey of large firms found most have moved beyond experiments, with committed multi-year budgets for AI copilots in support, coding and analytics. Buyers now prioritize measurable ROI and data governance over raw model benchmark scores.',
    whyItMatters: 'The market is maturing: durable revenue favors vendors who prove outcomes, not demos.',
    category: 'Business',
    difficulty: 'beginner',
    tags: ['enterprise', 'adoption', 'roi'],
    sourceName: 'The Information',
    sourceUrl: 'https://www.theinformation.com',
    imageSeed: 'entspend',
  },
  {
    title: 'AI coding startup hits $1B revenue run-rate in 18 months',
    summary:
      'A code-generation startup said it crossed a billion-dollar annualized revenue run-rate less than two years after launch, driven by seat-based enterprise deals. Investors call it one of the fastest software ramps on record, though churn remains an open question.',
    whyItMatters: 'It signals real, sticky demand for AI developer tools, not just speculative funding.',
    category: 'Business',
    difficulty: 'beginner',
    tags: ['startup', 'revenue', 'coding'],
    sourceName: 'Bloomberg',
    sourceUrl: 'https://www.bloomberg.com/technology',
    imageSeed: 'revenue',
  },
  {
    title: 'EU AI Act enforcement begins for general-purpose models',
    summary:
      'The first binding obligations of the EU AI Act took effect for general-purpose model providers, requiring technical documentation, training-data summaries and copyright compliance. Regulators published templates, and non-compliance can trigger fines tied to global turnover.',
    whyItMatters: 'Compliance is now a shipping requirement, not a nice-to-have, for anyone serving the EU.',
    category: 'Policy',
    difficulty: 'intermediate',
    tags: ['eu', 'regulation', 'compliance'],
    sourceName: 'European Commission',
    sourceUrl: 'https://digital-strategy.ec.europa.eu',
    imageSeed: 'euact',
  },
  {
    title: 'US states advance disclosure rules for AI-generated media',
    summary:
      'Several US states passed laws requiring clear labels on AI-generated political ads and deepfakes, with a few mandating watermark support in consumer tools. Platforms are updating policies ahead of election season, while free-speech groups warn about overreach.',
    whyItMatters: 'Provenance labeling is becoming law, pushing watermarking from optional to expected.',
    category: 'Policy',
    difficulty: 'beginner',
    tags: ['policy', 'deepfakes', 'watermarking'],
    sourceName: 'AP News',
    sourceUrl: 'https://apnews.com',
    imageSeed: 'disclosure',
  },
  {
    title: 'Major labs sign voluntary pact on frontier-model safety testing',
    summary:
      'Leading AI labs agreed to share red-team results and pre-deployment evaluations for frontier models with a new independent body. The pact is voluntary and lacks penalties, but supporters see it as scaffolding for future binding standards.',
    whyItMatters: 'Shared safety evaluation is a step toward accountability before models ship at scale.',
    category: 'Policy',
    difficulty: 'intermediate',
    tags: ['safety', 'governance', 'frontier'],
    sourceName: 'Financial Times',
    sourceUrl: 'https://www.ft.com',
    imageSeed: 'safetypact',
  },
  {
    title: 'How to write prompts that actually reduce hallucinations',
    summary:
      'Ground the model in source text, ask it to cite the passage it used, and let it answer “not in the context” when unsure. Splitting a question into retrieve-then-answer steps and lowering temperature further cuts confident-but-wrong replies in practice.',
    whyItMatters: 'A few structural habits reliably beat clever wording for trustworthy answers.',
    category: 'How-to',
    difficulty: 'beginner',
    tags: ['prompting', 'rag', 'reliability'],
    sourceName: 'AIShorts Guide',
    sourceUrl: 'https://example.com/guides/hallucinations',
    imageSeed: 'prompthowto',
  },
  {
    title: 'Build a RAG pipeline over your own notes in an afternoon',
    summary:
      'Chunk your documents, embed them with a small open model, and store vectors in a local database. At query time, retrieve the top matches and pass them as context. Start simple with fixed-size chunks, then tune overlap and re-ranking once it works.',
    whyItMatters: 'Retrieval-augmented generation is the most practical way to ground models in private data.',
    category: 'How-to',
    difficulty: 'intermediate',
    tags: ['rag', 'embeddings', 'tutorial'],
    sourceName: 'AIShorts Guide',
    sourceUrl: 'https://example.com/guides/rag',
    imageSeed: 'raghowto',
  },
  {
    title: 'Evaluate an LLM feature before you ship it',
    summary:
      'Write a small graded test set of real user inputs with expected behaviors, run it on every prompt or model change, and track pass rates over time. Use an LLM judge for open-ended answers but spot-check its grades against human labels regularly.',
    whyItMatters: 'Lightweight evals catch regressions that vibes-based testing quietly ships to users.',
    category: 'How-to',
    difficulty: 'intermediate',
    tags: ['evaluation', 'testing', 'llmops'],
    sourceName: 'AIShorts Guide',
    sourceUrl: 'https://example.com/guides/evals',
    imageSeed: 'evalhowto',
  },
  {
    title: 'Mistral ships a 3B model that runs on phones',
    summary:
      'Mistral released a compact 3B-parameter model tuned for on-device use, with quantized builds that run offline on recent phones. It targets summarization, drafting and simple tool use, trading peak reasoning for speed, privacy and zero inference cost.',
    whyItMatters: 'Capable on-device models bring private, offline assistants to everyday hardware.',
    category: 'Models',
    difficulty: 'beginner',
    tags: ['mistral', 'on-device', 'small-models'],
    sourceName: 'Mistral AI',
    sourceUrl: 'https://mistral.ai/news',
    imageSeed: 'mistral3b',
  },
  {
    title: 'Perplexity adds an agentic research mode with source auditing',
    summary:
      'Perplexity launched a mode that plans a research question, gathers sources, and shows a step-by-step trail you can audit and re-run. It flags weak or conflicting citations and lets you pin trusted domains to steer future searches.',
    whyItMatters: 'Auditable research trails make AI answers easier to trust and verify.',
    category: 'Tools',
    difficulty: 'beginner',
    tags: ['perplexity', 'search', 'research'],
    sourceName: 'Perplexity',
    sourceUrl: 'https://www.perplexity.ai/hub',
    imageSeed: 'perplexity',
  },
  {
    title: 'Robots learn new tasks from a handful of video demos',
    summary:
      'A research team showed a general robot policy that picks up new manipulation tasks from just a few human video demonstrations, without task-specific reprogramming. The model transfers skills across different robot arms by learning shared visual-motor representations.',
    whyItMatters: 'Few-shot skill transfer is a key step toward practical, adaptable household and factory robots.',
    category: 'Research',
    difficulty: 'advanced',
    tags: ['robotics', 'imitation-learning', 'transfer'],
    sourceName: 'arXiv',
    sourceUrl: 'https://arxiv.org',
    imageSeed: 'robots',
  },
  {
    title: 'Cloud providers race to offer per-second AI inference billing',
    summary:
      'Major clouds introduced finer-grained, per-second billing for model inference and autoscaling endpoints that scale to zero. The shift helps startups match spend to real traffic, intensifying a price war for AI workloads across regions.',
    whyItMatters: 'Cheaper, elastic inference lowers the cost of launching AI features for small teams.',
    category: 'Business',
    difficulty: 'intermediate',
    tags: ['cloud', 'pricing', 'infrastructure'],
    sourceName: 'CNBC',
    sourceUrl: 'https://www.cnbc.com/technology',
    imageSeed: 'cloudbilling',
  },
];

async function main() {
  console.log('Seeding demo cards...');

  // A source row so the data model is coherent (optional for the feed).
  const source = await prisma.source.upsert({
    where: { url: 'https://aishorts.local/demo-seed' },
    update: {},
    create: { name: 'AIShorts Demo Seed', type: 'manual', url: 'https://aishorts.local/demo-seed', trusted: true },
  });
  void source;

  // Clear previously seeded demo cards so re-running stays idempotent.
  await prisma.card.deleteMany({ where: { sourceUrl: { contains: '' }, rawItemId: null, tags: { has: '__seed__' } } });

  const now = Date.now();
  let i = 0;
  for (const c of cards) {
    // Stagger publishedAt so ordering (newest first) is stable and realistic.
    const publishedAt = new Date(now - i * 36 * 60 * 1000); // 36 min apart
    await prisma.card.create({
      data: {
        type: c.type ?? 'news',
        title: c.title,
        summary: c.summary,
        whyItMatters: c.whyItMatters ?? null,
        category: c.category,
        difficulty: c.difficulty,
        tags: [...c.tags, '__seed__'],
        imageUrl: `https://picsum.photos/seed/${c.imageSeed}/800/450`,
        sourceName: c.sourceName,
        sourceUrl: c.sourceUrl,
        status: 'published',
        publishedAt,
      },
    });
    i++;
  }

  const count = await prisma.card.count({ where: { status: 'published' } });
  console.log(`Done. ${count} published cards in the database.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
