CREATE TABLE IF NOT EXISTS obsidian_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  content_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,
  obsidian_path TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS obsidian_articles_updated_idx ON obsidian_articles(updated_at);
