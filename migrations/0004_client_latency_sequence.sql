CREATE TABLE IF NOT EXISTS client_latency_sequence (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  writer_id TEXT NOT NULL,
  id TEXT NOT NULL,
  UNIQUE (writer_id, id)
);
INSERT OR IGNORE INTO client_latency_sequence (writer_id, id)
  SELECT source.writer_id, source.id FROM client_latency AS source
  WHERE NOT EXISTS (SELECT 1 FROM client_latency_sequence AS seq WHERE seq.writer_id = source.writer_id AND seq.id = source.id)
  ORDER BY source.rowid;
CREATE TRIGGER IF NOT EXISTS client_latency_sequence_insert AFTER INSERT ON client_latency BEGIN
  INSERT INTO client_latency_sequence (writer_id, id) VALUES (NEW.writer_id, NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS client_latency_sequence_delete AFTER DELETE ON client_latency BEGIN
  DELETE FROM client_latency_sequence WHERE writer_id = OLD.writer_id AND id = OLD.id;
END;
