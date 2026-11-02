CREATE TABLE IF NOT EXISTS "external_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "seller_id" text,
  "provider" varchar(32) NOT NULL,
  "provider_account_id" text NOT NULL,
  "provider_username" text,
  "display_name" text,
  "avatar_url" text,
  "scopes" jsonb DEFAULT '[]'::jsonb,
  "connection_ref" text,
  "status" varchar(24) DEFAULT 'connected' NOT NULL,
  "connected_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_projects" (
  "id" text PRIMARY KEY NOT NULL,
  "connection_id" text,
  "provider" varchar(32) NOT NULL,
  "external_project_id" text NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "visibility" varchar(16) DEFAULT 'unknown',
  "last_version" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "last_synced_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_import_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "seller_id" text,
  "source_type" varchar(32) NOT NULL,
  "status" varchar(32) DEFAULT 'ANALYZED' NOT NULL,
  "source_ir" jsonb,
  "listing_ir" jsonb,
  "seller_config" jsonb,
  "tindie_product_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_source_links" (
  "id" text PRIMARY KEY NOT NULL,
  "tindie_product_id" text NOT NULL,
  "external_project_id" text NOT NULL,
  "relationship" varchar(24) DEFAULT 'PRIMARY' NOT NULL,
  "sync_enabled" boolean DEFAULT true NOT NULL,
  "sync_mode" varchar(24) DEFAULT 'REVIEW' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_connections" ADD CONSTRAINT "external_connections_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_projects" ADD CONSTRAINT "external_projects_connection_id_external_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."external_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_import_sessions" ADD CONSTRAINT "project_import_sessions_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_source_links" ADD CONSTRAINT "product_source_links_external_project_id_external_projects_id_fk" FOREIGN KEY ("external_project_id") REFERENCES "public"."external_projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_connections_seller_provider_idx" ON "external_connections" ("seller_id", "provider");
CREATE INDEX IF NOT EXISTS "external_projects_provider_project_idx" ON "external_projects" ("provider", "external_project_id");
CREATE INDEX IF NOT EXISTS "project_import_sessions_seller_idx" ON "project_import_sessions" ("seller_id", "updated_at");
CREATE INDEX IF NOT EXISTS "product_source_links_product_idx" ON "product_source_links" ("tindie_product_id");

