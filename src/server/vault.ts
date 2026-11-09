import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  boardSchema,
  cardSchema,
  DEFAULT_COLUMNS,
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

/**
 * A board is a folder holding a note with `kanban: board`, whatever its name. That note lists the
 * columns; every other markdown file under the folder, at any depth, is a card, and its `column`
 * property says which column it's in.
 */
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
      const [note] = await this.boardNotes(dir);
      if (note) {
        boards.push({
          path: this.relative(dir),
          name: path.basename(note, ".md"),
        });
        return; // Boards don't nest: everything below a board belongs to it.
      }
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !isIgnored(entry.name))
          await visit(path.join(dir, entry.name));
      }
    };
    await visit(this.root);
    return boards.sort((a, b) => a.path.localeCompare(b.path));
  }

  async getBoard(boardPath: string): Promise<Board> {
    const dir = this.resolve(boardPath);
    const [noteFile, ...others] = await this.boardNotes(dir);
    if (!noteFile) throw new VaultError(404, `No board at "${boardPath}"`);
    const note = parseNote(await readFile(noteFile, "utf8"));
    const { props, extra, issues } = readProps(boardSchema, note.frontmatter);
    if (others.length > 0) {
      issues.push({
        property: "kanban",
        message: `Other notes in this folder also have "kanban: board" (${others.map((f) => path.basename(f)).join(", ")}); using ${path.basename(noteFile)}`,
      });
    }

    const names = props.columns;
    const listed = `one of the board's columns (${names.join(", ")})`;
    // `defaultColumn` opts in to treating notes without a `column` as cards. Without it (or if it
    // names a missing column) those notes are ignored, so the folder can hold other notes too.
    let defaultColumn = props.defaultColumn;
    if (defaultColumn !== undefined && !names.includes(defaultColumn)) {
      issues.push({
        property: "defaultColumn",
        message: `"defaultColumn" must be ${listed}`,
      });
      defaultColumn = undefined;
    }
    // Where a card with an invalid or unknown `column` is shown, so a typo doesn't hide it.
    const fallback = defaultColumn ?? names[0]!;

    const columns: Column[] = names.map((name) => ({
      name,
      isDefault: name === defaultColumn,
      cards: [],
    }));
    const byName = new Map(columns.map((c) => [c.name, c]));
    const cards = (await this.readCards(dir)).filter(
      (card) =>
        defaultColumn !== undefined ||
        card.props.column !== undefined ||
        "column" in card.extra,
    );
    const nameCounts = new Map<string, number>();
    for (const card of cards)
      nameCounts.set(card.name, (nameCounts.get(card.name) ?? 0) + 1);

    for (const card of cards) {
      const named = card.props.column;
      const column = byName.get(named ?? defaultColumn ?? "");
      // An invalid value (say `column: 5`) already has an issue from the schema.
      if (named !== undefined && !column) {
        card.issues.push({
          property: "column",
          message: `"column" must be ${listed}; shown in ${fallback}`,
        });
      }
      if (nameCounts.get(card.name)! > 1) {
        card.issues.push({
          property: "name",
          message: `Another note on this board is also named "${card.name}"`,
        });
      }
      (column ?? byName.get(fallback)!).cards.push(card);
    }
    for (const column of columns) sortByOrder(column.cards);

    return {
      path: this.relative(dir),
      name: path.basename(noteFile, ".md"),
      note: this.relative(noteFile),
      props,
      extra,
      issues,
      description: note.body,
      columns,
    };
  }

  async createBoard(name: string, parentPath = ""): Promise<BoardSummary> {
    validateName(name);
    const dir = path.join(this.resolve(parentPath), name);
    await this.assertNameAvailable(name);
    if (await exists(dir))
      throw new VaultError(409, `A folder named "${name}" already exists`);

    await mkdir(dir, { recursive: true });
    await writeTyped(folderNotePath(dir), boardSchema, {
      columns: [...DEFAULT_COLUMNS],
    });
    return { path: this.relative(dir), name };
  }

  async updateBoard(boardPath: string, update: BoardUpdate): Promise<void> {
    const board = await this.getBoard(boardPath);
    const patch = validatePatch(boardSchema, update.props ?? {});
    if (patch.columns !== undefined || patch.defaultColumn !== undefined) {
      const names = patch.columns ?? board.props.columns;
      const fallback =
        "defaultColumn" in patch
          ? patch.defaultColumn
          : board.props.defaultColumn;
      if (fallback !== undefined && !names.includes(fallback)) {
        throw new VaultError(
          400,
          `"defaultColumn" must be one of the board's columns (${names.join(", ")})`,
        );
      }
    }
    await writeTyped(
      this.boardNote(board),
      boardSchema,
      update.props ?? {},
      update.description,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Columns: entries in the board note's `columns` list

  async createColumn(boardPath: string, name: string): Promise<void> {
    validateColumnName(name);
    const board = await this.getBoard(boardPath);
    if (board.columns.some((c) => c.name === name))
      throw new VaultError(409, `Column "${name}" already exists`);
    await writeTyped(this.boardNote(board), boardSchema, {
      columns: [...board.props.columns, name],
    });
  }

  async updateColumn(
    boardPath: string,
    name: string,
    update: ColumnUpdate,
  ): Promise<void> {
    const board = await this.getBoard(boardPath);
    const column = findColumn(board, name);
    const newName = update.name ?? name;
    const renaming = newName !== name;
    if (renaming) {
      validateColumnName(newName);
      if (board.columns.some((c) => c.name === newName)) {
        throw new VaultError(409, `Column "${newName}" already exists`);
      }
    }
    if (!renaming) return;

    const columns = board.props.columns.map((c) => (c === name ? newName : c));
    await writeTyped(this.boardNote(board), boardSchema, {
      columns,
      ...(board.props.defaultColumn === name && { defaultColumn: newName }),
    });

    // Cards that name the column follow it. This isn't an edit of the card, so `updatedAt` stays.
    for (const card of column.cards) {
      if (card.props.column === name)
        await writeTyped(this.resolve(card.path), cardSchema, {
          column: newName,
        });
    }
  }

  async deleteColumn(boardPath: string, name: string): Promise<void> {
    const board = await this.getBoard(boardPath);
    const column = findColumn(board, name);
    if (column.cards.length > 0) {
      throw new VaultError(
        409,
        `Column "${name}" still has ${column.cards.length} card(s)`,
      );
    }
    if (board.columns.length === 1)
      throw new VaultError(409, "A board needs at least one column");

    const columns = board.props.columns.filter((c) => c !== name);
    await writeTyped(this.boardNote(board), boardSchema, {
      columns,
      // The default column moves to the new first column rather than pointing at nothing.
      ...(board.props.defaultColumn === name && { defaultColumn: columns[0]! }),
    });
  }

  /** Persists a new column order by rewriting the board note's `columns` list. */
  async reorderColumns(boardPath: string, names: string[]): Promise<void> {
    const board = await this.getBoard(boardPath);
    const known = new Set(board.props.columns);
    if (
      !Array.isArray(names) ||
      names.length !== known.size ||
      !names.every((n) => known.has(n))
    ) {
      throw new VaultError(
        400,
        "Column list must contain each existing column exactly once",
      );
    }
    await writeTyped(this.boardNote(board), boardSchema, { columns: names });
  }

  // ---------------------------------------------------------------------------------------------
  // Cards

  /** Creates a card note in the board's folder, at the end of `column`. */
  async createCard(
    boardPath: string,
    column: string,
    card: { name: string; props?: PropsPatch<CardProps>; body?: string },
  ): Promise<void> {
    validateName(card.name);
    const board = await this.getBoard(boardPath);
    const target = findColumn(board, column);
    await this.assertNameAvailable(card.name);

    const dir = await this.newCardDir(board);
    const { column: _ignored, ...props } = card.props ?? {};
    const now = formatDateTime(new Date());
    await writeTyped(
      path.join(dir, `${card.name}.md`),
      cardSchema,
      {
        column,
        created: now,
        updatedAt: now,
        ...props,
        order: nextOrder(target.cards),
      },
      card.body ?? "",
    );
  }

  async updateCard(
    boardPath: string,
    cardName: string,
    update: CardUpdate,
  ): Promise<void> {
    const board = await this.getBoard(boardPath);
    const file = this.resolve(findCard(board, cardName).path);
    if (typeof update.props?.column === "string")
      findColumn(board, update.props.column, 400);

    let target = file;
    if (update.name !== undefined && update.name !== cardName) {
      validateName(update.name);
      // A case-only rename is fine: the only "clash" is the card itself.
      if (update.name.toLowerCase() !== cardName.toLowerCase()) {
        await this.assertNameAvailable(update.name);
      }
      target = path.join(path.dirname(file), `${update.name}.md`);
    }

    // Validate and write before renaming, so a bad property doesn't leave a half-applied update.
    // A rename always counts as an edit; otherwise `updatedAt` only moves if the file changes.
    const updatedAt = formatDateTime(new Date());
    const renaming = target !== file;
    await writeTyped(
      file,
      cardSchema,
      { ...update.props, ...(renaming && { updatedAt }) },
      update.body,
      {
        updatedAt,
      },
    );
    if (renaming) {
      await rename(file, target);
      await this.rewriteLinks(cardName, update.name!);
    }
  }

  /**
   * Moves a card to `index` within `toColumn` (which may be its current column) by setting its
   * `column` property; the file stays where it is. Renumbers `order` on only the cards in the
   * target column whose position actually changed. Moving to another column counts as editing the
   * card; renumbering and reordering within a column don't.
   */
  async moveCard(
    boardPath: string,
    cardName: string,
    toColumn: string,
    index: number,
  ): Promise<void> {
    const board = await this.getBoard(boardPath);
    const moved = findCard(board, cardName);
    const target = findColumn(board, toColumn);
    const changedColumn = !target.cards.includes(moved);
    // Also fixes a card that's only in the default column because its `column` is unknown.
    const setColumn =
      changedColumn ||
      (moved.props.column !== undefined && moved.props.column !== toColumn);

    const cards = target.cards.filter((c) => c !== moved);
    cards.splice(Math.max(0, Math.min(index, cards.length)), 0, moved);

    const updatedAt = formatDateTime(new Date());
    for (const [i, card] of cards.entries()) {
      const isMoved = card === moved;
      if (card.props.order !== i + 1 || (isMoved && setColumn)) {
        await writeTyped(this.resolve(card.path), cardSchema, {
          ...(isMoved && setColumn && { column: toColumn }),
          order: i + 1,
          ...(isMoved && changedColumn && { updatedAt }),
        });
      }
    }
  }

  async deleteCard(boardPath: string, cardName: string): Promise<void> {
    const board = await this.getBoard(boardPath);
    await rm(this.resolve(findCard(board, cardName).path));
  }

  // ---------------------------------------------------------------------------------------------
  // Links

  /** Every note in the vault, so the client can resolve [[wikilinks]] by name. */
  async noteIndex(): Promise<NoteRef[]> {
    const cards = new Map<string, { board: string; column: string }>();
    for (const summary of await this.listBoards()) {
      const board = await this.getBoard(summary.path);
      for (const column of board.columns) {
        for (const card of column.cards)
          cards.set(card.path, { board: board.path, column: column.name });
      }
    }
    return (await this.markdownFiles()).map((file) => {
      const rel = this.relative(file);
      const card = cards.get(rel);
      return {
        name: path.basename(file, ".md"),
        path: rel,
        ...(card && { card }),
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Internals

  /** Every markdown note under the board's folder, at any depth, except board notes. */
  private async readCards(boardDir: string): Promise<Card[]> {
    const cards: Card[] = [];
    for (const file of await this.markdownFiles(boardDir)) {
      const { frontmatter, body } = parseNote(await readFile(file, "utf8"));
      if (isBoardNote(frontmatter)) continue;
      cards.push({
        name: path.basename(file, ".md"),
        path: this.relative(file),
        ...readProps(cardSchema, frontmatter),
        body,
      });
    }
    return cards;
  }

  /** Notes directly in `dir` with `kanban: board`, sorted by file name. The first one is used. */
  private async boardNotes(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return [];
      throw err;
    }
    const notes: string[] = [];
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".md") ||
        isIgnored(entry.name)
      )
        continue;
      const file = path.join(dir, entry.name);
      if (isBoardNote(parseNote(await readFile(file, "utf8")).frontmatter))
        notes.push(file);
    }
    return notes.sort();
  }

  /** Where new cards go: the board's `defaultDirectory` (created if needed), or its folder. */
  private async newCardDir(board: Board): Promise<string> {
    const issue = board.issues.find((i) => i.property === "defaultDirectory");
    if (issue)
      throw new VaultError(
        400,
        `Can't create cards: the board's ${issue.message}`,
      );
    const boardDir = this.resolve(board.path);
    const relative = board.props.defaultDirectory;
    if (relative === undefined) return boardDir;
    const dir = path.resolve(boardDir, relative);
    // The schema already rules this out; checked again because it guards a write.
    if (dir !== boardDir && !dir.startsWith(boardDir + path.sep)) {
      throw new VaultError(
        400,
        '"defaultDirectory" must be inside the board folder',
      );
    }
    await mkdir(dir, { recursive: true });
    return dir;
  }

  private boardNote(board: Board): string {
    return this.resolve(board.note);
  }

  /**
   * [[Wikilinks]] resolve by note name (case-insensitively in most tools), so card and board
   * names must be unique across the whole vault, not just the board.
   */
  private async assertNameAvailable(name: string): Promise<void> {
    const wanted = `${name}.md`.toLowerCase();
    const clash = (await this.markdownFiles()).find(
      (f) => path.basename(f).toLowerCase() === wanted,
    );
    if (clash) {
      throw new VaultError(
        409,
        `A note named "${name}" already exists at ${this.relative(clash)}`,
      );
    }
  }

  /** Updates [[Old]], [[Old|alias]], [[Old#heading]] and [[some/path/Old]] across the vault. */
  private async rewriteLinks(oldName: string, newName: string): Promise<void> {
    const pattern = new RegExp(
      `(\\[\\[(?:[^\\]|#^]*/)?)${escapeRegExp(oldName)}(?=[\\]|#^])`,
      "gi",
    );
    for (const file of await this.markdownFiles()) {
      const raw = await readFile(file, "utf8");
      const next = raw.replace(pattern, `$1${newName.replaceAll("$", "$$$$")}`);
      if (next !== raw) await writeFile(file, next);
    }
  }

  private async markdownFiles(from = this.root): Promise<string[]> {
    const files: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (isIgnored(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(full);
        else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
      }
    };
    await visit(from);
    return files.sort();
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

function findColumn(
  board: Board,
  name: string,
  status: 400 | 404 = 404,
): Column {
  const column = board.columns.find((c) => c.name === name);
  if (!column) throw new VaultError(status, `No column "${name}"`);
  return column;
}

function findCard(board: Board, name: string): Card {
  validateName(name);
  const matches = board.columns.flatMap((c) =>
    c.cards.filter((card) => card.name === name),
  );
  if (matches.length === 0) throw new VaultError(404, `No card "${name}"`);
  if (matches.length > 1) {
    throw new VaultError(
      409,
      `Several notes on this board are named "${name}": ${matches.map((c) => c.path).join(", ")}`,
    );
  }
  return matches[0]!;
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
  if (touch)
    out = writeNote(
      source,
      toFrontmatter({ ...next, ...validatePatch(schema, touch) }, extra),
      body,
    );
  await writeFile(file, out);
}

function isBoardNote(frontmatter: Record<string, unknown>): boolean {
  return frontmatter.kanban === "board";
}

/** New boards get a note named after their folder; existing ones can name it anything. */
function folderNotePath(dir: string): string {
  return path.join(dir, `${path.basename(dir)}.md`);
}

/** Dot-folders (.obsidian, .trash, .git) and dependency folders are never part of a board. */
function isIgnored(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

function validateName(name: string): void {
  if (typeof name !== "string" || !name.trim() || name !== name.trim()) {
    throw new VaultError(
      400,
      "Name must be non-empty with no leading/trailing spaces",
    );
  }
  if (FORBIDDEN_NAME_CHARS.test(name) || name.startsWith(".")) {
    throw new VaultError(
      400,
      `"${name}" contains characters that aren't allowed in note names`,
    );
  }
}

/** Columns aren't files, so any trimmed, non-empty name works. */
function validateColumnName(name: string): void {
  if (typeof name !== "string" || !name.trim() || name !== name.trim()) {
    throw new VaultError(
      400,
      "Column name must be non-empty with no leading/trailing spaces",
    );
  }
}

function nextOrder(items: { props: { order?: number } }[]): number {
  return Math.max(0, ...items.map((i) => i.props.order ?? 0)) + 1;
}

/** Items with a numeric `order` come first, ascending; the rest follow alphabetically. */
function sortByOrder<T extends { name: string; props: { order?: number } }>(
  items: T[],
): T[] {
  return items.sort((a, b) => {
    const ao = a.props.order ?? Infinity;
    const bo = b.props.order ?? Infinity;
    return ao !== bo ? ao - bo : a.name.localeCompare(b.name);
  });
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
