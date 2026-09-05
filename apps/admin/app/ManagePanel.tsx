'use client';

import { useEffect, useState, useTransition } from 'react';
import type {
  AdminCategory,
  AdminSource,
  FeedPreviewResult,
  SaveResult,
} from './actions';

type CreateCategory = (name: string) => Promise<SaveResult>;
type UpdateCategory = (id: string, name: string) => Promise<SaveResult>;
type DeleteCategory = (id: string, reassignTo?: string) => Promise<SaveResult>;
type UpdateSource = (
  id: string,
  patch: { priority?: number; active?: boolean; trusted?: boolean },
) => Promise<SaveResult>;
type CreateSource = (input: {
  name: string;
  url: string;
  priority: number;
  trusted: boolean;
}) => Promise<SaveResult>;
type DeleteSource = (id: string) => Promise<SaveResult>;
type PreviewSource = (url: string) => Promise<FeedPreviewResult>;

const PRIORITY_OPTIONS = [
  { value: 1, label: '1 — Top' },
  { value: 2, label: '2 — High' },
  { value: 3, label: '3 — Normal' },
  { value: 4, label: '4 — Low' },
  { value: 5, label: '5 — Minor' },
];

// Both manage lists paginate client-side (all rows are already in memory) so they
// stay usable as the source/category count grows.
const MANAGE_PAGE_SIZE = 10;

// Slice a list into pages with a stable current page. Clamps the page when the
// list shrinks (e.g. after a delete) so we never strand on an empty page.
function usePaged<T>(items: T[], size: number) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(items.length / size))));
  }, [items.length, size]);
  const start = (page - 1) * size;
  return { page, setPage, totalPages, pageItems: items.slice(start, start + size) };
}

function Pager({
  page,
  setPage,
  totalPages,
}: {
  page: number;
  setPage: (n: number) => void;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pager manage-pager" aria-label="Pagination">
      <button
        type="button"
        className="pager-btn"
        onClick={() => setPage(page - 1)}
        disabled={page <= 1}
      >
        ← Prev
      </button>
      <span className="pager-status">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="pager-btn"
        onClick={() => setPage(page + 1)}
        disabled={page >= totalPages}
      >
        Next →
      </button>
    </nav>
  );
}

// Collapsible admin controls that sit above the review list. Manage the content
// sources (add via a validated feed check, delete, reorder ingest preference via
// priority, toggle active/trusted) and the categories (add, rename, delete with a
// required "move cards to" pick when the category is still in use).
export function ManagePanel({
  sources,
  categories,
  createCategory,
  updateCategory,
  deleteCategory,
  updateSource,
  createSource,
  deleteSource,
  previewSource,
}: {
  sources: AdminSource[];
  categories: AdminCategory[];
  createCategory: CreateCategory;
  updateCategory: UpdateCategory;
  deleteCategory: DeleteCategory;
  updateSource: UpdateSource;
  createSource: CreateSource;
  deleteSource: DeleteSource;
  previewSource: PreviewSource;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'sources' | 'categories'>('sources');
  const [rows, setRows] = useState(sources);
  const [cats, setCats] = useState(categories);
  const [pending, startTransition] = useTransition();

  // Server-action revalidation streams fresh props in; sync them into local state
  // so add/delete/rename settle to the authoritative values after the optimistic
  // update.
  useEffect(() => setRows(sources), [sources]);
  useEffect(() => setCats(categories), [categories]);

  return (
    <div className="manage">
      <button type="button" className="manage-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="manage-toggle-caret">{open ? '▾' : '▸'}</span> Manage categories &amp; sources
      </button>

      {open && (
        <div className="manage-body">
          <div className="manage-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'sources'}
              className={`manage-tab ${tab === 'sources' ? 'active' : ''}`}
              onClick={() => setTab('sources')}
            >
              Sources ({rows.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'categories'}
              className={`manage-tab ${tab === 'categories' ? 'active' : ''}`}
              onClick={() => setTab('categories')}
            >
              Categories ({cats.length})
            </button>
          </div>

          {tab === 'sources' ? (
            <SourcesSection
              rows={rows}
              setRows={setRows}
              pending={pending}
              startTransition={startTransition}
              updateSource={updateSource}
              createSource={createSource}
              deleteSource={deleteSource}
              previewSource={previewSource}
            />
          ) : (
            <CategoriesSection
              cats={cats}
              setCats={setCats}
              pending={pending}
              startTransition={startTransition}
              createCategory={createCategory}
              updateCategory={updateCategory}
              deleteCategory={deleteCategory}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function SourcesSection({
  rows,
  setRows,
  pending,
  startTransition,
  updateSource,
  createSource,
  deleteSource,
  previewSource,
}: {
  rows: AdminSource[];
  setRows: React.Dispatch<React.SetStateAction<AdminSource[]>>;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  updateSource: UpdateSource;
  createSource: CreateSource;
  deleteSource: DeleteSource;
  previewSource: PreviewSource;
}) {
  const [srcMsg, setSrcMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { page, setPage, totalPages, pageItems } = usePaged(rows, MANAGE_PAGE_SIZE);

  const patchSource = (
    id: string,
    patch: { priority?: number; active?: boolean; trusted?: boolean },
  ) => {
    setSrcMsg(null);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    startTransition(async () => {
      const res = await updateSource(id, patch);
      if (!res.ok) setSrcMsg({ text: res.error ?? 'Update failed.', err: true });
    });
  };

  const removeSource = (id: string, name: string) => {
    setSrcMsg(null);
    setConfirmId(null);
    setRows((rs) => rs.filter((r) => r.id !== id));
    startTransition(async () => {
      const res = await deleteSource(id);
      if (res.ok) setSrcMsg({ text: `Removed "${name}". Its published cards stay live.` });
      else setSrcMsg({ text: res.error ?? 'Could not delete source.', err: true });
    });
  };

  return (
    <section className="manage-section">
      <p className="sub">
        Priority sets how much a source&apos;s stories are boosted in the feed: 1 = top … 5 = low.
        Toggle a source off to stop pulling from it; delete removes it from ingest (published cards
        stay).
      </p>

      <AddSourceForm
        pending={pending}
        startTransition={startTransition}
        createSource={createSource}
        previewSource={previewSource}
        onAdded={(name) => setSrcMsg({ text: `Added "${name}". It'll be pulled on the next fetch.` })}
        onError={(text) => setSrcMsg({ text, err: true })}
      />

      {srcMsg && <p className={`save-msg${srcMsg.err ? ' save-err' : ' save-ok'}`}>{srcMsg.text}</p>}

      <table className="src-table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Priority</th>
            <th>Active</th>
            <th>Trusted</th>
            <th>Items</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((s) => (
            <tr key={s.id} className={s.active ? '' : 'src-inactive'}>
              <td>
                <span className="src-name">{s.name}</span>
                <span className="src-host">{hostOf(s.url)}</span>
              </td>
              <td>
                <select
                  className="src-priority"
                  value={s.priority}
                  onChange={(e) => patchSource(s.id, { priority: Number(e.target.value) })}
                >
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={s.active}
                  onChange={(e) => patchSource(s.id, { active: e.target.checked })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={s.trusted}
                  onChange={(e) => patchSource(s.id, { trusted: e.target.checked })}
                />
              </td>
              <td className="src-count">{s.itemCount}</td>
              <td>
                {confirmId === s.id ? (
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn-reject"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      disabled={pending}
                      onClick={() => removeSource(s.id, s.name)}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="btn-save"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => setConfirmId(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-linky"
                    onClick={() => setConfirmId(s.id)}
                    title="Delete source"
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={page} setPage={setPage} totalPages={totalPages} />
    </section>
  );
}

function AddSourceForm({
  pending,
  startTransition,
  createSource,
  previewSource,
  onAdded,
  onError,
}: {
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  createSource: CreateSource;
  previewSource: PreviewSource;
  onAdded: (name: string) => void;
  onError: (text: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [priority, setPriority] = useState(3);
  const [trusted, setTrusted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<FeedPreviewResult | null>(null);

  // Reset the validated preview whenever the URL changes — the operator must
  // re-check before adding so we never store a feed we haven't confirmed reads.
  const onUrlChange = (v: string) => {
    setUrl(v);
    setPreview(null);
  };

  const checkFeed = () => {
    setChecking(true);
    setPreview(null);
    startTransition(async () => {
      const res = await previewSource(url);
      setChecking(false);
      setPreview(res);
      // Auto-fill the display name from the feed title (only if untouched).
      if (res.ok && res.title && !name.trim()) setName(res.title);
    });
  };

  const add = () => {
    startTransition(async () => {
      const res = await createSource({ name, url, priority, trusted });
      if (res.ok) {
        onAdded(name.trim());
        setUrl('');
        setName('');
        setPriority(3);
        setTrusted(false);
        setPreview(null);
      } else {
        onError(res.error ?? 'Could not add source.');
      }
    });
  };

  const canAdd = preview?.ok === true && name.trim().length > 0 && !pending;

  return (
    <div className="add-source">
      <h4 className="add-source-h">Add a source</h4>
      <p className="sub" style={{ marginTop: 0 }}>
        Paste an RSS/Atom feed URL and check it — we&apos;ll confirm it reads and pull its title and
        latest headlines before you add it.
      </p>
      <div className="row">
        <input
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://example.com/feed.xml"
          style={{ flex: '1 1 320px', minWidth: 220 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (url.trim() && !checking) checkFeed();
            }
          }}
        />
        <button type="button" className="btn-save" onClick={checkFeed} disabled={!url.trim() || checking}>
          {checking ? 'Checking…' : 'Check feed'}
        </button>
      </div>

      {preview && !preview.ok && (
        <p className="save-msg save-err">{preview.error ?? 'That feed could not be read.'}</p>
      )}

      {preview?.ok && (
        <div className="feed-preview">
          <p className="feed-preview-title">
            ✓ {preview.title ?? 'Feed'} — {preview.itemCount} item(s)
          </p>
          {preview.sampleTitles && preview.sampleTitles.length > 0 && (
            <ul className="feed-preview-list">
              {preview.sampleTitles.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              style={{ flex: '1 1 220px', minWidth: 180 }}
            />
            <select
              className="src-priority"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="trusted-label">
              <input
                type="checkbox"
                checked={trusted}
                onChange={(e) => setTrusted(e.target.checked)}
              />
              Trusted
            </label>
            <button type="button" className="btn-approve" onClick={add} disabled={!canAdd}>
              Add source
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function CategoriesSection({
  cats,
  setCats,
  pending,
  startTransition,
  createCategory,
  updateCategory,
  deleteCategory,
}: {
  cats: AdminCategory[];
  setCats: React.Dispatch<React.SetStateAction<AdminCategory[]>>;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  createCategory: CreateCategory;
  updateCategory: UpdateCategory;
  deleteCategory: DeleteCategory;
}) {
  const [newCat, setNewCat] = useState('');
  const [catMsg, setCatMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState('');
  const { page, setPage, totalPages, pageItems } = usePaged(cats, MANAGE_PAGE_SIZE);

  const addCategory = () => {
    if (pending) return;
    setCatMsg(null);
    startTransition(async () => {
      const res = await createCategory(newCat);
      if (res.ok) {
        setCatMsg({ text: `Added "${newCat.trim()}". It's now in the dropdowns.` });
        setNewCat('');
      } else {
        setCatMsg({ text: res.error ?? 'Could not add category.', err: true });
      }
    });
  };

  const startEdit = (c: AdminCategory) => {
    setEditId(c.id);
    setEditName(c.name);
    setDeleteId(null);
    setCatMsg(null);
  };

  const saveEdit = (c: AdminCategory) => {
    const name = editName.trim();
    if (!name || name === c.name) {
      setEditId(null);
      return;
    }
    setCatMsg(null);
    setCats((cs) => cs.map((x) => (x.id === c.id ? { ...x, name } : x)));
    setEditId(null);
    startTransition(async () => {
      const res = await updateCategory(c.id, name);
      if (res.ok) setCatMsg({ text: `Renamed to "${name}" (its cards moved too).` });
      else setCatMsg({ text: res.error ?? 'Could not rename category.', err: true });
    });
  };

  const startDelete = (c: AdminCategory) => {
    setDeleteId(c.id);
    setReassignTo('');
    setEditId(null);
    setCatMsg(null);
  };

  const confirmDelete = (c: AdminCategory) => {
    if (c.cardCount > 0 && !reassignTo) {
      setCatMsg({ text: 'Pick a category to move the cards to first.', err: true });
      return;
    }
    setCatMsg(null);
    setDeleteId(null);
    setCats((cs) => cs.filter((x) => x.id !== c.id));
    startTransition(async () => {
      const res = await deleteCategory(c.id, reassignTo || undefined);
      if (res.ok)
        setCatMsg({
          text:
            c.cardCount > 0
              ? `Deleted "${c.name}" — ${c.cardCount} card(s) moved to "${reassignTo}".`
              : `Deleted "${c.name}".`,
        });
      else setCatMsg({ text: res.error ?? 'Could not delete category.', err: true });
    });
  };

  return (
    <section className="manage-section">
      <div className="row">
        <input
          type="text"
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
          placeholder="Add a category, e.g. Hardware"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCategory();
            }
          }}
          style={{ maxWidth: 260 }}
        />
        <button type="button" className="btn-approve" onClick={addCategory} disabled={pending}>
          Add
        </button>
      </div>

      {catMsg && <p className={`save-msg${catMsg.err ? ' save-err' : ' save-ok'}`}>{catMsg.text}</p>}

      <ul className="cat-list">
        {pageItems.map((c) => (
          <li key={c.id} className="cat-row">
            {editId === c.id ? (
              <span className="row" style={{ gap: 6, flex: 1 }}>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      saveEdit(c);
                    } else if (e.key === 'Escape') {
                      setEditId(null);
                    }
                  }}
                  style={{ maxWidth: 220 }}
                />
                <button type="button" className="btn-approve" style={btnSm} onClick={() => saveEdit(c)}>
                  Save
                </button>
                <button type="button" className="btn-save" style={btnSm} onClick={() => setEditId(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <>
                <span className="cat-name">{c.name}</span>
                <span className="pill cat-count">{c.cardCount} card(s)</span>
                <span className="cat-actions">
                  <button type="button" className="btn-linky" onClick={() => startEdit(c)}>
                    Rename
                  </button>
                  <button type="button" className="btn-linky btn-linky-danger" onClick={() => startDelete(c)}>
                    Delete
                  </button>
                </span>
              </>
            )}

            {deleteId === c.id && (
              <div className="cat-delete">
                {c.cardCount > 0 ? (
                  <div className="row" style={{ gap: 6 }}>
                    <span className="sub" style={{ margin: 0 }}>
                      Move {c.cardCount} card(s) to
                    </span>
                    <select
                      className="src-priority"
                      value={reassignTo}
                      onChange={(e) => setReassignTo(e.target.value)}
                    >
                      <option value="">Choose category…</option>
                      {cats
                        .filter((o) => o.id !== c.id)
                        .map((o) => (
                          <option key={o.id} value={o.name}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </div>
                ) : (
                  <span className="sub" style={{ margin: 0 }}>
                    No cards use this — delete it?
                  </span>
                )}
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn-reject"
                    style={btnSm}
                    disabled={pending}
                    onClick={() => confirmDelete(c)}
                  >
                    Delete category
                  </button>
                  <button type="button" className="btn-save" style={btnSm} onClick={() => setDeleteId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Pager page={page} setPage={setPage} totalPages={totalPages} />
    </section>
  );
}

const btnSm: React.CSSProperties = { padding: '4px 10px', fontSize: 12 };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
