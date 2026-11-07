-- Discover traffic (lib/maker-analytics.ts creates these on first use; this file documents them).
CREATE TABLE IF NOT EXISTS "maker_traffic_daily" (
  "day" varchar(10) NOT NULL, "page" varchar(24) NOT NULL, "views" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "maker_traffic_daily_pk" PRIMARY KEY ("day", "page"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maker_visitors_daily" (
  "day" varchar(10) NOT NULL, "page" varchar(24) NOT NULL, "visitor" varchar(16) NOT NULL,
  CONSTRAINT "maker_visitors_daily_pk" PRIMARY KEY ("day", "page", "visitor"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maker_terms_daily" (
  "day" varchar(10) NOT NULL, "scope" varchar(24) NOT NULL, "term" varchar(120) NOT NULL,
  "count" integer DEFAULT 0 NOT NULL, "empty" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "maker_terms_daily_pk" PRIMARY KEY ("day", "scope", "term"));
