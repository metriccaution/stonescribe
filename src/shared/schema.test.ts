import { describe, expect, it } from "vitest";
import {
  boardSchema,
  cardSchema,
  formatDateTime,
  readProps,
  SchemaError,
  toFrontmatter,
  validatePatch,
} from "./schema";

describe("readProps", () => {
  it("defaults required properties and separates unknown keys", () => {
    expect(
      readProps(cardSchema, { due: "2026-11-10T00:00:00", aliases: ["x"] }),
    ).toEqual({
      props: { tags: [], due: "2026-11-10T00:00:00" },
      extra: { aliases: ["x"] },
      issues: [],
    });
  });

  it("flags a non-list tags value and coerces it where unambiguous", () => {
    expect(readProps(cardSchema, { tags: 5 })).toMatchObject({
      props: { tags: ["5"] },
      extra: {},
    });
    expect(readProps(cardSchema, { tags: "#bug, ui" }).props.tags).toEqual([
      "bug",
      "ui",
    ]);
    expect(readProps(cardSchema, { tags: [2026, "ok"] }).issues).toEqual([
      {
        property: "tags",
        message: expect.stringContaining("must be a list of tags"),
      },
    ]);
  });

  it("flags shorter date forms and fills in the missing time", () => {
    expect(readProps(cardSchema, { due: "2025-01-22" })).toMatchObject({
      props: { due: "2025-01-22T00:00:00" },
      issues: [
        {
          property: "due",
          message: expect.stringContaining("2025-01-22T00:00:00"),
        },
      ],
    });
    expect(
      readProps(cardSchema, { created: "2025-01-22T09:30" }).props.created,
    ).toBe("2025-01-22T09:30:00");
  });

  it("keeps an invalid optional value in `extra` rather than discarding it", () => {
    const read = readProps(cardSchema, { due: "next week" });
    expect(read.props).toEqual({ tags: [] });
    expect(read.extra).toEqual({ due: "next week" });
    expect(read.issues).toHaveLength(1);
  });

  it("validates board properties", () => {
    expect(
      readProps(boardSchema, {
        kanban: "board",
        tagColors: { bug: "red", n: 3 },
      }),
    ).toMatchObject({
      props: { kanban: "board", columns: ["Todo", "Doing", "Done"] },
      issues: [],
    });
  });

  it("reads columns as a flat list of names, keeping the usable ones when it isn't clean", () => {
    expect(readProps(boardSchema, { columns: ["A", "B"] })).toMatchObject({
      props: { columns: ["A", "B"] },
      issues: [],
    });
    expect(
      readProps(boardSchema, {
        columns: ["A", "A", { name: "C" }, " D ", "", 2],
      }),
    ).toMatchObject({
      props: { columns: ["A", "D", "2"] },
      issues: [
        {
          property: "columns",
          message: expect.stringContaining(
            "list of unique, non-empty column names",
          ),
        },
      ],
    });
    expect(readProps(boardSchema, { columns: "A, B" }).props.columns).toEqual([
      "A",
      "B",
    ]);
    expect(readProps(boardSchema, { columns: [] })).toMatchObject({
      props: { columns: ["Todo", "Doing", "Done"] },
      extra: { columns: [] },
      issues: [{ property: "columns" }],
    });
  });
});

describe("validatePatch", () => {
  it("accepts valid values and turns null into a clear", () => {
    expect(validatePatch(cardSchema, { tags: ["a"], due: null })).toEqual({
      tags: ["a"],
      due: undefined,
    });
  });

  it.each([
    [{ tags: 5 }, /tags.*list of tags/],
    [{ tags: ["has space"] }, /tags/],
    [{ tags: null }, /"tags" is required/],
    [{ due: "tomorrow" }, /due.*date-time like 2025-01-22T00:00:00/],
    [{ due: "2026-11-10" }, /due.*date-time/],
    [{ due: "2025-02-30T00:00:00" }, /due/],
    [{ due: "2025-01-22T00:00:00Z" }, /due/],
    [{ order: "1" }, /order.*number/],
    [{ colour: "red" }, /Unknown property "colour"/],
  ])("rejects %j", (patch, message) => {
    expect(() => validatePatch(cardSchema, patch)).toThrow(SchemaError);
    expect(() => validatePatch(cardSchema, patch)).toThrow(message);
  });
});

describe("toFrontmatter", () => {
  it("lets an explicitly cleared property drop a preserved invalid value", () => {
    expect(
      toFrontmatter({ tags: [], due: undefined }, { due: "next week", x: 1 }),
    ).toEqual({ tags: [], x: 1 });
    expect(toFrontmatter({ tags: [] }, { due: "next week" })).toEqual({
      tags: [],
      due: "next week",
    });
  });
});

describe("formatDateTime", () => {
  it("formats local time without a zone", () => {
    expect(formatDateTime(new Date(2025, 0, 22, 9, 5, 3))).toBe(
      "2025-01-22T09:05:03",
    );
  });
});
