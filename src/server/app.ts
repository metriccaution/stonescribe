import { access, constants } from "node:fs/promises";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { SchemaError } from "../shared/schema.js";
import { Vault, VaultError } from "./vault.js";
import type { VaultWatcher } from "./watch.js";

const boardIdFromReq = (req: Request): string => {
  const value = req.query.board;
  if (typeof value !== "string")
    throw new VaultError(400, "Missing ?board= query parameter");
  return value;
};

const param = (req: Request, name: string): string => String(req.params[name]);

export function createApp(
  vault: Vault,
  watcher?: VaultWatcher,
): express.Express {
  const app = express();
  app.use(express.json());

  // Liveness/readiness probe (used by the Docker HEALTHCHECK): cheap, and fails if the vault
  // is no longer readable and writable (e.g. a volume that went away).
  app.get("/api/health", async (_req, res) => {
    try {
      await access(vault.root, constants.R_OK | constants.W_OK);
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable", error: "Vault is not accessible" });
    }
  });

  app.get("/api/boards", async (_req, res) => {
    res.json(await vault.listBoards());
  });

  app.post("/api/boards", async (req, res) => {
    res
      .status(201)
      .json(await vault.createBoard(req.body.name, req.body.parent));
  });

  app.get("/api/notes", async (_req, res) => {
    res.json(await vault.noteIndex());
  });

  app.get("/api/board", async (req, res) => {
    res.json(await vault.getBoard(boardIdFromReq(req)));
  });

  app.patch("/api/board", async (req, res) => {
    await vault.updateBoard(boardIdFromReq(req), req.body);
    res.status(204).end();
  });

  app.post("/api/board/columns", async (req, res) => {
    await vault.createColumn(boardIdFromReq(req), req.body.name);
    res.status(201).end();
  });

  app.put("/api/board/columns/order", async (req, res) => {
    await vault.reorderColumns(boardIdFromReq(req), req.body.names);
    res.status(204).end();
  });

  app.patch("/api/board/columns/:column", async (req, res) => {
    await vault.updateColumn(
      boardIdFromReq(req),
      param(req, "column"),
      req.body,
    );
    res.status(204).end();
  });

  app.delete("/api/board/columns/:column", async (req, res) => {
    await vault.deleteColumn(boardIdFromReq(req), param(req, "column"));
    res.status(204).end();
  });

  app.post("/api/board/columns/:column/cards", async (req, res) => {
    await vault.createCard(boardIdFromReq(req), param(req, "column"), req.body);
    res.status(201).end();
  });

  // Cards are addressed by name alone: they can live anywhere in the board's folder, and the
  // column is just a property.
  app.patch("/api/board/cards/:card", async (req, res) => {
    await vault.updateCard(boardIdFromReq(req), param(req, "card"), req.body);
    res.status(204).end();
  });

  app.delete("/api/board/cards/:card", async (req, res) => {
    await vault.deleteCard(boardIdFromReq(req), param(req, "card"));
    res.status(204).end();
  });

  app.post("/api/board/cards/:card/move", async (req, res) => {
    const { toColumn, index } = req.body;
    await vault.moveCard(
      boardIdFromReq(req),
      param(req, "card"),
      toColumn,
      index,
    );
    res.status(204).end();
  });

  // Server-sent events: one "change" message whenever something in the vault changes on disk.
  app.get("/api/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    res.write(": connected\n\n");
    const unsubscribe = watcher?.subscribe(() => res.write("data: change\n\n"));
    req.on("close", () => unsubscribe?.());
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof VaultError) {
      res.status(err.status).json({ error: err.message });
    } else if (err instanceof SchemaError) {
      res.status(400).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return app;
}
