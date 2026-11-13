import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
const schema = await readFile(new URL("../migrations/0001_client_latency.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0004_client_latency_sequence.sql", import.meta.url), "utf8");
db.exec(schema);
const insert = db.prepare(`INSERT INTO client_latency (writer_id,id,group_id,group_alias,measured_at,measured_ms,observed_at,node,status,delay_ms,segment)
 VALUES ('default', ?, 'group', 'Group', '2026-11-13T00:00:00Z', 1794528000000, '2026-11-13T00:00:00Z', NULL, 'ok', 42, 'segment')`);
insert.run("old-a");
insert.run("old-b");
const before = db.prepare("SELECT * FROM client_latency ORDER BY id").all();
db.exec(migration);
assert.deepEqual(db.prepare("SELECT * FROM client_latency ORDER BY id").all(), before);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM client_latency_sequence").get().count, 2);
const oldSeq = db.prepare("SELECT seq FROM client_latency_sequence WHERE id = 'old-b'").get().seq;
db.prepare("DELETE FROM client_latency WHERE id = ?").run("old-b");
insert.run("new-c");
assert.ok(db.prepare("SELECT seq FROM client_latency_sequence WHERE id = 'new-c'").get().seq > oldSeq);
db.close();
console.log("PASS: existing latency rows preserved; sequence survives deletion and reinsertion");
