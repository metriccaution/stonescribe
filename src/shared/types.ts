import type { BoardProps, CardProps, ColumnProps, Issue } from "./schema.js";

/** Arbitrary YAML frontmatter. */
export type Frontmatter = Record<string, unknown>;

/**
 * Every note the app reads is split into the typed properties it owns (`props`), everything
 * else (`extra`, preserved untouched on write), and any problems found with the typed ones.
 */
interface Note<P> {
  props: P;
  extra: Frontmatter;
  issues: Issue[];
}

export interface BoardSummary {
  /** Vault-relative folder path, e.g. "Work/Projects". Used as the board's id. */
  path: string;
  name: string;
}

export interface Card extends Note<CardProps> {
  /** File name without ".md". Unique across the vault, so it's also the [[link]] target. */
  name: string;
  body: string;
}

export interface Column extends Note<ColumnProps> {
  /** Folder name (and the name of its self-named column note). */
  name: string;
  description: string;
  cards: Card[];
}

export interface Board extends BoardSummary, Note<BoardProps> {
  description: string;
  columns: Column[];
}

/** Where a [[wikilink]] target lives. `card` is set when the note is a card on a board. */
export interface NoteRef {
  name: string;
  path: string;
  card?: { board: string; column: string };
}

/** Property updates use `null` to clear an optional property. */
export type PropsPatch<P> = { [K in keyof P]?: P[K] | null };

export interface CardUpdate {
  name?: string;
  props?: PropsPatch<CardProps>;
  body?: string;
}

export interface ColumnUpdate {
  name?: string;
  props?: PropsPatch<ColumnProps>;
  description?: string;
}

export interface BoardUpdate {
  props?: PropsPatch<BoardProps>;
  description?: string;
}
