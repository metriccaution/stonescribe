import express, { type NextFunction, type Request, type Response } from "express";
import { SchemaError } from "../shared/schema.js";
import { Vault, VaultError } from "./vault.js";
import type { VaultWatcher } from "./watch.js";

export function createApp(vault: Vault, watcher?: VaultWatcher): express.Express {
  const app = express();
  app.use(express.json());

  const board = (req: Request): string => {
    const value = req.query.board;
    if (typeof value !== "string") throw new VaultError(400, "Missing ?board= query parameter");
    return value;
  };
  const param = (req: Request, name: string): string => String(req.params[name]);

  app.get("/api/boards", async (_req, res) => {
    res.json(await vault.listBoards());
  });

  app.post("/api/boards", async (req, res) => {
    res.status(201).json(await vault.createBoard(req.body.name, req.body.parent));
  });

  app.get("/api/notes", async (_req, res) => {
    res.json(await vault.noteIndex());
  });

  app.get("/api/board", async (req, res) => {
    res.json(await vault.getBoard(board(req)));
  });

  app.patch("/api/board", async (req, res) => {
    await vault.updateBoard(board(req), req.body);
    res.status(204).end();
  });

  app.post("/api/board/columns", async (req, res) => {
    await vault.createColumn(board(req), req.body.name);
    res.status(201).end();
  });

  app.put("/api/board/columns/order", async (req, res) => {
    await vault.reorderColumns(board(req), req.body.names);
    res.status(204).end();
  });

  app.patch("/api/board/columns/:column", async (req, res) => {
    await vault.updateColumn(board(req), param(req, "column"), req.body);
    res.status(204).end();
  });

  app.delete("/api/board/columns/:column", async (req, res) => {
    await vault.deleteColumn(board(req), param(req, "column"));
    res.status(204).end();
  });

  app.post("/api/board/columns/:column/cards", async (req, res) => {
    await vault.createCard(board(req), param(req, "column"), req.body);
    res.status(201).end();
  });

  app.patch("/api/board/columns/:column/cards/:card", async (req, res) => {
    await vault.updateCard(board(req), param(req, "column"), param(req, "card"), req.body);
    res.status(204).end();
  });

  app.delete("/api/board/columns/:column/cards/:card", async (req, res) => {
    await vault.deleteCard(board(req), param(req, "column"), param(req, "card"));
    res.status(204).end();
  });

  app.post("/api/board/columns/:column/cards/:card/move", async (req, res) => {
    const { toColumn, index } = req.body;
    await vault.moveCard(board(req), param(req, "column"), param(req, "card"), toColumn, index);
    res.status(204).end();
  });

  // Server-sent events: one "change" message whenever something in the vault changes on disk.
  app.get("/api/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
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
