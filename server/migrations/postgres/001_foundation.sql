-- PostgreSQL / Neon. Independent migration ledger; SQLite sources remain unchanged.
-- Only platform metadata at this stage. Account/history tables belong to stage 2.
CREATE TABLE platform_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO platform_metadata (key, value) VALUES ('schema', 'foundation-v1');

-- Compatibility for the shared read queries; JSON remains serialized text.
CREATE FUNCTION json_extract(document TEXT, path TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
 SELECT document::jsonb #>> string_to_array(substr(path,3),'.')
$$;
