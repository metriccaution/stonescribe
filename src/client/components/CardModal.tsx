import { useEffect, useMemo, useState } from "react";
import {
  cardSchema,
  SchemaError,
  validatePatch,
  type CardProps,
} from "../../shared/schema";
import type { Board, Card, PropsPatch } from "../../shared/types";
import { api } from "../api";
import { TagChip } from "./BoardView";
import { Markdown } from "./Markdown";

interface Props {
  board: Board;
  card: Card;
  /** Full-window layout with editor and preview side by side. Same state, different layout. */
  full: boolean;
  onToggleFull: () => void;
  onClose: () => void;
  onChanged: () => void;
  onError: (err: unknown) => void;
}

export function CardModal({
  board,
  card,
  full,
  onToggleFull,
  onClose,
  onChanged,
  onError,
}: Props) {
  const [name, setName] = useState(card.name);
  const [tags, setTags] = useState(card.props.tags.join(" "));
  // The picker edits the date; the time part (usually midnight) is carried over unchanged.
  const [dueDate, setDueDate] = useState(card.props.due?.slice(0, 10) ?? "");
  const dueTime = card.props.due?.slice(10) ?? "T00:00:00";
  const [body, setBody] = useState(card.body);
  const [preview, setPreview] = useState(card.body.trim().length > 0);

  useEffect(() => {
    // In the full view, Escape steps back to the modal (keeping edits) rather than closing.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (full) onToggleFull();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, onToggleFull, onClose]);

  // Validate with the same schema the server enforces, so problems show before saving.
  const patch = useMemo((): {
    props?: PropsPatch<CardProps>;
    error?: string;
  } => {
    const tagList = tags
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((t) => t.replace(/^#/, ""));
    // Only send what was edited: an untouched field must not clear a value the form can't
    // show, such as an invalid `due` that's being preserved in `extra`.
    const props: PropsPatch<CardProps> = {};
    if (tagList.join(" ") !== card.props.tags.join(" ")) props.tags = tagList;
    const due = dueDate ? `${dueDate}${dueTime}` : undefined;
    if (due !== card.props.due) props.due = due ?? null;
    try {
      validatePatch(cardSchema, props);
      return { props };
    } catch (err) {
      return { error: err instanceof SchemaError ? err.message : String(err) };
    }
  }, [tags, dueDate, dueTime, card.props]);

  async function save() {
    if (!patch.props) return;
    try {
      await api.updateCard(board.path, card.name, {
        name: name.trim(),
        props: patch.props,
        body,
      });
      onChanged();
      onClose();
    } catch (err) {
      onError(err);
    }
  }

  async function remove() {
    if (
      !confirm(`Delete "${card.name}"? This removes the file from the vault.`)
    )
      return;
    try {
      await api.deleteCard(board.path, card.name);
      onChanged();
      onClose();
    } catch (err) {
      onError(err);
    }
  }

  const extras = Object.entries(card.extra);

  const editor = (
    <textarea
      className="body-editor"
      value={body}
      onChange={(e) => setBody(e.target.value)}
      autoFocus
      placeholder="Markdown. [[Links]] to other cards work."
    />
  );
  const rendered = (
    <div className="body-preview">
      {body.trim() ? (
        <Markdown source={body} />
      ) : (
        <p className="muted">Empty</p>
      )}
    </div>
  );

  return (
    <div
      className={full ? "modal-backdrop full" : "modal-backdrop"}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={full ? "modal full" : "modal"}
        role="dialog"
        aria-label={card.name}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
      >
        <div className="modal-header">
          <input
            className="title-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Title"
          />
          <button
            className="ghost view-toggle"
            onClick={onToggleFull}
            aria-pressed={full}
            title={full ? "Back to the card (Esc)" : "Expand editor"}
            aria-label={full ? "Collapse editor" : "Expand editor"}
          >
            {full ? "⤡" : "⤢"}
          </button>
        </div>
        <p className="file-path">
          {card.path}
          {card.props.created &&
            ` · Created ${card.props.created.replace("T", " ")}`}
          {card.props.updatedAt &&
            ` · Updated ${card.props.updatedAt.replace("T", " ")}`}
        </p>

        {card.issues.length > 0 && (
          <div className="issues" role="status">
            <strong>This file has invalid properties.</strong> Saving will
            rewrite them in the expected form where that's possible; anything
            else is kept as-is below.
            <ul>
              {card.issues.map((issue) => (
                <li key={issue.property}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="fields">
          <label>
            Tags
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="bug frontend"
            />
          </label>
          <label>
            Due
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>
        {patch.error ? (
          <p className="field-error">{patch.error}</p>
        ) : (
          (patch.props?.tags ?? card.props.tags).length > 0 && (
            <div className="card-meta">
              {(patch.props?.tags ?? card.props.tags).map((tag) => (
                <TagChip key={tag} tag={tag} />
              ))}
            </div>
          )
        )}

        {!full && extras.length > 0 && (
          <dl className="other-props" title="Other properties are kept as-is">
            {extras.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {full ? (
          <div className="body-split">
            {editor}
            {rendered}
          </div>
        ) : (
          <>
            <div className="body-tabs">
              <button
                className={preview ? "" : "active"}
                onClick={() => setPreview(false)}
              >
                Edit
              </button>
              <button
                className={preview ? "active" : ""}
                onClick={() => setPreview(true)}
              >
                Preview
              </button>
            </div>
            {preview ? rendered : editor}
          </>
        )}

        <footer className="modal-footer">
          <button className="danger" onClick={remove}>
            Delete
          </button>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={!patch.props}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
