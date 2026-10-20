-- Only platform metadata at this stage. Account/history tables belong to stage 2.
CREATE TABLE platform_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO platform_metadata (key, value) VALUES ('schema', 'foundation-v1');
