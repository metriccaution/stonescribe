import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  (await vault.getBoard(board)).columns.find((c) => c.name === column)!.cards.map((c) => c.name);

describe("boards", () => {
  it("discovers boards anywhere in the vault by their self-named note", async () => {
    await write("Work/Projects/Projects.md", "---\nkanban: board\n---\n");
    await write("Home/Home.md", "---\nkanban: board\n---\n");
    await write("Notes/Notes.md", "---\ntags: [x]\n---\n"); // folder note, but not a board
    await write(".obsidian/Hidden/Hidden.md", "---\nkanban: board\n---\n");

    expect(await vault.listBoards()).toEqual([
      { path: "Home", name: "Home" },
      { path: "Work/Projects", name: "Projects" },
    ]);
  });

  it("creates a board with self-named folder notes for each default column", async () => {
    await vault.createBoard("Projects");
    expect(await read("Projects/Projects.md")).toContain("kanban: board");
    expect(await read("Projects/Todo/Todo.md")).toBe("---\norder: 1\n---\n");
    expect((await vault.getBoard("Projects")).columns.map((c) => c.name)).toEqual(["Todo", "Doing", "Done"]);
  });

  it("refuses paths that escape the vault", async () => {
    await expect(vault.getBoard("../etc")).rejects.toMatchObject({ status: 400 });
  });
});

describe("columns", () => {
  beforeEach(() => vault.createBoard("B"));

  it("orders columns by their note's `order`, then puts note-less folders last", async () => {
    await mkdir(path.join(root, "B/Backlog"));
    expect((await vault.getBoard("B")).columns.map((c) => c.name)).toEqual(["Todo", "Doing", "Done", "Backlog"]);
  });

  it("renames the folder and keeps the column note self-named", async () => {
    await vault.updateColumn("B", "Doing", { name: "In Progress" });
    expect(await read("B/In Progress/In Progress.md")).toBe("---\norder: 2\n---\n");
  });

  it("reorders by rewriting only the column notes that changed", async () => {
    await vault.reorderColumns("B", ["Done", "Doing", "Todo"]);
    expect(await read("B/Done/Done.md")).toBe("---\norder: 1\n---\n");
    expect(await read("B/Doing/Doing.md")).toBe("---\norder: 2\n---\n");
    expect(await read("B/Todo/Todo.md")).toBe("---\norder: 3\n---\n");
  });

  it("won't delete a column that still has cards", async () => {
    await vault.createCard("B", "Todo", { name: "Task" });
    await expect(vault.deleteColumn("B", "Todo")).rejects.toMatchObject({ status: 409 });
  });
});

describe("updatedAt", () => {
  const updatedAt = async (rel: string) => (await read(rel)).match(/updatedAt: (.*)/)?.[1];

  beforeEach(async () => {
    await vault.createBoard("B");
    for (const name of ["A", "B1", "C"]) await vault.createCard("B", "Todo", { name });
    at("10:00:00");
  });

  it("is set with `created` when a card is made", async () => {
    expect(await read("B/Todo/A.md")).toContain(`created: ${NOW}\nupdatedAt: ${NOW}\n`);
  });

  it("is bumped by edits to properties or body", async () => {
    await vault.updateCard("B", "Todo", "A", { body: "New body" });
    expect(await updatedAt("B/Todo/A.md")).toBe("2026-11-03T10:00:00");
    at("11:00:00");
    await vault.updateCard("B", "Todo", "A", { props: { tags: ["x"] } });
    expect(await updatedAt("B/Todo/A.md")).toBe("2026-11-03T11:00:00");
  });

  it("is not bumped, and the file not rewritten, by a save that changes nothing", async () => {
    const before = await read("B/Todo/A.md");
    await vault.updateCard("B", "Todo", "A", { props: { tags: [] }, body: "" });
    expect(await read("B/Todo/A.md")).toBe(before);
  });

  it("is bumped by a rename", async () => {
    await vault.updateCard("B", "Todo", "A", { name: "Renamed" });
    expect(await updatedAt("B/Todo/Renamed.md")).toBe("2026-11-03T10:00:00");
  });

  it("is bumped for a card moved to another column, but not for cards renumbered around it", async () => {
    await vault.createCard("B", "Doing", { name: "X" });
    at("10:30:00");
    await vault.moveCard("B", "Todo", "A", "Doing", 0);
    expect(await read("B/Doing/X.md")).toContain("order: 2"); // renumbered...
    expect(await updatedAt("B/Doing/X.md")).toBe("2026-11-03T10:00:00"); // ...but not bumped
    expect(await updatedAt("B/Doing/A.md")).toBe("2026-11-03T10:30:00");
  });

  it("is not bumped by reordering within a column", async () => {
    await vault.moveCard("B", "Todo", "C", "Todo", 0);
    for (const name of ["A", "B1", "C"]) expect(await updatedAt(`B/Todo/${name}.md`)).toBe(NOW);
  });
});

describe("noteIndex", () => {
  it("marks which notes are cards and where they live", async () => {
    await vault.createBoard("B");
    await vault.createCard("B", "Todo", { name: "Task" });
    await write("Notes/Idea.md", "");
    const index = await vault.noteIndex();
    expect(index).toContainEqual({ name: "Task", path: "B/Todo/Task.md", card: { board: "B", column: "Todo" } });
    expect(index).toContainEqual({ name: "Idea", path: "Notes/Idea.md" });
    expect(index).toContainEqual({ name: "Todo", path: "B/Todo/Todo.md" });
  });
});

describe("cards", () => {
  beforeEach(() => vault.createBoard("B"));

  it("excludes the column note and orders cards by `order`", async () => {
    await write("B/Todo/Second.md", "---\norder: 2\n---\n");
    await write("B/Todo/First.md", "---\norder: 1\n---\n");
    await write("B/Todo/Unordered.md", "no frontmatter");
    expect(await cardNames("B", "Todo")).toEqual(["First", "Second", "Unordered"]);
  });

  it("rejects names that clash with any note in the vault, case-insensitively", async () => {
    await write("Elsewhere/Fix login.md", "");
    await expect(vault.createCard("B", "Todo", { name: "fix LOGIN" })).rejects.toMatchObject({ status: 409 });
    await expect(vault.createCard("B", "Todo", { name: "Done" })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects characters Obsidian can't link to", async () => {
    await expect(vault.createCard("B", "Todo", { name: "a/b" })).rejects.toMatchObject({ status: 400 });
    await expect(vault.createCard("B", "Todo", { name: "a#b" })).rejects.toMatchObject({ status: 400 });
  });

  it("moves a card across columns and renumbers only what changed", async () => {
    await vault.createCard("B", "Todo", { name: "A" });
    await vault.createCard("B", "Doing", { name: "X" });
    await vault.createCard("B", "Doing", { name: "Y" });
    const before = await read("B/Doing/X.md");

    await vault.moveCard("B", "Todo", "A", "Doing", 1);

    expect(await cardNames("B", "Todo")).toEqual([]);
    expect(await cardNames("B", "Doing")).toEqual(["X", "A", "Y"]);
    expect(await read("B/Doing/X.md")).toBe(before);
  });

  it("reorders within a column", async () => {
    for (const name of ["A", "B1", "C"]) await vault.createCard("B", "Todo", { name });
    await vault.moveCard("B", "Todo", "C", "Todo", 0);
    expect(await cardNames("B", "Todo")).toEqual(["C", "A", "B1"]);
  });

  it("preserves the body and unknown frontmatter when editing", async () => {
    await write("B/Todo/Task.md", "---\norder: 1\nobsidianUIMode: preview\n---\nBody\n");
    await vault.updateCard("B", "Todo", "Task", { props: { tags: ["bug"] } });
    expect(await read("B/Todo/Task.md")).toBe(
      `---\norder: 1\nobsidianUIMode: preview\ntags:\n  - bug\nupdatedAt: ${NOW}\n---\nBody\n`,
    );
  });

  it("writes required properties on create", async () => {
    await vault.createCard("B", "Todo", { name: "New", props: { due: "2026-12-01T00:00:00" } });
    expect(await read("B/Todo/New.md")).toBe(
      `---\ntags: []\ncreated: ${NOW}\nupdatedAt: ${NOW}\ndue: 2026-12-01T00:00:00\norder: 1\n---\n`,
    );
  });

  it("backfills required properties on any write to a card made outside the app", async () => {
    await write("B/Todo/External.md", "Just a body");
    await vault.moveCard("B", "Todo", "External", "Doing", 0);
    expect(await read("B/Doing/External.md")).toBe(`---\ntags: []\norder: 1\nupdatedAt: ${NOW}\n---\nJust a body`);
  });

  it("reports invalid values on read and keeps them on unrelated writes", async () => {
    await write("B/Todo/Bad.md", "---\ntags: 5\ndue: next week\n---\n");
    const card = (await vault.getBoard("B")).columns[0]!.cards[0]!;
    expect(card.issues.map((i) => i.property)).toEqual(["tags", "due"]);

    await vault.updateCard("B", "Todo", "Bad", { body: "Edited" });
    expect(await read("B/Todo/Bad.md")).toBe(`---\ntags:\n  - "5"\ndue: next week\nupdatedAt: ${NOW}\n---\nEdited`);

    await vault.updateCard("B", "Todo", "Bad", { props: { due: null } });
    expect(await read("B/Todo/Bad.md")).toBe(`---\ntags:\n  - "5"\nupdatedAt: ${NOW}\n---\nEdited`);
  });

  it("rejects invalid property updates without touching the file", async () => {
    await vault.createCard("B", "Todo", { name: "Task" });
    const before = await read("B/Todo/Task.md");
    await expect(
      vault.updateCard("B", "Todo", "Task", { name: "Renamed", props: { tags: 5 as never } }),
    ).rejects.toThrow(/tags/);
    expect(await read("B/Todo/Task.md")).toBe(before);
  });

  it("renames a card and rewrites wikilinks to it across the vault", async () => {
    await vault.createCard("B", "Todo", { name: "Old" });
    await write("Daily/2026-11-03.md", "See [[Old]], [[old|alias]], [[B/Todo/Old#Notes]] and [[Older]].");

    await vault.updateCard("B", "Todo", "Old", { name: "New" });

    expect(await cardNames("B", "Todo")).toEqual(["New"]);
    expect(await read("Daily/2026-11-03.md")).toBe(
      "See [[New]], [[New|alias]], [[B/Todo/New#Notes]] and [[Older]].",
    );
  });
});
