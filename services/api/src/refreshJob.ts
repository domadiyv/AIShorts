import { runPipeline, type PipelineResult } from '@aishorts/worker';

// Admin-triggered content refresh.
//
// The pipeline takes minutes (RSS fetches + LLM calls), which is far too long to
// hold an HTTP request open. So POST /v1/admin/refresh starts it in the
// background and returns immediately; the panel polls GET for progress.
//
// State is deliberately in-memory: one API process, one job at a time. A restart
// clears it, which is correct — a job can't survive the process anyway. If this
// ever runs multi-instance, move this to Redis.

export type RefreshStatus = 'idle' | 'running' | 'done' | 'error';

export type RefreshState = {
  status: RefreshStatus;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: PipelineResult | null;
  error: string | null;
};

const IDLE: RefreshState = {
  status: 'idle',
  message: '',
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
};

let state: RefreshState = { ...IDLE };

export function getRefreshState(): RefreshState {
  return state;
}

// Returns started=false if a run is already in flight (the caller sends 409).
export function startRefresh(): { started: boolean; state: RefreshState } {
  if (state.status === 'running') return { started: false, state };

  state = {
    ...IDLE,
    status: 'running',
    message: 'Starting…',
    startedAt: new Date().toISOString(),
  };

  // Intentionally not awaited — the HTTP handler returns while this runs.
  void (async () => {
    try {
      const result = await runPipeline((message) => {
        if (state.status === 'running') state = { ...state, message };
      });
      state = {
        ...state,
        status: 'done',
        message:
          result.created > 0
            ? `Added ${result.created} new card(s) to review.`
            : result.skipped > 0
              ? `Fetched articles, but couldn't summarize any (${result.skipped} failed — check the LLM key and API logs).`
              : result.inserted > 0
                ? `Fetched ${result.inserted} new article(s), but none were recent enough to summarize.`
                : 'No new articles found.',
        finishedAt: new Date().toISOString(),
        result,
      };
    } catch (err) {
      state = {
        ...state,
        status: 'error',
        message: 'Refresh failed.',
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  })();

  return { started: true, state };
}
