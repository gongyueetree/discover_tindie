import {
  pgTable, serial, text, integer, boolean, timestamp, primaryKey, jsonb, varchar,
} from "drizzle-orm/pg-core";

/* ---------------- Auth.js tables ---------------- */
export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),          // for credentials login
  role: text("role").notNull().default("user"), // 'user' | 'editor' | 'admin'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const accounts = pgTable("accounts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (t) => ({ pk: primaryKey({ columns: [t.provider, t.providerAccountId] }) }));

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.identifier, t.token] }) }));

/* ---------------- Domain tables ---------------- */

// Curated directory resources (the 50)
export const resources = pgTable("resources", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  logo: text("logo"),
  description: text("description").notNull(),
  category: varchar("category", { length: 40 }).notNull(), // taxonomy id
  capLabel: text("cap_label"),       // true-capability tag
  tags: jsonb("tags").$type<string[]>().default([]),
  audiences: jsonb("audiences").$type<string[]>().default([]),
  pricing: text("pricing"),
  platforms: jsonb("platforms").$type<string[]>().default([]),
  isPick: boolean("is_pick").default(false),
  isFeatured: boolean("is_featured").default(false),
  isPartner: boolean("is_partner").default(false),
  isSponsored: boolean("is_sponsored").default(false),
  isVerified: boolean("is_verified").default(false),
  linkOk: boolean("link_ok").default(true),
  sortOrder: integer("sort_order").default(0),
  clicks: integer("clicks").default(0),
  verifiedAt: timestamp("verified_at"),
  status: varchar("status", { length: 20 }).notNull().default("active"), // active | hidden
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Crawl sources feeding the discovery pipeline
export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  method: varchar("method", { length: 20 }).notNull(), // RSS | API | Crawl
  url: text("url"),
  category: varchar("category", { length: 40 }),       // taxonomy id, same set as resources
  frequency: text("frequency"),       // e.g. '6h'
  trust: varchar("trust", { length: 10 }).default("Medium"), // High|Medium|Low
  dailyCap: integer("daily_cap").default(2),
  lastSuccess: timestamp("last_success"),
  errorRate: text("error_rate").default("0%"),
  status: varchar("status", { length: 10 }).notNull().default("active"), // active | paused
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Daily AI discoveries (10–12/day) with full review lifecycle
export const discoveries = pgTable("discoveries", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),          // "what it is" (AI-generated, original)
  why: text("why").notNull(),                  // "why it matters for Tindie"
  category: varchar("category", { length: 40 }).notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  imageUrl: text("image_url"),
  imageLicense: text("image_license"),         // OG/press/repo/unknown
  icon: text("icon"),                          // emoji fallback
  chips: jsonb("chips").$type<string[]>().default([]),
  license: text("license"),
  availability: text("availability"),
  relatedTags: jsonb("related_tags").$type<string[]>().default([]),
  relatedProducts: jsonb("related_products").$type<{ name: string; seller?: string; price?: string; url?: string }[]>().default([]),
  aiScore: integer("ai_score").default(0),
  flag: text("flag"),                          // sponsored | risk | dup | null
  isSponsored: boolean("is_sponsored").default(false),
  isPick: boolean("is_pick").default(false),
  // lifecycle: collected -> ai_reviewed -> needs_review -> approved/scheduled -> published | rejected
  status: varchar("status", { length: 20 }).notNull().default("needs_review"),
  publishDate: varchar("publish_date", { length: 10 }), // 'YYYY-MM-DD' once published
  views: integer("views").notNull().default(0),         // lifetime reads (drawer opens)
  saveCount: integer("save_count").default(0),
  commentCount: integer("comment_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User submissions awaiting moderation
export const submissions = pgTable("submissions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url"),
  category: varchar("category", { length: 40 }),
  why: text("why"),
  submittedBy: text("submitted_by"),  // email or 'anonymous'
  autoCheck: text("auto_check"),      // ok | flag
  status: varchar("status", { length: 12 }).notNull().default("pending"), // pending|approved|rejected
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Community comments on discoveries
export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  discoveryId: integer("discovery_id").notNull().references(() => discoveries.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull().default("anonymous"),
  tag: text("tag"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Saves (per user, shared across devices)
export const saves = pgTable("saves", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  discoveryId: integer("discovery_id").notNull().references(() => discoveries.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.discoveryId] }) }));

// Newsletter signups
export const subscribers = pgTable("subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// "Featured this week" — editor-curated sidebar list, managed in admin.
export const featured = pgTable("featured", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tag: text("tag"),                 // e.g. "New Board", "Manufacturing"
  category: text("category"),       // taxonomy id, used to colour the tag pill
  url: text("url"),                 // optional external link
  logo: text("logo"),               // optional logo URL
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Per-day view/click counters for each home-page section, pre-aggregated so
// there is one row per (day, section, kind) instead of one row per event.
// Written via UPSERT from /api/track; read by the admin analytics dashboard.
export const analyticsDaily = pgTable("analytics_daily", {
  day: varchar("day", { length: 10 }).notNull(),        // 'YYYY-MM-DD' (UTC)
  section: varchar("section", { length: 32 }).notNull(), // whitelisted section id
  kind: varchar("kind", { length: 8 }).notNull(),        // 'view' | 'click'
  count: integer("count").notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.day, t.section, t.kind] }) }));

// Posts mirrored from the official Tindie WordPress blog (blog.tindie.com/feed/)
// via scripts/import-blog.ts and the daily /api/cron/blog job. Deduped by url.
export const blogPosts = pgTable("blog_posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author"),
  excerpt: text("excerpt"),                     // plain-text summary (~200 chars)
  imageUrl: text("image_url"),                   // first <img> from the post body
  url: text("url").notNull().unique(),           // original post link (dedupe key)
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Editor-curated recommendation banner shown full-width on the home page.
// Description is stored as Markdown; the front-end renders it. Impressions and
// clicks are counted via /api/recommendation/track. Scheduling via startsAt/endsAt.
export const recommendations = pgTable("recommendations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),   // Markdown
  url: text("url"),                             // click-through target (optional)
  imageUrl: text("image_url"),                  // optional image, shown beside the text
  ctaLabel: text("cta_label").default("Learn more"),
  startsAt: timestamp("starts_at"),             // null = active immediately
  endsAt: timestamp("ends_at"),                 // null = no end
  status: varchar("status", { length: 12 }).notNull().default("active"), // active | paused
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


// Open-source designs Claude recommends for the Open hardware tab (one row per repository / folder).
// Facts (licence, dates, stars) come from GitHub; the intro and caveats are Claude's reading of the
// article and README. `discoveryId` is the Resources article people can read for details.
export const designPicks = pgTable("design_picks", {
  id: serial("id").primaryKey(),
  repoUrl: text("repo_url").notNull().unique(),          // https://github.com/owner/repo[/tree/ref/folder]
  discoveryId: integer("discovery_id"),
  title: text("title").notNull(),
  intro: text("intro").notNull(),
  highlights: jsonb("highlights").$type<string[]>().default([]),
  caveat: text("caveat"),                                // maturity note, e.g. "Author says it has not been built yet"
  license: text("license"),
  edaTool: text("eda_tool"),
  stars: integer("stars"),
  repoCreatedAt: timestamp("repo_created_at"),
  repoPushedAt: timestamp("repo_pushed_at"),
  imageUrl: text("image_url"),
  score: integer("score").default(0),
  pickDate: varchar("pick_date", { length: 10 }).notNull(),
  status: varchar("status", { length: 12 }).notNull().default("published"), // published | hidden | rejected
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
