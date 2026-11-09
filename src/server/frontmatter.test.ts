import { describe, expect, it } from "vitest";
import { parseNote, writeNote } from "./frontmatter.js";

describe("parseNote", () => {
  it("splits frontmatter from body", () => {
    expect(
      parseNote("---\ntags:\n  - bug\ndue: 2026-11-10\n---\nHello\n"),
    ).toEqual({
      frontmatter: { tags: ["bug"], due: "2026-11-10" },
      body: "Hello\n",
    });
  });

  it("treats a note without frontmatter as all body", () => {
    expect(parseNote("# Title\n---\nnot: frontmatter\n")).toEqual({
      frontmatter: {},
      body: "# Title\n---\nnot: frontmatter\n",
    });
  });

  it("handles an empty frontmatter block", () => {
    expect(parseNote("---\n---\nBody")).toEqual({
      frontmatter: {},
      body: "Body",
    });
  });
});

describe("writeNote", () => {
  it("preserves comments, unknown keys and untouched formatting", () => {
    const raw = '---\n# set by a plugin\naliases: ["x"]\norder: 1\n---\nBody\n';
    const out = writeNote(raw, { aliases: ["x"], order: 2 });
    expect(out).toBe(
      '---\n# set by a plugin\naliases: [ "x" ]\norder: 2\n---\nBody\n',
    );
  });

  it("removes keys absent from the new frontmatter", () => {
    expect(writeNote("---\na: 1\nb: 2\n---\n", { a: 1 })).toBe(
      "---\na: 1\n---\n",
    );
  });

  it("adds frontmatter to a plain note", () => {
    expect(writeNote("Body", { order: 1 })).toBe("---\norder: 1\n---\nBody");
  });

  it("drops the block entirely when no keys remain", () => {
    expect(writeNote("---\na: 1\n---\nBody", {})).toBe("Body");
  });

  it("replaces the body when given one", () => {
    expect(writeNote("---\na: 1\n---\nOld", { a: 1 }, "New")).toBe(
      "---\na: 1\n---\nNew",
    );
  });
});
