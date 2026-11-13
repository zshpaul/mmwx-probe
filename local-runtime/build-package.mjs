import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const destination = process.argv[2];
const frontend = process.argv[3] || "dist";
if (!destination) throw new Error("Provide a staging directory");
const output = resolve(destination);
await mkdir(output, { recursive: true });
await cp(process.execPath, resolve(output, "node.exe"), { errorOnExist: true, force: false });
await cp("local-runtime/server.mjs", resolve(output, "server.mjs"), { errorOnExist: true, force: false });
await cp("local-runtime/migrate.mjs", resolve(output, "migrate.mjs"), { errorOnExist: true, force: false });
await cp(frontend, resolve(output, "dist"), { recursive: true, errorOnExist: true, force: false });
await build({ entryPoints: ["worker/client-latency.ts"], outfile: resolve(output, "client-latency.mjs"), bundle: true, platform: "node", format: "esm", target: "node24" });
await build({ entryPoints: ["worker/client-quota.ts"], outfile: resolve(output, "client-quota.mjs"), bundle: true, platform: "node", format: "esm", target: "node24" });
await build({ entryPoints: ["worker/client-rate.ts"], outfile: resolve(output, "client-rate.mjs"), bundle: true, platform: "node", format: "esm", target: "node24" });
console.log(`Staged standalone runtime at ${output}`);
