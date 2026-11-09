import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { Vault } from "./vault.js";
import { VaultWatcher } from "./watch.js";

const vaultPath = process.argv[2] ?? process.env.STONESCRIBE_VAULT;
if (!vaultPath) {
  console.error(
    "Usage: stonescribe <path-to-vault>  (or set STONESCRIBE_VAULT)",
  );
  process.exit(1);
}
if (!existsSync(vaultPath)) {
  console.error(`Vault not found: ${vaultPath}`);
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";

const vault = new Vault(vaultPath);
const watcher = new VaultWatcher(vault.root);
const app = createApp(vault, watcher);

// In production, serve the built client from dist/client.
const clientDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../client",
);
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get(/^(?!\/api\/).*/, (_req, res) =>
    res.sendFile(path.join(clientDir, "index.html")),
  );
}

const server = app.listen(port, host, () => {
  console.log(
    `Stonescribe serving vault ${vault.root} on http://${host}:${port}`,
  );
});

const shutdown = (signal: string) => {
  console.log(`Received ${signal}, shutting down`);
  watcher.close();
  server.close(() => process.exit(0));
  // Open event streams (/api/events) never end on their own.
  server.closeAllConnections();
  setTimeout(() => process.exit(1), 5000).unref();
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
