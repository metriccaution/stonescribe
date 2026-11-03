import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { Vault } from "./vault.js";

let root: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "stonescribe-"));
  const vault = new Vault(root);
  await vault.createBoard("B");
  await vault.createCard("B", "Todo", { name: "Task" });
  app = createApp(vault);
});

afterEach(() => rm(root, { recursive: true, force: true }));

describe("API", () => {
  it("returns typed props and issues for cards", async () => {
    const res = await request(app).get("/api/board?board=B").expect(200);
    expect(res.body.columns[0].cards[0]).toMatchObject({ name: "Task", props: { tags: [] }, extra: {}, issues: [] });
  });

  it("rejects invalid properties with a 400 and a readable message", async () => {
    const res = await request(app)
      .patch("/api/board/columns/Todo/cards/Task?board=B")
      .send({ props: { tags: 5 } })
      .expect(400);
    expect(res.body.error).toMatch(/"tags" must be a list of tags/);
  });
});
