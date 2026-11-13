CREATE TABLE IF NOT EXISTS client_rate (
  group_id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  received_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  upload_bps INTEGER,
  download_bps INTEGER
);
