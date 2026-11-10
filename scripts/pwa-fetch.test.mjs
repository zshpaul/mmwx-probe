import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const handlers = new Map();
let network = () => Promise.resolve(Response.json({ name: "ZSH" }));
let cacheReads = 0;
let cacheWrites = 0;
runInNewContext(source, {
  URL, Response,
  self: { location: { origin: "https://probe.example" }, addEventListener: (name, handler) => handlers.set(name, handler) },
  fetch: request => network(request),
  caches: {
    open: async () => ({ put: async () => { cacheWrites++; } }),
    match: async () => { cacheReads++; return Response.json({ name: "Old cached name" }); },
  },
});
async function request(path = "/manifest.json") {
  let response;
  handlers.get("fetch")({
    request: { url: `https://probe.example${path}`, method: "GET", mode: "cors" },
    respondWith: result => { response = result; },
  });
  return response;
}
assert.deepEqual(await (await request()).json(), { name: "ZSH" });
assert.equal(cacheReads, 0, "Successful manifest fetch must not use old cache");
await Promise.resolve();
assert.equal(cacheWrites, 1);
network = async () => { throw new Error("Offline"); };
assert.deepEqual(await (await request()).json(), { name: "Old cached name" });
assert.equal(cacheReads, 1, "Offline fallback can retain old metadata");
network = async () => new Response("not found", { status: 404 });
assert.equal((await request()).status, 404);
assert.equal(cacheReads, 1, "HTTP failure must not turn into app-shell HTML");
assert.equal(await request("/api/probe"), undefined);
