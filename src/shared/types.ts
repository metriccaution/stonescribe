import type { BoardProps, CardProps, Issue } from "./schema.js";

/**
 * Arbitrary YAML frontmatter.
 */
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
  /**
   * Vault-relative folder path, e.g. "Work/Projects". Used as the board's id.
   */
  path: string;
  /**
   * The board note's name.
   */
  name: string;
}

export interface Card extends Note<CardProps> {
  /**
   * File name without ".md". Unique across the vault, so it's also the [[link]] target.
   */
  name: string;
  /**
   * Vault-relative path of the note. Cards can live anywhere inside the board's folder.
   */
  path: string;
  /**
   * Body text.
   */
  body: string;
}

/** 
 * A column as listed in the board note's `columns`, with the cards that are in it.
 */
export interface Column {
  name: string;
  /**
   * Cards without a `column` property (or with an unknown one) are shown here.#
   */
  isDefault: boolean;
  cards: Card[];
}

export interface Board extends BoardSummary, Note<BoardProps> {
  /**
   * Vault-relative path of the board note (the one with `kanban: board`).
   */
  note: string;
  description: string;
  columns: Column[];
}

/**
 * Where a [[wikilink]] target lives. `card` is set when the note is a card on a board.
 */
export interface NoteRef {
  name: string;
  path: string;
  card?: { board: string; column: string };
}

/**
 * Property updates. Use `null` to clear an optional property.
 */
export type PropsPatch<P> = { [K in keyof P]?: P[K] | null };

export interface CardUpdate {
  name?: string;
  props?: PropsPatch<CardProps>;
  body?: string;
}

export interface ColumnUpdate {
  name?: string;
}

export interface BoardUpdate {
  props?: PropsPatch<BoardProps>;
  description?: string;
}
