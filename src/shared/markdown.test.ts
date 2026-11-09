import { describe, expect, it } from "vitest";
import { stripFencedBlocks, summaryText } from "./markdown";

describe("stripFencedBlocks", () => {
  it("removes blocks of the listed languages and keeps the rest", () => {
    const src =
      "Intro\n\n```base\nviews:\n  - type: table\n```\n\n```ts\nconst x = 1;\n```\nOutro";
    expect(stripFencedBlocks(src, ["base"])).toBe(
      "Intro\n\n\n```ts\nconst x = 1;\n```\nOutro",
    );
  });

  it("matches the closing fence by marker and length", () => {
    const src = "a\n~~~~base\n```\nstill inside\n~~~~\nb";
    expect(stripFencedBlocks(src, ["base"])).toBe("a\nb");
  });

  it("does not treat a base fence inside another code block as a block", () => {
    const src = "````md\n```base\nx\n```\n````";
    expect(stripFencedBlocks(src, ["base"])).toBe(src);
  });

  it("drops an unclosed block to the end", () => {
    expect(stripFencedBlocks("a\n```base\nx", ["base"])).toBe("a");
  });
});

describe("summaryText", () => {
  it("is empty when the body is only a base", () => {
    expect(summaryText("\n```base\nfilters: []\n```\n")).toBe("");
  });
});
