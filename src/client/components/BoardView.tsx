import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";
import { formatDateTime, type Issue } from "../../shared/schema";
import type { Board, Card, Column } from "../../shared/types";
import { api, cssColor } from "../api";
import { InlineInput } from "./InlineInput";

interface Props {
  board: Board;
  /** Called after any write so the board is re-read from disk. */
  onChanged: () => void;
  onError: (err: unknown) => void;
  onOpenCard: (card: string) => void;
  onDraggingChange: (dragging: boolean) => void;
}

/** Card names are unique vault-wide, so they double as drag ids. Columns get a prefix. */
const COLUMN_PREFIX = "column:";

type Layout = Record<string, string[]>;

const layoutOf = (board: Board): Layout =>
  Object.fromEntries(
    board.columns.map((c) => [c.name, c.cards.map((card) => card.name)]),
  );

export function BoardView({
  board,
  onChanged,
  onError,
  onOpenCard,
  onDraggingChange,
}: Props) {
  const [layout, setLayout] = useState<Layout>(() => layoutOf(board));
  const [drag, setDrag] = useState<{ card: string; from: string } | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);

  // Adopt the server's view whenever it changes, unless a drag is in progress.
  useEffect(() => {
    if (!drag) setLayout(layoutOf(board));
  }, [board, drag]);

  const cards = useMemo(
    () =>
      new Map(
        board.columns.flatMap((c) =>
          c.cards.map((card) => [card.name, card] as const),
        ),
      ),
    [board],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const containerOf = (id: string): string | undefined =>
    id.startsWith(COLUMN_PREFIX)
      ? id.slice(COLUMN_PREFIX.length)
      : Object.keys(layout).find((column) => layout[column]!.includes(id));

  const run = (action: Promise<unknown>) => action.then(onChanged, onError);

  function handleDragStart({ active }: DragStartEvent) {
    const from = containerOf(String(active.id));
    if (from) {
      setDrag({ card: String(active.id), from });
      onDraggingChange(true);
    }
  }

  // Moving between columns happens live during the drag so the target column opens a gap.
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const id = String(active.id);
    const from = containerOf(id);
    const to = containerOf(String(over.id));
    if (!from || !to || from === to) return;
    setLayout((prev) => {
      const target = prev[to]!;
      const overIndex = target.indexOf(String(over.id));
      const index = overIndex >= 0 ? overIndex : target.length;
      return {
        ...prev,
        [from]: prev[from]!.filter((c) => c !== id),
        [to]: [...target.slice(0, index), id, ...target.slice(index)],
      };
    });
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    const origin = drag;
    setDrag(null);
    onDraggingChange(false);
    const id = String(active.id);
    const column = containerOf(id);
    if (!origin || !over || !column) {
      setLayout(layoutOf(board));
      return;
    }

    let order = layout[column]!;
    const overIndex = order.indexOf(String(over.id));
    const activeIndex = order.indexOf(id);
    if (overIndex >= 0 && overIndex !== activeIndex) {
      order = arrayMove(order, activeIndex, overIndex);
      setLayout({ ...layout, [column]: order });
    }
    const index = order.indexOf(id);

    const originalIndex = layoutOf(board)[origin.from]!.indexOf(id);
    if (column === origin.from && index === originalIndex) return;
    run(api.moveCard(board.path, id, column, index));
  }

  function moveColumn(name: string, delta: number) {
    const names = board.columns.map((c) => c.name);
    const i = names.indexOf(name);
    const j = i + delta;
    if (j < 0 || j >= names.length) return;
    run(api.reorderColumns(board.path, arrayMove(names, i, j)));
  }

  const draggedCard = drag ? cards.get(drag.card) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDrag(null);
        onDraggingChange(false);
        setLayout(layoutOf(board));
      }}
    >
      <div className="board">
        {board.columns.map((column, i) => (
          <ColumnView
            key={column.name}
            column={column}
            cardNames={layout[column.name] ?? []}
            cards={cards}
            isFirst={i === 0}
            isLast={i === board.columns.length - 1}
            onOpenCard={onOpenCard}
            onAddCard={(name) =>
              run(api.createCard(board.path, column.name, name))
            }
            onRename={(name) =>
              run(api.updateColumn(board.path, column.name, { name }))
            }
            onMove={(delta) => moveColumn(column.name, delta)}
            onDelete={() => {
              if (confirm(`Delete the empty column "${column.name}"?`)) {
                run(api.deleteColumn(board.path, column.name));
              }
            }}
          />
        ))}
        <div className="add-column">
          {addingColumn ? (
            <InlineInput
              placeholder="Column name"
              onSubmit={(name) => {
                setAddingColumn(false);
                run(api.createColumn(board.path, name));
              }}
              onCancel={() => setAddingColumn(false)}
            />
          ) : (
            <button className="ghost" onClick={() => setAddingColumn(true)}>
              + Add column
            </button>
          )}
        </div>
      </div>
      <DragOverlay>
        {draggedCard && <CardTile card={draggedCard} overlay />}
      </DragOverlay>
    </DndContext>
  );
}

interface ColumnProps {
  column: Column;
  cardNames: string[];
  cards: Map<string, Card>;
  isFirst: boolean;
  isLast: boolean;
  onOpenCard: (card: string) => void;
  onAddCard: (name: string) => void;
  onRename: (name: string) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}

function ColumnView(props: ColumnProps) {
  const { column, cardNames, cards } = props;
  const { setNodeRef } = useDroppable({ id: COLUMN_PREFIX + column.name });
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);

  return (
    <section className="column">
      <header className="column-header">
        {renaming ? (
          <InlineInput
            initial={column.name}
            onSubmit={(name) => {
              setRenaming(false);
              if (name !== column.name) props.onRename(name);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <h2 onDoubleClick={() => setRenaming(true)}>{column.name}</h2>
        )}
        <span className="count">{cardNames.length}</span>
        {column.isDefault && (
          <span
            className="default-marker"
            title="Default column: cards without a column property show here"
          >
            ★
          </span>
        )}
        <div className="column-actions">
          <button
            className="icon"
            title="Move left"
            disabled={props.isFirst}
            onClick={() => props.onMove(-1)}
          >
            ←
          </button>
          <button
            className="icon"
            title="Move right"
            disabled={props.isLast}
            onClick={() => props.onMove(1)}
          >
            →
          </button>
          <button
            className="icon"
            title="Rename"
            onClick={() => setRenaming(true)}
          >
            ✎
          </button>
          {cardNames.length === 0 && !(props.isFirst && props.isLast) && (
            <button
              className="icon"
              title="Delete column"
              onClick={props.onDelete}
            >
              ✕
            </button>
          )}
        </div>
      </header>

      <SortableContext
        id={column.name}
        items={cardNames}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="cards">
          {cardNames.map((name) => {
            const card = cards.get(name);
            return card ? (
              <SortableCard
                key={name}
                card={card}
                onOpen={() => props.onOpenCard(name)}
              />
            ) : null;
          })}
        </div>
      </SortableContext>

      {adding ? (
        <InlineInput
          placeholder="Card title"
          onSubmit={(name) => {
            setAdding(false);
            props.onAddCard(name);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button className="ghost add-card" onClick={() => setAdding(true)}>
          + Add card
        </button>
      )}
    </section>
  );
}

function SortableCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.name });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
        else listeners?.onKeyDown?.(e);
      }}
    >
      <CardTile card={card} />
    </div>
  );
}

function CardTile({ card, overlay }: { card: Card; overlay?: boolean }) {
  const { tags, due } = card.props;
  const dueInfo = due && describeDue(due);
  const tasks = [...card.body.matchAll(/^\s*[-*] \[( |x|X)\]/gm)];
  const done = tasks.filter((m) => m[1] !== " ").length;

  return (
    <article className={`card${overlay ? " overlay" : ""}`}>
      <div className="card-title">
        <h3>{card.name}</h3>
        <IssueBadge issues={card.issues} file={card.path} />
      </div>
      {(tags.length > 0 || due || tasks.length > 0) && (
        <div className="card-meta">
          {tags.map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
          {dueInfo && (
            <span className={`due${dueInfo.overdue ? " overdue" : ""}`}>
              Due {dueInfo.label}
            </span>
          )}
          {tasks.length > 0 && (
            <span className="progress">
              ☑ {done}/{tasks.length}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * A midnight due date-time means "due that day": it's shown as a date and is overdue from the
 * next day. Any other time is shown with the date and is overdue from that moment.
 */
function describeDue(due: string): { label: string; overdue: boolean } {
  const now = formatDateTime(new Date());
  const [date, time] = due.split("T") as [string, string];
  return time === "00:00:00"
    ? { label: date, overdue: date < now.slice(0, 10) }
    : { label: `${date} ${time.slice(0, 5)}`, overdue: due < now };
}

/** Flags notes whose frontmatter doesn't match the schema. Hover for details. */
export function IssueBadge({
  issues,
  file,
}: {
  issues: Issue[];
  file: string;
}) {
  if (issues.length === 0) return null;
  const detail = `${file} has invalid properties:\n${issues.map((i) => `• ${i.message}`).join("\n")}`;
  return (
    <span className="issue-badge" title={detail} aria-label={detail}>
      ⚠
    </span>
  );
}

export function TagChip({ tag }: { tag: string }) {
  const c = cssColor(undefined);
  return (
    <span className="tag" style={c ? { color: c, borderColor: c } : undefined}>
      #{tag}
    </span>
  );
}
