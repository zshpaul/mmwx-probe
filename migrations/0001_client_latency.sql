CREATE TABLE IF NOT EXISTS client_latency (
  writer_id TEXT NOT NULL,
  id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  group_alias TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  measured_ms INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  node TEXT,
  status TEXT NOT NULL,
  delay_ms REAL,
  segment TEXT NOT NULL,
  PRIMARY KEY (writer_id, id)
);
CREATE INDEX IF NOT EXISTS client_latency_measured_ms ON client_latency(measured_ms);
CREATE INDEX IF NOT EXISTS client_latency_group_time ON client_latency(group_id, measured_ms);
