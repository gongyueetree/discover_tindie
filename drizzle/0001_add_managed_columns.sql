-- Columns that were previously added by hand-run scripts.
-- Folded into a real migration so a fresh deploy never misses them.
-- IF NOT EXISTS makes this safe to run even where the columns already exist.

ALTER TABLE "resources"   ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;
ALTER TABLE "resources"   ADD COLUMN IF NOT EXISTS "is_featured" boolean DEFAULT false;
ALTER TABLE "discoveries" ADD COLUMN IF NOT EXISTS "related_products" jsonb DEFAULT '[]'::jsonb;

