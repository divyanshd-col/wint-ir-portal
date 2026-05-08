-- Fix column names that have leading/trailing whitespace.
-- Root cause: migration was applied via a tool that quoted identifiers
-- and preserved SQL indentation whitespace inside the quotes.
-- This script is idempotent — safe to run multiple times.

DO $$
DECLARE
  r RECORD;
  clean_name TEXT;
BEGIN
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name <> trim(column_name)
    ORDER BY table_name, ordinal_position
  LOOP
    clean_name := trim(r.column_name);
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = r.table_name
        AND column_name  = clean_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I RENAME COLUMN %I TO %I',
        r.table_name, r.column_name, clean_name
      );
      RAISE NOTICE 'Fixed: %."%s" → %.%I',
        r.table_name, r.column_name, r.table_name, clean_name;
    END IF;
  END LOOP;
END $$;
