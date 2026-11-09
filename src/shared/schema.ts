/**
 * Typed views over the frontmatter properties Stonescribe owns.
 *
 * Reading is lenient: a missing required property gets its default, and an invalid value is
 * reported as an {@link Issue} (with a best-effort coerced value where one is unambiguous).
 * Writing is strict: {@link validatePatch} rejects anything that doesn't match the schema.
 * Properties outside the schema are never interpreted, only carried through untouched.
 */
import type { Frontmatter } from "./types.js";

export interface Issue {
  property: string;
  message: string;
}

export class SchemaError extends Error {}

type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; fallback?: T };

interface Field<T> {
  parse(value: unknown): Parsed<T>;
}

/** Required properties declare a default; optional ones don't. */
export type SchemaFor<P> = {
  [K in keyof P]-?: Field<Exclude<P[K], undefined>> &
    (undefined extends P[K]
      ? { default?: undefined }
      : { default: () => P[K] });
};

// ---------------------------------------------------------------------------------------------
// Field types

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(error: string, fallback?: T): Parsed<T> => ({
  ok: false,
  error,
  fallback,
});

/** Tags are non-empty, contain no whitespace or commas, and are written without a leading "#". */
const TAG = /^[^\s#,][^\s,]*$/;

const tagList: Field<string[]> = {
  parse(value) {
    if (
      Array.isArray(value) &&
      value.every((t) => typeof t === "string" && TAG.test(t))
    ) {
      return ok(value as string[]);
    }
    const error =
      "must be a list of tags (text without spaces or commas, no leading #)";
    const items = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[,\s]+/)
        : [value];
    const coerced = items
      .filter((t) => typeof t === "string" || typeof t === "number")
      .map((t) => String(t).replace(/^#+/, "").trim())
      .filter((t) => TAG.test(t));
    return fail(error, items.length > 0 ? coerced : undefined);
  },
};

/** A local date-time with no time zone, e.g. 2025-01-22T00:00:00. */
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

const dateTime: Field<string> = {
  parse(value) {
    if (typeof value === "string" && isValidDateTime(value)) return ok(value);
    const error = "must be a date-time like 2025-01-22T00:00:00";
    // Shorter forms are unambiguous: a bare date means midnight, and HH:MM means HH:MM:00.
    if (typeof value === "string") {
      for (const candidate of [`${value}T00:00:00`, `${value}:00`]) {
        if (isValidDateTime(candidate)) return fail(error, candidate);
      }
    }
    return fail(error);
  },
};

function isValidDateTime(value: string): boolean {
  const m = DATE_TIME.exec(value);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // Round-trip through Date to reject values it would silently roll over, like Feb 30.
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}

/** Formats a Date as a local, zone-less date-time, the form `created`, `updatedAt` and `due` use. */
export function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

const finiteNumber: Field<number> = {
  parse: (value) =>
    typeof value === "number" && Number.isFinite(value)
      ? ok(value)
      : fail("must be a number"),
};

const positiveInteger: Field<number> = {
  parse: (value) =>
    typeof value === "number" && Number.isInteger(value) && value > 0
      ? ok(value)
      : fail("must be a whole number above 0"),
};

const nonEmptyString: Field<string> = {
  parse: (value) =>
    typeof value === "string" && value.trim()
      ? ok(value)
      : fail("must be non-empty text"),
};

const stringMap: Field<Record<string, string>> = {
  parse(value) {
    const isMap =
      typeof value === "object" && value !== null && !Array.isArray(value);
    if (isMap && Object.values(value).every((v) => typeof v === "string")) {
      return ok(value as Record<string, string>);
    }
    return fail(
      "must be a map of names to text values",
      isMap
        ? Object.fromEntries(
            Object.entries(value).filter(([, v]) => typeof v === "string"),
          )
        : undefined,
    );
  },
};

const literal = <T extends string>(expected: T): Field<T> => ({
  parse: (value) =>
    value === expected ? ok(expected) : fail(`must be "${expected}"`),
});

// ---------------------------------------------------------------------------------------------
// Note kinds

export interface CardProps {
  tags: string[];
  /** Name of the column the card is in. Cards without one are in the board's default column. */
  column?: string;
  created?: string;
  /** Set by the app whenever the card is edited, renamed or moved to another column. */
  updatedAt?: string;
  due?: string;
  order?: number;
}

export const cardSchema: SchemaFor<CardProps> = {
  tags: { ...tagList, default: () => [] },
  column: nonEmptyString,
  created: dateTime,
  updatedAt: dateTime,
  due: dateTime,
  order: finiteNumber,
};

/**
 * A folder path relative to the board's folder, using "/" (e.g. "Tasks" or "Work/Cards"). It
 * can't be absolute, climb out with "..", or go into a dot-folder, where cards would be ignored.
 */
const boardDirectory: Field<string> = {
  parse(value) {
    const error =
      'must be a folder inside the board, like "Tasks" (not absolute, no "..", no dot-folders)';
    if (typeof value !== "string" || !value.trim()) return fail(error);
    if (/^([\\/]|[A-Za-z]:)/.test(value)) return fail(error);
    const segments = value.split(/[\\/]/).filter((s) => s !== "" && s !== ".");
    if (segments.some((s) => s.startsWith("."))) return fail(error);
    return ok(value);
  },
};

export const DEFAULT_COLUMNS = ["Todo", "Doing", "Done"];

/** A flat list of unique, non-empty column names, so any frontmatter editor can change it. */
const columnList: Field<string[]> = {
  parse(value) {
    const items = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
    const valid: string[] = [];
    for (const item of items) {
      const name =
        typeof item === "string" || typeof item === "number"
          ? String(item).trim()
          : "";
      if (name && !valid.includes(name)) valid.push(name);
    }
    const isValid =
      Array.isArray(value) &&
      valid.length === value.length &&
      value.every((item, i) => item === valid[i]);
    if (isValid && valid.length > 0) return ok(valid);
    return fail(
      "must be a list of unique, non-empty column names",
      valid.length > 0 ? valid : undefined,
    );
  },
};

export interface BoardProps {
  kanban: "board";
  /** Column names, in display order. */
  columns: string[];
  /**
   * Where notes without a `column` property go. When it isn't set, those notes aren't cards, so
   * the board's folder can hold other notes too.
   */
  defaultColumn?: string;
  /** Folder, relative to the board's, where new cards are created. Defaults to the board's folder. */
  defaultDirectory?: string;
}

export const boardSchema: SchemaFor<BoardProps> = {
  kanban: { ...literal("board"), default: () => "board" as const },
  columns: { ...columnList, default: () => [...DEFAULT_COLUMNS] },
  defaultColumn: nonEmptyString,
  defaultDirectory: boardDirectory,
};

// ---------------------------------------------------------------------------------------------
// Operations

export interface Read<P> {
  props: P;
  /** Properties outside the schema, plus invalid values that couldn't be safely coerced. */
  extra: Frontmatter;
  issues: Issue[];
}

export function readProps<P>(
  schema: SchemaFor<P>,
  frontmatter: Frontmatter,
): Read<P> {
  const props: Record<string, unknown> = {};
  const extra: Frontmatter = {};
  const issues: Issue[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!(key in schema)) extra[key] = value;
  }
  for (const [key, field] of Object.entries(schema) as [
    string,
    Field<unknown> & { default?: () => unknown },
  ][]) {
    const value = frontmatter[key];
    if (value === undefined || value === null) {
      if (field.default) props[key] = field.default();
      continue;
    }
    const parsed = field.parse(value);
    if (parsed.ok) {
      props[key] = parsed.value;
      continue;
    }
    issues.push({ property: key, message: `"${key}" ${parsed.error}` });
    if (parsed.fallback !== undefined) props[key] = parsed.fallback;
    else {
      // Keep the original on disk rather than lose what the user wrote.
      extra[key] = value;
      if (field.default) props[key] = field.default();
    }
  }
  return { props: props as P, extra, issues };
}

/**
 * Validates a partial update. `null` clears an optional property; required properties can't be
 * cleared. Unknown keys are rejected so typos don't silently become new properties.
 */
export function validatePatch<P>(
  schema: SchemaFor<P>,
  patch: unknown,
): Partial<P> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new SchemaError("Properties must be an object");
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const field = (
      schema as Record<string, Field<unknown> & { default?: () => unknown }>
    )[key];
    if (!field) throw new SchemaError(`Unknown property "${key}"`);
    if (value === null || value === undefined) {
      if (field.default) throw new SchemaError(`"${key}" is required`);
      result[key] = undefined;
      continue;
    }
    const parsed = field.parse(value);
    if (!parsed.ok) throw new SchemaError(`"${key}" ${parsed.error}`);
    result[key] = parsed.value;
  }
  return result as Partial<P>;
}

/**
 * Merges typed props with preserved extras into the frontmatter to write; schema keys go first.
 * A key present in `props` (even as `undefined`, meaning "cleared") wins over the same key in
 * `extra`, so setting or clearing a property also replaces an invalid value kept from disk.
 */
export function toFrontmatter<P extends object>(
  props: P,
  extra: Frontmatter,
): Frontmatter {
  const out: Frontmatter = {};
  for (const [key, value] of Object.entries(props))
    if (value !== undefined) out[key] = value;
  for (const [key, value] of Object.entries(extra))
    if (!(key in props)) out[key] = value;
  return out;
}
