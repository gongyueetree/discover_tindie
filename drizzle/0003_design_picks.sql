CREATE TABLE IF NOT EXISTS "design_picks" (
  "id" serial PRIMARY KEY NOT NULL,
  "repo_url" text NOT NULL UNIQUE,
  "discovery_id" integer,
  "title" text NOT NULL,
  "intro" text NOT NULL,
  "highlights" jsonb DEFAULT '[]'::jsonb,
  "caveat" text,
  "license" text,
  "eda_tool" text,
  "stars" integer,
  "repo_created_at" timestamp,
  "repo_pushed_at" timestamp,
  "image_url" text,
  "score" integer DEFAULT 0,
  "pick_date" varchar(10) NOT NULL,
  "status" varchar(12) DEFAULT 'published' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_picks_date_idx" ON "design_picks" ("status", "pick_date");
