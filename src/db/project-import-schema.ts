import { boolean, jsonb, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";
import { users } from "./schema";

export const externalConnections = pgTable("external_connections", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sellerId: text("seller_id").references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  providerUsername: text("provider_username"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  scopes: jsonb("scopes").$type<string[]>().default([]),
  connectionRef: text("connection_ref"),
  status: varchar("status", { length: 24 }).notNull().default("connected"),
  connectedAt: timestamp("connected_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const externalProjects = pgTable("external_projects", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  connectionId: text("connection_id").references(() => externalConnections.id, { onDelete: "set null" }),
  provider: varchar("provider", { length: 32 }).notNull(),
  externalProjectId: text("external_project_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  visibility: varchar("visibility", { length: 16 }).default("unknown"),
  lastVersion: text("last_version"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const importSessions = pgTable("project_import_sessions", {
  id: text("id").primaryKey(),
  sellerId: text("seller_id").references(() => users.id, { onDelete: "set null" }),
  sourceType: varchar("source_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("ANALYZED"),
  sourceIr: jsonb("source_ir").$type<Record<string, unknown> | null>(),
  listingIr: jsonb("listing_ir").$type<Record<string, unknown> | null>(),
  sellerConfig: jsonb("seller_config").$type<Record<string, unknown> | null>(),
  tindieProductId: text("tindie_product_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const productSourceLinks = pgTable("product_source_links", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tindieProductId: text("tindie_product_id").notNull(),
  externalProjectId: text("external_project_id").notNull().references(() => externalProjects.id, { onDelete: "cascade" }),
  relationship: varchar("relationship", { length: 24 }).notNull().default("PRIMARY"),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  syncMode: varchar("sync_mode", { length: 24 }).notNull().default("REVIEW"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

