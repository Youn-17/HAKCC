-- ============================================================
-- HAKCC — Full-Text Search Indexes
-- 011_fulltext_search.sql
-- ============================================================
-- Add GIN indexes for efficient full-text search on notes.
-- Uses pg_trgm for fuzzy substring search (ILIKE queries)
-- and tsvector for ranked full-text search.
-- ============================================================

-- Enable pg_trgm extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on notes.title for fast ILIKE/similarity queries
CREATE INDEX IF NOT EXISTS idx_notes_title_trgm
  ON notes USING gin (title gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- GIN trigram index on notes.content for fast ILIKE/similarity queries
CREATE INDEX IF NOT EXISTS idx_notes_content_trgm
  ON notes USING gin (content gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Add a tsvector column for ranked full-text search (Chinese + English)
ALTER TABLE notes ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'C')
  ) STORED;

-- GIN index on the generated tsvector column
CREATE INDEX IF NOT EXISTS idx_notes_search_vector
  ON notes USING gin (search_vector)
  WHERE deleted_at IS NULL;

-- Usage examples:
--   Trigram (fuzzy): SELECT * FROM notes WHERE title ILIKE '%keyword%';
--   Full-text ranked: SELECT *, ts_rank(search_vector, query) AS rank
--                     FROM notes, to_tsquery('simple', 'keyword') query
--                     WHERE search_vector @@ query
--                     ORDER BY rank DESC;
