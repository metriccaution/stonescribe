import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Board, BoardSummary, NoteRef } from "../shared/types";
import { api } from "./api";
import { BoardView, IssueBadge } from "./components/BoardView";
import { CardModal } from "./components/CardModal";
import { InlineInput } from "./components/InlineInput";
import { Markdown, WikiLinkContext } from "./components/Markdown";
import { summaryText } from "../shared/markdown";

const params = () => new URLSearchParams(location.search);

export function App() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(() =>
    params().get("board"),
  );
  const [board, setBoard] = useState<Board | null>(null);
  const [notes, setNotes] = useState<NoteRef[]>([]);
  // Card names are unique across the vault, so the name alone identifies the open card.
  const [openCard, setOpenCard] = useState<string | null>(() =>
    params().get("card"),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef(false);
  const stale = useRef(false);

  const showError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  const reload = useCallback(async () => {
    try {
      const [list, index] = await Promise.all([
        api.listBoards(),
        api.listNotes(),
      ]);
      setBoards(list);
      setNotes(index);
      // A board at the vault root has the path "", so compare against null, not truthiness.
      const target =
        selected !== null && list.some((b) => b.path === selected)
          ? selected
          : (list[0]?.path ?? null);
      if (target !== selected) setSelected(target);
      setBoard(target !== null ? await api.getBoard(target) : null);
    } catch (err) {
      showError(err);
    }
  }, [selected, showError]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Keep the board and open card in the URL so they survive refreshes and can be bookmarked.
  useEffect(() => {
    if (selected === null) return;
    const query = new URLSearchParams({
      board: selected,
      ...(openCard && { card: openCard }),
    });
    history.replaceState(null, "", `?${query}`);
  }, [selected, openCard]);

  // Live updates when notes change on disk (e.g. edited in another tool). Deferred during drags.
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onmessage = () => {
      if (dragging.current) stale.current = true;
      else reload();
    };
    return () => events.close();
  }, [reload]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const wikiLinks = useMemo(() => {
    const byName = new Map(notes.map((n) => [n.name.toLowerCase(), n]));
    return {
      resolve: (name: string) => byName.get(name.toLowerCase()),
      openCard: (ref: NoteRef) => {
        if (!ref.card) return;
        setSelected(ref.card.board);
        setOpenCard(ref.name);
      },
    };
  }, [notes]);

  const card = openCard
    ? board?.columns.flatMap((c) => c.cards).find((c) => c.name === openCard)
    : undefined;

  return (
    <WikiLinkContext.Provider value={wikiLinks}>
      <div className="app">
        <header className="topbar">
          <h1 className="brand">Stonescribe</h1>
          {boards && boards.length > 0 && (
            <select
              value={selected ?? ""}
              onChange={(e) => {
                setSelected(e.target.value);
                setOpenCard(null);
              }}
              aria-label="Board"
            >
              {boards.map((b) => (
                <option key={b.path} value={b.path}>
                  {b.path || b.name}
                </option>
              ))}
            </select>
          )}
          {board && <IssueBadge issues={board.issues} file={board.note} />}
          {creating ? (
            <InlineInput
              placeholder="Board name"
              onCancel={() => setCreating(false)}
              onSubmit={async (name) => {
                setCreating(false);
                try {
                  const created = await api.createBoard(name);
                  setSelected(created.path);
                } catch (err) {
                  showError(err);
                }
              }}
            />
          ) : (
            <button className="ghost" onClick={() => setCreating(true)}>
              + New board
            </button>
          )}
        </header>

        {board && summaryText(board.description) && (
          <div className="board-description">
            <Markdown source={summaryText(board.description)} />
          </div>
        )}

        {board ? (
          <BoardView
            board={board}
            onChanged={reload}
            onError={(err) => {
              showError(err);
              reload();
            }}
            onOpenCard={setOpenCard}
            onDraggingChange={(value) => {
              dragging.current = value;
              if (!value && stale.current) {
                stale.current = false;
                reload();
              }
            }}
          />
        ) : (
          boards && (
            <div className="empty">
              <p>No boards found in this vault.</p>
              <p className="muted">
                A board is any folder holding a note whose frontmatter has{" "}
                <code>kanban: board</code>.
              </p>
              <button className="primary" onClick={() => setCreating(true)}>
                Create a board
              </button>
            </div>
          )
        )}

        {board && card && (
          <CardModal
            key={card.name}
            board={board}
            card={card}
            onClose={() => setOpenCard(null)}
            onChanged={reload}
            onError={showError}
          />
        )}

        {error && (
          <div className="toast" role="alert" onClick={() => setError(null)}>
            {error}
          </div>
        )}
      </div>
    </WikiLinkContext.Provider>
  );
}
