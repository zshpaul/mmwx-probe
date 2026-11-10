import { buildSync } from "esbuild";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = realpathSync(tmpdir());
const output = mkdtempSync(join(temporaryRoot, "mmwx-probe-tests-"));
const sourceTests = readdirSync(join(root, "src")).filter(name => /\.test\.tsx?$/.test(name)).sort();
const scriptTests = readdirSync(join(root, "scripts")).filter(name => name.endsWith(".test.mjs")).sort();
let failures = 0;
try {
  buildSync({
    absWorkingDir: root,
    entryPoints: sourceTests.map(name => `src/${name}`),
    bundle: true, platform: "node", format: "cjs", outdir: output,
    outExtension: { ".js": ".cjs" }, logLevel: "warning",
  });
  const tests = [
    ...sourceTests.map(name => ({ name, path: join(output, name.replace(/\.tsx?$/, ".cjs")) })),
    ...scriptTests.map(name => ({ name, path: join(root, "scripts", name) })),
  ];
  for (const test of tests) {
    const result = spawnSync(process.execPath, [test.path], { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true });
    if (result.status !== 0 || result.error) {
      failures++;
      console.error(`FAIL ${test.name}\n${result.stdout || ""}${result.stderr || ""}${result.error?.message || ""}`);
    } else console.log(`PASS ${test.name}`);
  }
  console.log(`${tests.length - failures}/${tests.length} tests passed`);
  process.exitCode = failures ? 1 : 0;
} finally {
  if (dirname(realpathSync(output)) !== temporaryRoot || !basename(output).startsWith("mmwx-probe-tests-")) throw new Error("Unexpected test output directory");
  rmSync(output, { recursive: true, force: true });
}
