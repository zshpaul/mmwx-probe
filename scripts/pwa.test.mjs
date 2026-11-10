import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const sw = await readFile(new URL("public/sw.js", root), "utf8");
const shell = runInNewContext(`${sw}\nAPP_SHELL`, { self: { addEventListener() {} } });
for (const path of shell) {
  assert.ok(path.startsWith("/") && !path.includes(".."), `Safe shell path ${path}`);
  const contents = await readFile(new URL(path === "/" ? "index.html" : `public${path}`, root));
  assert.ok(contents.length > 0, `App shell asset exists: ${path}`);
}
const manifest = JSON.parse(await readFile(new URL("public/manifest.json", root), "utf8"));
assert.equal(manifest.name, "ZSH");
assert.equal(manifest.short_name, "ZSH");
assert.equal(manifest.start_url, "/");
assert.equal(manifest.scope, "/");
assert.equal(manifest.display, "standalone");
for (const icon of manifest.icons) {
  const bytes = await readFile(new URL(`public${icon.src}`, root));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  assert.equal(icon.type, "image/png");
  assert.ok(shell.includes(icon.src));
}
const html = await readFile(new URL("index.html", root), "utf8");
for (const name of ["application-name", "apple-mobile-web-app-title"]) {
  assert.ok(html.includes(`name="${name}" content="ZSH"`));
}
