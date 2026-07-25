'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  getRefreshState,
  revalidateCards,
  startRefresh,
  type RefreshState,
} from './actions';

const POLL_MS = 2000;

// "Fetch new articles" — runs the RSS + summarize pipeline from the panel.
//
// The job takes minutes, so this starts it and then polls for progress rather
// than blocking. It also resumes polling on mount, so navigating away, closing
// the tab, or reloading never orphans a running job.
export function RefreshButton({ initialState }: { initialState: RefreshState }) {
  const [state, setState] = useState<RefreshState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const wasRunning = useRef(initialState.status === 'running');

  const running = state.status === 'running';

  useEffect(() => {
    if (!running) {
      // A run just finished -> pull the new drafts into the list.
      if (wasRunning.current) {
        wasRunning.current = false;
        startTransition(async () => {
          await revalidateCards();
          router.refresh();
        });
      }
      return;
    }
    wasRunning.current = true;

    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const next = await getRefreshState();
        if (!cancelled) setState(next);
      } catch {
        /* transient — keep polling */
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [running, router]);

  const onClick = useCallback(async () => {
    setError(null);
    try {
      setState(await startRefresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start refresh');
    }
  }, []);

  return (
    <div className="refresh">
      <button className="btn-refresh" onClick={onClick} disabled={running} type="button">
        {running ? 'Fetching…' : 'Fetch new articles'}
      </button>

      {running && <span className="refresh-msg">{state.message || 'Working…'}</span>}

      {!running && state.status === 'done' && (
        <span className="refresh-msg refresh-ok">
          {state.message}
          {isPending ? ' Refreshing list…' : ''}
        </span>
      )}

      {!running && state.status === 'error' && (
        <span className="refresh-msg refresh-err">{state.error ?? state.message}</span>
      )}

      {error && <span className="refresh-msg refresh-err">{error}</span>}
    </div>
  );
}
