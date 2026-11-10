import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { inflateSync } from "node:zlib";

function decodePng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let header;
  let ended = false;
  const compressed = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, "Complete PNG chunk header");
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    assert.ok(offset + length + 12 <= bytes.length, "PNG chunk length fits file");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    let crc = 0xffffffff;
    for (const value of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(offset + 8 + length), `${kind} CRC`);
    if (kind === "IHDR") {
      assert.equal(offset, 8);
      assert.equal(length, 13);
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), channels: data[9] === 6 ? 4 : 3 };
      assert.equal(data[8], 8, "8-bit samples");
      assert.ok([2, 6].includes(data[9]), "RGB or RGBA");
      assert.deepEqual([...data.subarray(10)], [0, 0, 0], "Standard non-interlaced PNG");
    }
    if (kind === "IDAT") compressed.push(data);
    offset += length + 12;
    if (kind === "IEND") { ended = true; break; }
  }
  assert.ok(header && ended && compressed.length);
  assert.equal(offset, bytes.length);
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = header.width * header.channels;
  assert.equal(raw.length, (stride + 1) * header.height, "Complete decompressed scanlines");
  const pixels = Buffer.alloc(stride * header.height);
  for (let row = 0; row < header.height; row++) {
    const filter = raw[row * (stride + 1)];
    assert.ok(filter <= 4, "Valid PNG scanline filter");
    for (let column = 0; column < stride; column++) {
      const target = row * stride + column;
      const left = column >= header.channels ? pixels[target - header.channels] : 0;
      const up = row ? pixels[target - stride] : 0;
      const corner = row && column >= header.channels ? pixels[target - stride - header.channels] : 0;
      const prediction = left + up - corner;
      const distances = [Math.abs(prediction-left), Math.abs(prediction-up), Math.abs(prediction-corner)];
      const paeth = distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? up : corner;
      const value = [0, left, up, Math.floor((left + up) / 2), paeth][filter];
      pixels[target] = (raw[row * (stride + 1) + column + 1] + value) & 255;
    }
  }
  return header;
}

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
  const decoded = decodePng(bytes);
  assert.equal(`${decoded.width}x${decoded.height}`, icon.sizes);
  const damaged = Buffer.from(bytes);
  damaged[45] ^= 1;
  assert.throws(() => decodePng(damaged), "Corrupt image data must fail even with a valid signature and IHDR");
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  assert.equal(icon.type, "image/png");
  assert.ok(shell.includes(icon.src));
  assert.equal(icon.purpose, icon.src.includes("maskable") ? "maskable" : "any");
}
decodePng(await readFile(new URL("public/icons/apple-touch-icon.png", root)));
const html = await readFile(new URL("index.html", root), "utf8");
for (const name of ["application-name", "apple-mobile-web-app-title"]) {
  assert.ok(html.includes(`name="${name}" content="ZSH"`));
}
for (const size of [192, 512]) {
  assert.ok(html.includes(`rel="icon" type="image/png" sizes="${size}x${size}" href="/icons/icon-${size}.png"`));
}
