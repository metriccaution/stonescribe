import type { CardProps } from "../shared/schema";
import type {
  Board,
  BoardSummary,
  BoardUpdate,
  CardUpdate,
  ColumnUpdate,
  NoteRef,
  PropsPatch,
} from "../shared/types";

async function request<T = void>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `${method} ${url} failed (${res.status})`);
  }
  return res.headers.get("content-type")?.includes("json") ? res.json() : (undefined as T);
}

const q = (board: string) => `?board=${encodeURIComponent(board)}`;
const col = (column: string) => `/api/board/columns/${encodeURIComponent(column)}`;
const card = (column: string, name: string) => `${col(column)}/cards/${encodeURIComponent(name)}`;

export const api = {
  listBoards: () => request<BoardSummary[]>("GET", "/api/boards"),
  createBoard: (name: string) => request<BoardSummary>("POST", "/api/boards", { name }),
  getBoard: (board: string) => request<Board>("GET", `/api/board${q(board)}`),
  updateBoard: (board: string, update: BoardUpdate) => request("PATCH", `/api/board${q(board)}`, update),
  listNotes: () => request<NoteRef[]>("GET", "/api/notes"),

  createColumn: (board: string, name: string) =>
    request("POST", `/api/board/columns${q(board)}`, { name }),
  updateColumn: (board: string, column: string, update: ColumnUpdate) =>
    request("PATCH", `${col(column)}${q(board)}`, update),
  deleteColumn: (board: string, column: string) => request("DELETE", `${col(column)}${q(board)}`),
  reorderColumns: (board: string, names: string[]) =>
    request("PUT", `/api/board/columns/order${q(board)}`, { names }),

  createCard: (board: string, column: string, name: string, props?: PropsPatch<CardProps>) =>
    request("POST", `${col(column)}/cards${q(board)}`, { name, props }),
  updateCard: (board: string, column: string, name: string, update: CardUpdate) =>
    request("PATCH", `${card(column, name)}${q(board)}`, update),
  deleteCard: (board: string, column: string, name: string) =>
    request("DELETE", `${card(column, name)}${q(board)}`),
  moveCard: (board: string, column: string, name: string, toColumn: string, index: number) =>
    request("POST", `${card(column, name)}/move${q(board)}`, { toColumn, index }),
};

const NAMED_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray"];

/** Named colours map to theme-aware tokens; anything else is passed through as CSS. */
export function cssColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return NAMED_COLORS.includes(color) ? `var(--c-${color})` : color;
}
