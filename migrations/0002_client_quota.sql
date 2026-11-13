CREATE TABLE IF NOT EXISTS client_quota (
  group_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  upload_bytes INTEGER,
  download_bytes INTEGER,
  total_bytes INTEGER,
  expires_at TEXT
);
