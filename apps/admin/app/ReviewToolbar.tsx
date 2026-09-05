'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = ['pending', 'published', 'rejected'] as const;

// The status tabs plus a collapsed magnifier at the far right. Clicking the
// magnifier expands an inline search field; submitting navigates to
// /?status=…&q=… (a plain GET, page resets to 1). Kept client-side so the field
// can animate open/closed without a round-trip.
export function ReviewToolbar({ status, query }: { status: string; query: string }) {
  const router = useRouter();
  // Start open if we arrived on a search result, so the term stays visible/editable.
  const [open, setOpen] = useState(!!query);
  const [q, setQ] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field the moment it expands.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const go = (term: string) => {
    const params = new URLSearchParams({ status });
    if (term.trim()) params.set('q', term.trim());
    router.push(`/?${params}`);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    go(q);
  };

  const clear = () => {
    setQ('');
    setOpen(false);
    if (query) go(''); // only navigate if a search was actually active
  };

  return (
    <nav className="tabs" aria-label="Card status">
      {STATUSES.map((s) => (
        <a key={s} className={`tab ${s === status ? 'active' : ''}`} href={`/?status=${s}`}>
          {s}
        </a>
      ))}
      <form className={`tabsearch ${open ? 'open' : ''}`} onSubmit={submit} role="search">
        <input
          ref={inputRef}
          className="tabsearch-input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(q);
            } else if (e.key === 'Escape') {
              if (q) clear();
              else setOpen(false);
            }
          }}
          onBlur={() => {
            if (!q.trim()) setOpen(false);
          }}
          placeholder={`Search ${status}…`}
          aria-label={`Search ${status} cards`}
          aria-hidden={!open}
          tabIndex={open ? 0 : -1}
        />
        {open && q && (
          <button
            type="button"
            className="tabsearch-clear"
            aria-label="Clear search"
            onClick={clear}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="tabsearch-icon"
          aria-label={open ? 'Search' : 'Open search'}
          onClick={() => (open ? go(q) : setOpen(true))}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </form>
    </nav>
  );
}
