import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vault } from "./vault.js";

let root: string;
let vault: Vault;

const NOW = "2026-11-03T09:00:00";
const at = (time: string) => vi.setSystemTime(new Date(`2026-11-03T${time}`));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  root = await mkdtemp(path.join(tmpdir(), "stonescribe-"));
  vault = new Vault(root);
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

const read = (rel: string) => readFile(path.join(root, rel), "utf8");
const write = async (rel: string, content: string) => {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content);
};
const cardNames = async (board: string, column: string) =>
  (await vault.getBoard(board)).columns
    .find((c) => c.name === column)!
    .cards.map((c) => c.name);

describe("boards", () => {
  it("discovers boards anywhere in the vault by a note with `kanban: board`, whatever its name", async () => {
    await write("Work/Projects/Projects.md", "---\nkanban: board\n---\n");
    await write("Home/Chores board.md", "---\nkanban: board\n---\n");
    await write("Notes/Notes.md", "---\ntags: [x]\n---\n"); // folder note, but not a board
    await write(".obsidian/Hidden/Hidden.md", "---\nkanban: board\n---\n");
    await write("Work/Projects/Inner/Inner.md", "---\nkanban: board\n---\n"); // boards don't nest

    expect(await vault.listBoards()).toEqual([
      { path: "Home", name: "Chores board" },
      { path: "Work/Projects", name: "Projects" },
    ]);
  });

  it("uses any-named board notes and never treats a board note as a card", async () => {
    await write(
      "Chores/Board.md",
      "---\nkanban: board\ncolumns: [Todo]\ndefaultColumn: Todo\n---\n",
    );
    await write("Chores/Dishes.md", "");
    await write("Chores/Inner/Inner.md", "---\nkanban: board\n---\n");
    const board = await vault.getBoard("Chores");
    expect(board).toMatchObject({
      path: "Chores",
      name: "Board",
      note: "Chores/Board.md",
      issues: [],
    });
    expect(await cardNames("Chores", "Todo")).toEqual(["Dishes"]);

    await vault.createColumn("Chores", "Done");
    expect(await read("Chores/Board.md")).toContain(
      "columns:\n  - Todo\n  - Done\n",
    );
  });

  it("flags several board notes in one folder and uses the first by name", async () => {
    await write("X/b.md", "---\nkanban: board\ncolumns: [B]\n---\n");
    await write("X/a.md", "---\nkanban: board\ncolumns: [A]\n---\n");
    const board = await vault.getBoard("X");
    expect(board.note).toBe("X/a.md");
    expect(board.columns.map((c) => c.name)).toEqual(["A"]);
    expect(board.issues.map((i) => i.property)).toEqual(["kanban"]);
  });

  it("404s for a folder with no board note", async () => {
    await write("Notes/Notes.md", "");
    await expect(vault.getBoard("Notes")).rejects.toMatchObject({
      status: 404,
    });
    await expect(vault.getBoard("Missing")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("creates a board note listing the default columns, with no column folders", async () => {
    await vault.createBoard("Projects");
    expect(await read("Projects/Projects.md")).toBe(
      "---\nkanban: board\ncolumns:\n  - Todo\n  - Doing\n  - Done\n---\n",
    );
    expect(await readdir(path.join(root, "Projects"))).toEqual(["Projects.md"]);
    expect(
      (await vault.getBoard("Projects")).columns.map((c) => c.name),
    ).toEqual(["Todo", "Doing", "Done"]);
  });

  it("refuses paths that escape the vault", async () => {
    await expect(vault.getBoard("../etc")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("reads columns from a flat list in frontmatter", async () => {
    await write(
      "B/B.md",
      "---\nkanban: board\ncolumns:\n  - Backlog\n  - Doing\ndefaultColumn: Doing\n---\n",
    );
    const board = await vault.getBoard("B");
    expect(board.columns.map(({ cards: _, ...c }) => c)).toEqual([
      { name: "Backlog", isDefault: false },
      { name: "Doing", isDefault: true },
    ]);
    expect(board.issues).toEqual([]);
  });

  it("flags an unknown defaultColumn and treats it as unset", async () => {
    await write(
      "B/B.md",
      "---\nkanban: board\ncolumns: [A, B]\ndefaultColumn: C\n---\n",
    );
    await write("B/Loose.md", "");
    const board = await vault.getBoard("B");
    expect(board.columns.map((c) => [c.isDefault, c.cards.length])).toEqual([
      [false, 0],
      [false, 0],
    ]);
    expect(board.issues.map((i) => i.property)).toEqual(["defaultColumn"]);
  });

  it("rejects a defaultColumn that isn't one of the columns", async () => {
    await vault.createBoard("B");
    await expect(
      vault.updateBoard("B", { props: { defaultColumn: "Nope" } }),
    ).rejects.toMatchObject({ status: 400 });
    await vault.updateBoard("B", { props: { defaultColumn: "Doing" } });
    expect(
      (await vault.getBoard("B")).columns.find((c) => c.isDefault)?.name,
    ).toBe("Doing");
  });
});

describe("cards", () => {
  // Most tests here use the convenient mode, where notes without a `column` are cards in Todo.
  beforeEach(async () => {
    await vault.createBoard("B");
    await vault.updateBoard("B", { props: { defaultColumn: "Todo" } });
  });

  it("finds cards anywhere under the board folder, at any depth", async () => {
    await write("B/Top.md", "---\ncolumn: Doing\n---\n");
    await write("B/Docs/Nested.md", "---\ncolumn: Done\n---\n");
    await write("B/Docs/Deeper/Deepest.md", "");
    await write("B/.obsidian/Hidden.md", "");
    await write("Elsewhere/Not a card.md", "---\ncolumn: Todo\n---\n");

    expect(await cardNames("B", "Todo")).toEqual(["Deepest"]);
    expect(await cardNames("B", "Doing")).toEqual(["Top"]);
    expect(await cardNames("B", "Done")).toEqual(["Nested"]);
    const done = (await vault.getBoard("B")).columns[2]!.cards[0]!;
    expect(done.path).toBe("B/Docs/Nested.md");
  });

  it("puts notes with no column in the default column", async () => {
    await vault.updateBoard("B", { props: { defaultColumn: "Done" } });
    await write("B/Loose.md", "no frontmatter");
    expect(await cardNames("B", "Done")).toEqual(["Loose"]);
  });

  it("ignores notes with no column when there's no default column", async () => {
    await vault.updateBoard("B", { props: { defaultColumn: null } });
    await write("B/Card.md", "---\ncolumn: Doing\n---\n");
    await write("B/Meeting notes.md", "---\ntags: [meeting]\n---\n");
    await write("B/Null.md", "---\ncolumn:\n---\n");
    const board = await vault.getBoard("B");
    expect(
      board.columns.flatMap((c) => c.cards.map((card) => card.name)),
    ).toEqual(["Card"]);
    expect(
      (await vault.noteIndex()).find((n) => n.name === "Meeting notes"),
    ).toEqual({
      name: "Meeting notes",
      path: "B/Meeting notes.md",
    });
    await expect(vault.deleteCard("B", "Meeting notes")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("still shows a card with an invalid column when there's no default, in the first column", async () => {
    await vault.updateBoard("B", { props: { defaultColumn: null } });
    await write("B/Typo.md", "---\ncolumn: Doign\n---\n");
    await write("B/Number.md", "---\ncolumn: 5\n---\n");
    const cards = (await vault.getBoard("B")).columns[0]!.cards;
    expect(cards.map((c) => [c.name, c.issues.map((i) => i.property)])).toEqual(
      [
        ["Number", ["column"]],
        ["Typo", ["column"]],
      ],
    );
  });

  it("flags a card whose column doesn't exist and shows it in the default column", async () => {
    await write("B/Lost.md", "---\ncolumn: Archive\n---\n");
    const card = (await vault.getBoard("B")).columns[0]!.cards[0]!;
    expect(card.name).toBe("Lost");
    expect(card.issues.map((i) => i.property)).toEqual(["column"]);
  });

  it("orders cards by `order`", async () => {
    await write("B/Second.md", "---\norder: 2\n---\n");
    await write("B/sub/First.md", "---\norder: 1\n---\n");
    await write("B/Unordered.md", "no frontmatter");
    expect(await cardNames("B", "Todo")).toEqual([
      "First",
      "Second",
      "Unordered",
    ]);
  });

  it("writes required properties and the column on create, in the board folder", async () => {
    await vault.createCard("B", "Doing", {
      name: "New",
      props: { due: "2026-12-01T00:00:00" },
    });
    expect(await read("B/New.md")).toBe(
      `---\ntags: []\ncolumn: Doing\ncreated: ${NOW}\nupdatedAt: ${NOW}\ndue: 2026-12-01T00:00:00\norder: 1\n---\n`,
    );
  });

  it("creates cards in defaultDirectory, making the folder if needed", async () => {
    await vault.updateBoard("B", { props: { defaultDirectory: "Work/Cards" } });
    await vault.createCard("B", "Doing", { name: "Filed" });
    expect(await read("B/Work/Cards/Filed.md")).toContain("column: Doing");
    expect((await vault.getBoard("B")).columns[1]!.cards[0]!.path).toBe(
      "B/Work/Cards/Filed.md",
    );
  });

  it("rejects a defaultDirectory outside the board, and won't create cards while one is set", async () => {
    for (const bad of ["../Elsewhere", "/abs", "Tasks/../../x", ".hidden"]) {
      await expect(
        vault.updateBoard("B", { props: { defaultDirectory: bad } }),
      ).rejects.toThrow(/defaultDirectory/);
    }
    await write(
      "B/B.md",
      "---\nkanban: board\ncolumns: [Todo]\ndefaultDirectory: ../Elsewhere\n---\n",
    );
    expect((await vault.getBoard("B")).issues.map((i) => i.property)).toEqual([
      "defaultDirectory",
    ]);
    await expect(
      vault.createCard("B", "Todo", { name: "X" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(readdir(path.join(root, "Elsewhere"))).rejects.toThrow();
  });

  it("refuses to create a card in a column that doesn't exist", async () => {
    await expect(
      vault.createCard("B", "Nope", { name: "X" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects names that clash with any note in the vault, case-insensitively", async () => {
    await write("Elsewhere/Fix login.md", "");
    await expect(
      vault.createCard("B", "Todo", { name: "fix LOGIN" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      vault.createCard("B", "Todo", { name: "B" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects characters Obsidian can't link to", async () => {
    await expect(
      vault.createCard("B", "Todo", { name: "a/b" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      vault.createCard("B", "Todo", { name: "a#b" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("moves a card across columns by its property, leaving the file in place", async () => {
    await vault.createCard("B", "Todo", { name: "A" });
    await vault.createCard("B", "Doing", { name: "X" });
    await vault.createCard("B", "Doing", { name: "Y" });
    await write("B/sub/Z.md", "---\ncolumn: Doing\norder: 3\n---\n");
    const before = await read("B/X.md");

    await vault.moveCard("B", "A", "Doing", 1);

    expect(await cardNames("B", "Todo")).toEqual([]);
    expect(await cardNames("B", "Doing")).toEqual(["X", "A", "Y", "Z"]);
    expect(await read("B/A.md")).toContain("column: Doing");
    expect(await read("B/X.md")).toBe(before);
    expect(await read("B/sub/Z.md")).toBe(
      "---\ncolumn: Doing\norder: 4\ntags: []\n---\n",
    );
  });

  it("reorders within a column", async () => {
    for (const name of ["A", "B1", "C"])
      await vault.createCard("B", "Todo", { name });
    await vault.moveCard("B", "C", "Todo", 0);
    expect(await cardNames("B", "Todo")).toEqual(["C", "A", "B1"]);
  });

  it("doesn't add a column to a card reordered within the default column", async () => {
    await write("B/One.md", "---\norder: 1\n---\n");
    await write("B/Two.md", "---\norder: 2\n---\n");
    await vault.moveCard("B", "Two", "Todo", 0);
    expect(await read("B/Two.md")).toBe("---\norder: 1\ntags: []\n---\n");
  });

  it("fixes an unknown column when the card is dropped somewhere", async () => {
    await write("B/Lost.md", "---\ncolumn: Archive\norder: 1\n---\n");
    await vault.moveCard("B", "Lost", "Todo", 0);
    expect(await read("B/Lost.md")).toBe(
      "---\ncolumn: Todo\norder: 1\ntags: []\n---\n",
    );
  });

  it("backfills required properties on any write to a card made outside the app", async () => {
    await write("B/External.md", "Just a body");
    await vault.moveCard("B", "External", "Doing", 0);
    expect(await read("B/External.md")).toBe(
      `---\ntags: []\ncolumn: Doing\norder: 1\nupdatedAt: ${NOW}\n---\nJust a body`,
    );
  });

  it("refuses an update that points a card at a column that doesn't exist", async () => {
    await vault.createCard("B", "Todo", { name: "Task" });
    await expect(
      vault.updateCard("B", "Task", { props: { column: "Nope" } }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses to guess between two cards with the same name", async () => {
    await write("B/a/Twin.md", "");
    await write("B/b/Twin.md", "");
    const cards = (await vault.getBoard("B")).columns[0]!.cards;
    expect(cards.map((c) => c.issues.map((i) => i.property))).toEqual([
      ["name"],
      ["name"],
    ]);
    await expect(vault.deleteCard("B", "Twin")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("preserves the body and unknown frontmatter when editing", async () => {
    await write(
      "B/Task.md",
      "---\norder: 1\nobsidianUIMode: preview\n---\nBody\n",
    );
    await vault.updateCard("B", "Task", { props: { tags: ["bug"] } });
    expect(await read("B/Task.md")).toBe(
      `---\norder: 1\nobsidianUIMode: preview\ntags:\n  - bug\nupdatedAt: ${NOW}\n---\nBody\n`,
    );
  });

  it("reports invalid values on read and keeps them on unrelated writes", async () => {
    await write("B/Bad.md", "---\ntags: 5\ndue: next week\n---\n");
    const card = (await vault.getBoard("B")).columns[0]!.cards[0]!;
    expect(card.issues.map((i) => i.property)).toEqual(["tags", "due"]);

    await vault.updateCard("B", "Bad", { body: "Edited" });
    expect(await read("B/Bad.md")).toBe(
      `---\ntags:\n  - "5"\ndue: next week\nupdatedAt: ${NOW}\n---\nEdited`,
    );

    await vault.updateCard("B", "Bad", { props: { due: null } });
    expect(await read("B/Bad.md")).toBe(
      `---\ntags:\n  - "5"\nupdatedAt: ${NOW}\n---\nEdited`,
    );
  });

  it("rejects invalid property updates without touching the file", async () => {
    await vault.createCard("B", "Todo", { name: "Task" });
    const before = await read("B/Task.md");
    await expect(
      vault.updateCard("B", "Task", {
        name: "Renamed",
        props: { tags: 5 as never },
      }),
    ).rejects.toThrow(/tags/);
    expect(await read("B/Task.md")).toBe(before);
  });

  it("renames a card in place and rewrites wikilinks to it across the vault", async () => {
    await write("B/sub/Old.md", "");
    await write(
      "Daily/2026-11-03.md",
      "See [[Old]], [[old|alias]], [[B/sub/Old#Notes]] and [[Older]].",
    );

    await vault.updateCard("B", "Old", { name: "New" });

    expect(await read("B/sub/New.md")).toContain("tags: []");
    expect(await read("Daily/2026-11-03.md")).toBe(
      "See [[New]], [[New|alias]], [[B/sub/New#Notes]] and [[Older]].",
    );
  });
});

describe("columns", () => {
  const columns = async () => (await vault.getBoard("B")).props.columns;

  beforeEach(() => vault.createBoard("B"));

  it("adds a column to the end of the list", async () => {
    await vault.createColumn("B", "Review");
    expect(await columns()).toEqual(["Todo", "Doing", "Done", "Review"]);
    await expect(vault.createColumn("B", "Review")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("renames a column, its cards' column property and the default", async () => {
    await vault.updateBoard("B", { props: { defaultColumn: "Todo" } });
    await vault.createCard("B", "Todo", { name: "Named" });
    await write("B/Implicit.md", "---\norder: 2\n---\n");
    at("10:00:00");

    await vault.updateColumn("B", "Todo", { name: "Backlog" });

    expect(await read("B/B.md")).toContain(
      "columns:\n  - Backlog\n  - Doing\n  - Done\n",
    );
    expect(await read("B/B.md")).toContain("defaultColumn: Backlog\n");
    expect(await read("B/Named.md")).toContain(
      `column: Backlog\ncreated: ${NOW}\nupdatedAt: ${NOW}\n`,
    );
    expect(await read("B/Implicit.md")).toBe("---\norder: 2\n---\n");
    expect(await cardNames("B", "Backlog")).toEqual(["Named", "Implicit"]);
  });

  it("reorders by rewriting the list", async () => {
    await vault.reorderColumns("B", ["Done", "Doing", "Todo"]);
    expect(await columns()).toEqual(["Done", "Doing", "Todo"]);
    await expect(
      vault.reorderColumns("B", ["Done", "Doing"]),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("won't delete a column that still has cards, including implicit ones", async () => {
    await vault.updateBoard("B", { props: { defaultColumn: "Todo" } });
    await vault.createCard("B", "Doing", { name: "Task" });
    await expect(vault.deleteColumn("B", "Doing")).rejects.toMatchObject({
      status: 409,
    });
    await write("B/Loose.md", "");
    await expect(vault.deleteColumn("B", "Todo")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("moves the default to the first remaining column when the default is deleted", async () => {
    await vault.updateBoard("B", { props: { defaultColumn: "Todo" } });
    await vault.deleteColumn("B", "Todo");
    expect(await columns()).toEqual(["Doing", "Done"]);
    expect((await vault.getBoard("B")).props.defaultColumn).toBe("Doing");
  });

  it("won't delete the last column", async () => {
    await vault.deleteColumn("B", "Todo");
    await vault.deleteColumn("B", "Doing");
    await expect(vault.deleteColumn("B", "Done")).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("updatedAt", () => {
  const updatedAt = async (rel: string) =>
    (await read(rel)).match(/updatedAt: (.*)/)?.[1];

  beforeEach(async () => {
    await vault.createBoard("B");
    for (const name of ["A", "B1", "C"])
      await vault.createCard("B", "Todo", { name });
    at("10:00:00");
  });

  it("is set with `created` when a card is made", async () => {
    expect(await read("B/A.md")).toContain(
      `created: ${NOW}\nupdatedAt: ${NOW}\n`,
    );
  });

  it("is bumped by edits to properties or body", async () => {
    await vault.updateCard("B", "A", { body: "New body" });
    expect(await updatedAt("B/A.md")).toBe("2026-11-03T10:00:00");
    at("11:00:00");
    await vault.updateCard("B", "A", { props: { tags: ["x"] } });
    expect(await updatedAt("B/A.md")).toBe("2026-11-03T11:00:00");
  });

  it("is not bumped, and the file not rewritten, by a save that changes nothing", async () => {
    const before = await read("B/A.md");
    await vault.updateCard("B", "A", { props: { tags: [] }, body: "" });
    expect(await read("B/A.md")).toBe(before);
  });

  it("is bumped by a rename", async () => {
    await vault.updateCard("B", "A", { name: "Renamed" });
    expect(await updatedAt("B/Renamed.md")).toBe("2026-11-03T10:00:00");
  });

  it("is bumped for a card moved to another column, but not for cards renumbered around it", async () => {
    await vault.createCard("B", "Doing", { name: "X" });
    at("10:30:00");
    await vault.moveCard("B", "A", "Doing", 0);
    expect(await read("B/X.md")).toContain("order: 2"); // renumbered...
    expect(await updatedAt("B/X.md")).toBe("2026-11-03T10:00:00"); // ...but not bumped
    expect(await updatedAt("B/A.md")).toBe("2026-11-03T10:30:00");
  });

  it("is not bumped by reordering within a column", async () => {
    await vault.moveCard("B", "C", "Todo", 0);
    for (const name of ["A", "B1", "C"])
      expect(await updatedAt(`B/${name}.md`)).toBe(NOW);
  });
});

describe("noteIndex", () => {
  it("marks which notes are cards and where they live", async () => {
    await vault.createBoard("B");
    await vault.createCard("B", "Todo", { name: "Task" });
    await write("B/sub/Nested.md", "---\ncolumn: Done\n---\n");
    await write("Notes/Idea.md", "");
    const index = await vault.noteIndex();
    expect(index).toContainEqual({
      name: "Task",
      path: "B/Task.md",
      card: { board: "B", column: "Todo" },
    });
    expect(index).toContainEqual({
      name: "Nested",
      path: "B/sub/Nested.md",
      card: { board: "B", column: "Done" },
    });
    expect(index).toContainEqual({ name: "Idea", path: "Notes/Idea.md" });
    expect(index).toContainEqual({ name: "B", path: "B/B.md" });
  });
});
