import { ingest } from './ingest';
import { summarizePending } from './summarize';

export type PipelineResult = {
  fetched: number; // articles seen across all feeds
  inserted: number; // new raw articles stored (after dedup)
  created: number; // draft cards written
  skipped: number; // articles the summarizer couldn't process
};

// The full content pipeline: pull feeds -> summarize the freshest new articles
// into draft cards awaiting review.
//
// Extracted from the CLI so the API can run it on demand (admin "Fetch new
// articles" button) with the exact same code path the command line uses.
export async function runPipeline(
  onProgress?: (message: string) => void,
): Promise<PipelineResult> {
  const step = (message: string) => {
    console.log(message);
    onProgress?.(message);
  };

  step('Fetching RSS sources…');
  const { fetched, inserted } = await ingest();

  step(`Found ${inserted} new article(s) of ${fetched} seen. Summarizing…`);
  const { created, skipped } = await summarizePending();

  step(`Done — ${created} new draft card(s) ready for review.`);
  return { fetched, inserted, created, skipped };
}
