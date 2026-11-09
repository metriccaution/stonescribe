import { isDeepStrictEqual } from "node:util";
import { Document, parseDocument } from "yaml";
import type { Frontmatter } from "../shared/types.js";

// Opening fence, YAML (possibly empty), closing fence. Anchored to the start of the file.
const FENCE = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

export interface Note {
  frontmatter: Frontmatter;
  body: string;
}

export function parseNote(raw: string): Note {
  const match = FENCE.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };
  const data: unknown = parseDocument(match[1] ?? "").toJS();
  return {
    frontmatter: isPlainObject(data) ? data : {},
    body: raw.slice(match[0].length),
  };
}

/**
 * Rewrites a note so its frontmatter equals `frontmatter` and (optionally) its body equals
 * `body`. Keys whose values are unchanged are left untouched in the YAML source, so comments,
 * quoting and key order written by Obsidian or by hand survive the edit.
 */
export function writeNote(
  raw: string,
  frontmatter: Frontmatter,
  body?: string,
): string {
  const match = FENCE.exec(raw);
  const parsed = parseDocument(match?.[1] ?? "");
  const current: unknown = parsed.toJS();
  const existing = isPlainObject(current) ? current : {};
  // Frontmatter that isn't a map (empty, a bare scalar, a list) is replaced wholesale.
  const doc: Document = isPlainObject(current) ? parsed : new Document({});

  for (const key of Object.keys(existing)) {
    if (!(key in frontmatter)) doc.delete(key);
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) doc.delete(key);
    else if (!isDeepStrictEqual(existing[key], value)) doc.set(key, value);
  }

  const newBody = body ?? (match ? raw.slice(match[0].length) : raw);
  const hasKeys = Object.keys(doc.toJS() ?? {}).length > 0;
  if (!hasKeys) return newBody;
  return `---\n${doc.toString({ lineWidth: 0 })}---\n${newBody}`;
}

function isPlainObject(value: unknown): value is Frontmatter {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
