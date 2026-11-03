import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  boardSchema,
  cardSchema,
  columnSchema,
  formatDateTime,
  readProps,
  toFrontmatter,
  validatePatch,
  type CardProps,
  type SchemaFor,
} from "../shared/schema.js";
import type {
  Board,
  BoardSummary,
  BoardUpdate,
  Card,
  CardUpdate,
  Column,
  ColumnUpdate,
  NoteRef,
  PropsPatch,
} from "../shared/types.js";
import { parseNote, writeNote } from "./frontmatter.js";

const DEFAULT_COLUMNS = ["Todo", "Doing", "Done"];

// Characters that are invalid in file names on common platforms, plus those that break [[wikilinks]].
const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|#^[\]]/;

export class VaultError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export class Vault {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  // ---------------------------------------------------------------------------------------------
  // Boards

  async listBoards(): Promise<BoardSummary[]> {
    const boards: BoardSummary[] = [];
    const visit = async (dir: string): Promise<void> => {
      if (await this.isBoard(dir)) {
        boards.push({ path: this.relative(dir), name: path.basename(dir) });
        return; // Boards don't nest.
      }
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !isIgnored(entry.name)) await visit(path.join(dir, entry.name));
      }
    };
    await visit(this.root);
    return boards.sort((a, b) => a.path.localeCompare(b.path));
  }

  async getBoard(boardPath: string): Promise<Board> {
    const dir = await this.boardDir(boardPath);
    const note = await readNote(folderNotePath(dir));

    const columns: Column[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !isIgnored(entry.name)) {
        columns.push(await this.readColumn(path.join(dir, entry.name)));
      }
    }

    return {
      path: this.relative(dir),
      name: path.basename(dir),
      ...readProps(boardSchema, note?.frontmatter ?? {}),
      description: note?.body ?? "",
      columns: sortByOrder(columns),
    };
  }

  async createBoard(name: string, parentPath = ""): Promise<BoardSummary> {
    validateName(name);
    const dir = path.join(this.resolve(parentPath), name);
    await this.assertNameAvailable(name);
    if (await exists(dir)) throw new VaultError(409, `A folder named "${name}" already exists`);

    await mkdir(dir, { recursive: true });
    await writeTyped(folderNotePath(dir), boardSchema, {});
    for (const [i, column] of DEFAULT_COLUMNS.entries()) {
      await mkdir(path.join(dir, column));
      await writeTyped(folderNotePath(path.join(dir, column)), columnSchema, { order: i + 1 });
    }
    return { path: this.relative(dir), name };
  }

  async updateBoard(boardPath: string, update: BoardUpdate): Promise<void> {
    const dir = await this.boardDir(boardPath);
    await writeTyped(folderNotePath(dir), boardSchema, update.props ?? {}, update.description);
  }

  // ---------------------------------------------------------------------------------------------
  // Columns

  async createColumn(boardPath: string, name: string): Promise<void> {
    validateName(name);
    const board = await this.getBoard(boardPath);
    const dir = path.join(this.resolve(board.path), name);
    if (await exists(dir)) throw new VaultError(409, `Column "${name}" already exists`);

    await mkdir(dir);
    await writeTyped(folderNotePath(dir), columnSchema, { order: nextOrder(board.columns) });
  }

  async updateColumn(boardPath: string, columnName: string, update: ColumnUpdate): Promise<void> {
    let dir = await this.columnDir(boardPath, columnName);

    if (update.name !== undefined && update.name !== columnName) {
      validateName(update.name);
      const target = path.join(path.dirname(dir), update.name);
      if (await exists(target)) throw new VaultError(409, `Column "${update.name}" already exists`);
      await rename(dir, target);
      // Keep the column note self-named.
      const oldNote = path.join(target, `${columnName}.md`);
      if (await exists(oldNote)) await rename(oldNote, folderNotePath(target));
      dir = target;
    }

    if (update.props !== undefined || update.description !== undefined) {
      await writeTyped(folderNotePath(dir), columnSchema, update.props ?? {}, update.description);
    }
  }

  async deleteColumn(boardPath: string, columnName: string): Promise<void> {
    const dir = await this.columnDir(boardPath, columnName);
    const column = await this.readColumn(dir);
    if (column.cards.length > 0) {
      throw new VaultError(409, `Column "${columnName}" still has ${column.cards.length} card(s)`);
    }
    await rm(folderNotePath(dir), { force: true });
    try {
      await rmdir(dir);
    } catch {
      throw new VaultError(409, `Column "${columnName}" contains other files; remove them first`);
    }
  }

  /** Persists a new column order by renumbering `order` on the column notes that changed. */
  async reorderColumns(boardPath: string, names: string[]): Promise<void> {
    const board = await this.getBoard(boardPath);
    const known = new Set(board.columns.map((c) => c.name));
    if (names.length !== known.size || !names.every((n) => known.has(n))) {
      throw new VaultError(400, "Column list must contain each existing column exactly once");
    }
    for (const [i, name] of names.entries()) {
      const column = board.columns.find((c) => c.name === name)!;
      if (column.props.order !== i + 1) {
        await this.updateColumn(board.path, name, { props: { order: i + 1 } });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Cards

  async createCard(
    boardPath: string,
    columnName: string,
    card: { name: string; props?: PropsPatch<CardProps>; body?: string },
  ): Promise<void> {
    validateName(card.name);
    const dir = await this.columnDir(boardPath, columnName);
    await this.assertNameAvailable(card.name);

    const column = await this.readColumn(dir);
    const now = formatDateTime(new Date());
    await writeTyped(
      path.join(dir, `${card.name}.md`),
      cardSchema,
      { created: now, updatedAt: now, ...card.props, order: nextOrder(column.cards) },
      card.body ?? "",
    );
  }

  async updateCard(
    boardPath: string,
    columnName: string,
    cardName: string,
    update: CardUpdate,
  ): Promise<void> {
    const dir = await this.columnDir(boardPath, columnName);
    const file = await this.cardFile(dir, cardName);

    let target = file;
    if (update.name !== undefined && update.name !== cardName) {
      validateName(update.name);
      // A case-only rename is fine: the only "clash" is the card itself.
      if (update.name.toLowerCase() !== cardName.toLowerCase()) {
        await this.assertNameAvailable(update.name);
      }
      target = path.join(dir, `${update.name}.md`);
    }

    // Validate and write before renaming, so a bad property doesn't leave a half-applied update.
    // A rename always counts as an edit; otherwise `updatedAt` only moves if the file changes.
    const updatedAt = formatDateTime(new Date());
    const renaming = target !== file;
    await writeTyped(file, cardSchema, { ...update.props, ...(renaming && { updatedAt }) }, update.body, {
      updatedAt,
    });
    if (renaming) {
      await rename(file, target);
      await this.rewriteLinks(cardName, update.name!);
    }
  }

  /**
   * Moves a card to `index` within `toColumn` (which may be its current column), renumbering
   * `order` on only the cards in the target column whose position actually changed. Moving to
   * another column counts as editing the card; renumbering and reordering within a column don't.
   */
  async moveCard(
    boardPath: string,
    fromColumn: string,
    cardName: string,
    toColumn: string,
    index: number,
  ): Promise<void> {
    const fromDir = await this.columnDir(boardPath, fromColumn);
    const toDir = await this.columnDir(boardPath, toColumn);
    const source = await this.cardFile(fromDir, cardName);

    if (fromDir !== toDir) {
      const target = path.join(toDir, `${cardName}.md`);
      if (await exists(target)) throw new VaultError(409, `"${cardName}" already exists in ${toColumn}`);
      await rename(source, target);
    }

    const { cards: all } = await this.readColumn(toDir);
    const moved = all.find((c) => c.name === cardName)!;
    const cards = all.filter((c) => c !== moved);
    cards.splice(Math.max(0, Math.min(index, cards.length)), 0, moved);

    const updatedAt = formatDateTime(new Date());
    for (const [i, card] of cards.entries()) {
      const changedColumn = card === moved && fromDir !== toDir;
      if (card.props.order !== i + 1 || changedColumn) {
        await writeTyped(path.join(toDir, `${card.name}.md`), cardSchema, {
          order: i + 1,
          ...(changedColumn && { updatedAt }),
        });
      }
    }
  }

  async deleteCard(boardPath: string, columnName: string, cardName: string): Promise<void> {
    const dir = await this.columnDir(boardPath, columnName);
    await rm(await this.cardFile(dir, cardName));
  }

  // ---------------------------------------------------------------------------------------------
  // Links

  /** Every note in the vault, so the client can resolve [[wikilinks]] by name. */
  async noteIndex(): Promise<NoteRef[]> {
    const boards = new Set((await this.listBoards()).map((b) => this.resolve(b.path)));
    return (await this.markdownFiles()).map((file) => {
      const name = path.basename(file, ".md");
      const columnDir = path.dirname(file);
      const boardDir = path.dirname(columnDir);
      const isCard = boards.has(boardDir) && name !== path.basename(columnDir);
      return {
        name,
        path: this.relative(file),
        ...(isCard && { card: { board: this.relative(boardDir), column: path.basename(columnDir) } }),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Internals

  private async readColumn(dir: string): Promise<Column> {
    const name = path.basename(dir);
    const note = await readNote(folderNotePath(dir));
    const cards: Card[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === `${name}.md`) continue;
      const { frontmatter, body } = parseNote(await readFile(path.join(dir, entry.name), "utf8"));
      cards.push({ name: entry.name.slice(0, -3), ...readProps(cardSchema, frontmatter), body });
    }
    return {
      name,
      ...readProps(columnSchema, note?.frontmatter ?? {}),
      description: note?.body ?? "",
      cards: sortByOrder(cards),
    };
  }

  private async isBoard(dir: string): Promise<boolean> {
    const note = await readNote(folderNotePath(dir));
    return note?.frontmatter.kanban === "board";
  }

  private async boardDir(boardPath: string): Promise<string> {
    const dir = this.resolve(boardPath);
    if (!(await this.isBoard(dir))) throw new VaultError(404, `No board at "${boardPath}"`);
    return dir;
  }

  private async columnDir(boardPath: string, columnName: string): Promise<string> {
    validateName(columnName);
    const dir = path.join(await this.boardDir(boardPath), columnName);
    if (!(await exists(dir))) throw new VaultError(404, `No column "${columnName}"`);
    return dir;
  }

  private async cardFile(columnDir: string, cardName: string): Promise<string> {
    validateName(cardName);
    const file = path.join(columnDir, `${cardName}.md`);
    if (cardName === path.basename(columnDir) || !(await exists(file))) {
      throw new VaultError(404, `No card "${cardName}"`);
    }
    return file;
  }

  /**
   * [[Wikilinks]] resolve by note name (case-insensitively in most tools), so card and board
   * names must be unique across the whole vault, not just the board.
   */
  private async assertNameAvailable(name: string): Promise<void> {
    const wanted = `${name}.md`.toLowerCase();
    const clash = (await this.markdownFiles()).find((f) => path.basename(f).toLowerCase() === wanted);
    if (clash) {
      throw new VaultError(409, `A note named "${name}" already exists at ${this.relative(clash)}`);
    }
  }

  /** Updates [[Old]], [[Old|alias]], [[Old#heading]] and [[some/path/Old]] across the vault. */
  private async rewriteLinks(oldName: string, newName: string): Promise<void> {
    const pattern = new RegExp(`(\\[\\[(?:[^\\]|#^]*/)?)${escapeRegExp(oldName)}(?=[\\]|#^])`, "gi");
    for (const file of await this.markdownFiles()) {
      const raw = await readFile(file, "utf8");
      const next = raw.replace(pattern, `$1${newName.replaceAll("$", "$$$$")}`);
      if (next !== raw) await writeFile(file, next);
    }
  }

  private async markdownFiles(): Promise<string[]> {
    const files: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (isIgnored(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(full);
        else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
      }
    };
    await visit(this.root);
    return files;
  }

  /** Resolves a vault-relative path, refusing anything that escapes the vault. */
  private resolve(relativePath: string): string {
    const full = path.resolve(this.root, relativePath);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new VaultError(400, "Path is outside the vault");
    }
    return full;
  }

  private relative(full: string): string {
    return path.relative(this.root, full).split(path.sep).join("/");
  }
}

/**
 * The single write path for notes the app owns: applies a validated patch on top of the note's
 * current properties, fills in defaults for required ones, and carries every other key through.
 * `touch` is applied only if the write changes the file (used to stamp `updatedAt`), and a
 * write that changes nothing leaves the file alone.
 */
async function writeTyped<P extends object>(
  file: string,
  schema: SchemaFor<P>,
  patch: PropsPatch<P>,
  body?: string,
  touch?: PropsPatch<P>,
): Promise<void> {
  const raw = await readFileIfExists(file);
  const source = raw ?? "";
  const { props, extra } = readProps(schema, parseNote(source).frontmatter);
  const next = { ...props, ...validatePatch(schema, patch) };
  let out = writeNote(source, toFrontmatter(next, extra), body);
  if (out === raw) return;
  if (touch) out = writeNote(source, toFrontmatter({ ...next, ...validatePatch(schema, touch) }, extra), body);
  await writeFile(file, out);
}

function folderNotePath(dir: string): string {
  return path.join(dir, `${path.basename(dir)}.md`);
}

/** Dot-folders (.obsidian, .trash, .git) and dependency folders are never part of a board. */
function isIgnored(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

function validateName(name: string): void {
  if (typeof name !== "string" || !name.trim() || name !== name.trim()) {
    throw new VaultError(400, "Name must be non-empty with no leading/trailing spaces");
  }
  if (FORBIDDEN_NAME_CHARS.test(name) || name.startsWith(".")) {
    throw new VaultError(400, `"${name}" contains characters that aren't allowed in note names`);
  }
}

function nextOrder(items: { props: { order?: number } }[]): number {
  return Math.max(0, ...items.map((i) => i.props.order ?? 0)) + 1;
}

/** Items with a numeric `order` come first, ascending; the rest follow alphabetically. */
function sortByOrder<T extends { name: string; props: { order?: number } }>(items: T[]): T[] {
  return items.sort((a, b) => {
    const ao = a.props.order ?? Infinity;
    const bo = b.props.order ?? Infinity;
    return ao !== bo ? ao - bo : a.name.localeCompare(b.name);
  });
}

async function readNote(file: string) {
  const raw = await readFileIfExists(file);
  return raw === undefined ? undefined : parseNote(raw);
}

async function readFileIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
