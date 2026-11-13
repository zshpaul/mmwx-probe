import { backup, DatabaseSync } from "node:sqlite";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--source", "--backup", "--dest"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error("Invalid arguments");
  options[args[i]] = resolve(args[i + 1]);
}
const [sourcePath, backupPath, destPath] = [options["--source"], options["--backup"], options["--dest"]];
if (!sourcePath || !backupPath || !destPath || new Set([sourcePath, backupPath, destPath]).size !== 3) throw new Error("Provide distinct source, backup, and destination");
// Never overwrite a previous database or backup.
for (const path of [backupPath, destPath]) {
  await mkdir(dirname(path), { recursive: true });
  const reservation = await open(path, "wx");
  await reservation.close();
}
const columns = "writer_id,id,group_id,group_alias,measured_at,measured_ms,observed_at,node,status,delay_ms,segment";
const rows = db => db.prepare(`SELECT ${columns} FROM client_latency ORDER BY writer_id,id`).all();
function assertEqual(left, right) {
  const a = rows(left), b = rows(right);
  if (a.length !== b.length) throw new Error(`Row count mismatch: ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) throw new Error(`Row mismatch at position ${i}`);
  }
  return a.length;
}
const source = new DatabaseSync(sourcePath, { readOnly: true });
let snapshot;
let destination;
try {
  await backup(source, backupPath);
  snapshot = new DatabaseSync(backupPath, { readOnly: true });
  const sourceCount = assertEqual(source, snapshot);
  await backup(snapshot, destPath);
  destination = new DatabaseSync(destPath, { readOnly: true });
  const targetCount = assertEqual(snapshot, destination);
  console.log(`Verified ${sourceCount} source rows and ${targetCount} destination rows, all fields equal.`);
} finally {
  destination?.close();
  snapshot?.close();
  source.close();
}
