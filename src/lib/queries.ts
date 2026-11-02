import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  resources, discoveries, sources, submissions, comments, saves, subscribers, featured, recommendations, blogPosts,
} from "@/db/schema";

/* ---------------- public reads ---------------- */

export async function getPublishedDiscoveries(limit = 12) {
  return db.select().from(discoveries)
    .where(eq(discoveries.status, "published"))
    .orderBy(desc(discoveries.createdAt))
    .limit(limit);
}

export async function getDiscoveriesByDate(date: string) {
  return db.select().from(discoveries)
    .where(and(eq(discoveries.status, "published"), eq(discoveries.publishDate, date)))
    .orderBy(desc(discoveries.aiScore));
}

// All published discoveries whose chips/tags include the given tag (case-insensitive).
export async function getDiscoveriesByTag(tag: string) {
  const wanted = tag.trim().toLowerCase();
  const rows = await db.select().from(discoveries)
    .where(eq(discoveries.status, "published"))
    .orderBy(desc(discoveries.createdAt));
  return rows.filter((d) => {
    const chips = (d.chips as string[] | null) || [];
    return chips.some((c) => (c || "").toLowerCase() === wanted);
  });
}

// Distinct list of all tags in use across published discoveries (for the tag page / sitemap).
export async function getAllTags(): Promise<string[]> {
  const rows = await db.select().from(discoveries).where(eq(discoveries.status, "published"));
  const set = new Set<string>();
  rows.forEach((d) => ((d.chips as string[] | null) || []).forEach((c) => c && set.add(c)));
  return Array.from(set).sort();
}

export async function getPublishDates(): Promise<string[]> {
  const rows = await db.selectDistinct({ d: discoveries.publishDate })
    .from(discoveries)
    .where(eq(discoveries.status, "published"));
  return rows.map((r) => r.d).filter(Boolean).sort().reverse() as string[];
}

export async function getDiscovery(id: number) {
  const rows = await db.select().from(discoveries).where(eq(discoveries.id, id)).limit(1);
  return rows[0] || null;
}

export async function getResources() {
  return db.select().from(resources)
    .where(eq(resources.status, "active"))
    .orderBy(resources.category, resources.sortOrder, resources.name);
}

export async function getComments(discoveryId: number) {
  return db.select().from(comments)
    .where(eq(comments.discoveryId, discoveryId))
    .orderBy(desc(comments.createdAt));
}

export async function deleteComment(commentId: number) {
  const rows = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  const c = rows[0];
  if (!c) return;
  await db.delete(comments).where(eq(comments.id, commentId));
  await db.update(discoveries)
    .set({ commentCount: sql`GREATEST(${discoveries.commentCount} - 1, 0)` })
    .where(eq(discoveries.id, c.discoveryId));
}

/* ---------------- public writes ---------------- */

export async function addComment(discoveryId: number, body: string, tag: string | null, authorName: string, userId: string | null) {
  await db.insert(comments).values({ discoveryId, body, tag, authorName, userId });
  await db.update(discoveries)
    .set({ commentCount: sql`${discoveries.commentCount} + 1` })
    .where(eq(discoveries.id, discoveryId));
}

export async function toggleSave(userId: string, discoveryId: number) {
  const existing = await db.select().from(saves)
    .where(and(eq(saves.userId, userId), eq(saves.discoveryId, discoveryId))).limit(1);
  if (existing[0]) {
    await db.delete(saves).where(and(eq(saves.userId, userId), eq(saves.discoveryId, discoveryId)));
    await db.update(discoveries).set({ saveCount: sql`GREATEST(${discoveries.saveCount} - 1, 0)` }).where(eq(discoveries.id, discoveryId));
    return false;
  }
  await db.insert(saves).values({ userId, discoveryId });
  await db.update(discoveries).set({ saveCount: sql`${discoveries.saveCount} + 1` }).where(eq(discoveries.id, discoveryId));
  return true;
}

export async function getUserSaves(userId: string): Promise<number[]> {
  const rows = await db.select({ id: saves.discoveryId }).from(saves).where(eq(saves.userId, userId));
  return rows.map((r) => r.id);
}

export async function submitResource(data: { name: string; url?: string; category?: string; why?: string; submittedBy?: string }) {
  const flag = /cheap|free-?pcb|\.biz|\.xyz/i.test((data.url || "") + data.name) ? "flag" : "ok";
  await db.insert(submissions).values({ ...data, autoCheck: flag, status: "pending" });
}

export async function subscribe(email: string) {
  await db.insert(subscribers).values({ email }).onConflictDoNothing();
}

/* ---------------- admin reads ---------------- */

export async function getInbox(status = "needs_review") {
  return db.select().from(discoveries).where(eq(discoveries.status, status)).orderBy(desc(discoveries.aiScore));
}

export async function getAllResourcesAdmin() {
  return db.select().from(resources).orderBy(resources.category, resources.sortOrder, resources.name);
}

// Move a resource up/down within its category by swapping sort_order with its neighbour.
export async function moveResource(id: number, dir: "up" | "down") {
  const rows = await db.select().from(resources).where(eq(resources.id, id)).limit(1);
  const cur = rows[0];
  if (!cur) return;
  // siblings in the same category, ordered as displayed
  const siblings = await db.select().from(resources)
    .where(eq(resources.category, cur.category))
    .orderBy(resources.sortOrder, resources.name);
  const idx = siblings.findIndex((s) => s.id === id);
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return; // already at the edge
  // normalise: assign sequential sort_order to all siblings, then swap the two
  const order = siblings.map((s) => s.id);
  [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
  for (let i = 0; i < order.length; i++) {
    await db.update(resources).set({ sortOrder: i }).where(eq(resources.id, order[i]));
  }
}

export async function getSources() {
  return db.select().from(sources).orderBy(sources.name);
}

export async function getPendingSubmissions() {
  return db.select().from(submissions).where(eq(submissions.status, "pending")).orderBy(desc(submissions.createdAt));
}

export async function getDashboardStats() {
  const today = new Date().toISOString().slice(0, 10);
  const [needs] = await db.select({ c: sql<number>`count(*)` }).from(discoveries).where(eq(discoveries.status, "needs_review"));
  const [scheduled] = await db.select({ c: sql<number>`count(*)` }).from(discoveries).where(eq(discoveries.status, "scheduled"));
  const [approvedToday] = await db.select({ c: sql<number>`count(*)` }).from(discoveries)
    .where(and(eq(discoveries.status, "published"), eq(discoveries.publishDate, today)));
  const [broken] = await db.select({ c: sql<number>`count(*)` }).from(resources).where(eq(resources.linkOk, false));
  return {
    needsReview: Number(needs?.c || 0),
    scheduled: Number(scheduled?.c || 0),
    approvedToday: Number(approvedToday?.c || 0),
    brokenLinks: Number(broken?.c || 0),
  };
}

/* ---------------- admin writes ---------------- */

export async function approveDiscovery(id: number) {
  const today = new Date().toISOString().slice(0, 10);
  await db.update(discoveries).set({ status: "published", publishDate: today }).where(eq(discoveries.id, id));
}
export async function rejectDiscovery(id: number) {
  await db.update(discoveries).set({ status: "rejected" }).where(eq(discoveries.id, id));
}
export async function unpublishDiscovery(id: number) {
  // Take a published item offline but keep it — back to the review queue so it can be re-published.
  await db.update(discoveries).set({ status: "needs_review" }).where(eq(discoveries.id, id));
}
export async function deleteDiscovery(id: number) {
  // Permanently remove the discovery and its comments.
  await db.delete(comments).where(eq(comments.discoveryId, id));
  await db.delete(discoveries).where(eq(discoveries.id, id));
}

/* ---- bulk discovery operations (batch select in admin) ---- */
export async function bulkApproveDiscoveries(ids: number[]) {
  if (!ids.length) return;
  const today = new Date().toISOString().slice(0, 10);
  await db.update(discoveries).set({ status: "published", publishDate: today }).where(inArray(discoveries.id, ids));
}
export async function bulkRejectDiscoveries(ids: number[]) {
  if (!ids.length) return;
  await db.update(discoveries).set({ status: "rejected" }).where(inArray(discoveries.id, ids));
}
export async function bulkUnpublishDiscoveries(ids: number[]) {
  if (!ids.length) return;
  await db.update(discoveries).set({ status: "needs_review" }).where(inArray(discoveries.id, ids));
}
export async function bulkDeleteDiscoveries(ids: number[]) {
  if (!ids.length) return;
  await db.delete(comments).where(inArray(comments.discoveryId, ids));
  await db.delete(discoveries).where(inArray(discoveries.id, ids));
}
export async function updateDiscovery(id: number, fields: Partial<typeof discoveries.$inferInsert>) {
  const clean: any = { ...fields };
  // Normalize jsonb array fields to real arrays (guard against double-encoded strings).
  for (const key of ["relatedProducts", "chips", "relatedTags"] as const) {
    const v: any = (clean as any)[key];
    if (typeof v === "string") {
      try { (clean as any)[key] = JSON.parse(v); } catch { (clean as any)[key] = []; }
    }
    if ((clean as any)[key] != null && !Array.isArray((clean as any)[key])) {
      (clean as any)[key] = [];
    }
  }
  // Write related_products via an explicit jsonb cast to avoid the postgres-js
  // double-encoding quirk that stored arrays-of-objects as JSON strings.
  const rp = clean.relatedProducts;
  if (rp !== undefined) {
    delete clean.relatedProducts;
    await db.update(discoveries)
      .set({ ...clean, relatedProducts: sql`${JSON.stringify(rp)}::jsonb` as any })
      .where(eq(discoveries.id, id));
  } else {
    await db.update(discoveries).set(clean).where(eq(discoveries.id, id));
  }
}

export async function toggleSource(id: number) {
  const rows = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  if (!rows[0]) return;
  const next = rows[0].status === "active" ? "paused" : "active";
  await db.update(sources).set({ status: next }).where(eq(sources.id, id));
  return next;
}

export async function createSource(fields: { name: string; method?: string; url?: string; trust?: string; dailyCap?: number; category?: string }) {
  await db.insert(sources).values({
    name: fields.name,
    method: fields.method || "RSS",
    url: fields.url || null,
    category: fields.category || null,
    trust: fields.trust || "Medium",
    dailyCap: fields.dailyCap ?? 2,
    status: "active",
  });
}

export async function deleteSource(id: number) {
  await db.delete(sources).where(eq(sources.id, id));
}

export async function updateSource(id: number, fields: { name?: string; method?: string; url?: string; trust?: string; dailyCap?: number; category?: string }) {
  const patch: Record<string, any> = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.method !== undefined) patch.method = fields.method;
  if (fields.url !== undefined) patch.url = fields.url || null;
  if (fields.trust !== undefined) patch.trust = fields.trust;
  if (fields.dailyCap !== undefined) patch.dailyCap = fields.dailyCap;
  if (fields.category !== undefined) patch.category = fields.category || null;
  if (Object.keys(patch).length === 0) return;
  await db.update(sources).set(patch).where(eq(sources.id, id));
}

export async function verifyResource(id: number, url?: string) {
  await db.update(resources)
    .set({ linkOk: true, isVerified: true, verifiedAt: new Date(), ...(url ? { url } : {}) })
    .where(eq(resources.id, id));
}
export async function updateResource(id: number, fields: Partial<typeof resources.$inferInsert>) {
  await db.update(resources).set(fields).where(eq(resources.id, id));
}

export async function deleteResource(id: number) {
  await db.delete(resources).where(eq(resources.id, id));
}

/* ---- bulk resource operations (batch select in admin) ---- */
export async function bulkDeleteResources(ids: number[]) {
  if (!ids.length) return;
  await db.delete(resources).where(inArray(resources.id, ids));
}
export async function bulkSetResourceStatus(ids: number[], status: "active" | "hidden") {
  if (!ids.length) return;
  await db.update(resources).set({ status }).where(inArray(resources.id, ids));
}

export async function createResource(fields: {
  name: string; url: string; category: string; description?: string;
  capLabel?: string; logo?: string; isPick?: boolean; isPartner?: boolean; isFeatured?: boolean;
}) {
  const base = fields.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "resource";
  const slug = base + "-" + Date.now().toString(36);
  await db.insert(resources).values({
    slug,
    name: fields.name,
    url: fields.url || "https://",
    description: fields.description || "",
    category: fields.category || "open-source",
    capLabel: fields.capLabel || "Resource",
    logo: fields.logo || null,
    isPick: !!fields.isPick,
    isPartner: !!fields.isPartner,
    isFeatured: !!fields.isFeatured,
    isVerified: false,
    linkOk: true,
    status: "active",
  });
}

export async function moderateSubmission(id: number, action: "approve" | "reject") {
  if (action === "reject") {
    await db.update(submissions).set({ status: "rejected" }).where(eq(submissions.id, id));
    return;
  }
  const rows = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
  const s = rows[0];
  if (!s) return;
  await db.update(submissions).set({ status: "approved" }).where(eq(submissions.id, id));
  // promote into the directory (hidden until an editor finalizes labels)
  const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) + "-" + id;
  await db.insert(resources).values({
    slug, name: s.name, url: s.url || "https://", description: s.why || "Submitted by the community.",
    category: s.category || "open-source", capLabel: "Community", isVerified: false, status: "hidden",
  }).onConflictDoNothing();
}

/* ---------------- featured (this week) ---------------- */
export async function getFeatured() {
  return db.select().from(featured).orderBy(featured.sortOrder, featured.id);
}
export async function createFeatured(fields: { name: string; tag?: string; category?: string; url?: string; logo?: string }) {
  await db.insert(featured).values({
    name: fields.name,
    tag: fields.tag || null,
    category: fields.category || null,
    url: fields.url || null,
    logo: fields.logo || null,
  });
}
export async function deleteFeatured(id: number) {
  await db.delete(featured).where(eq(featured.id, id));
}
export async function moveFeatured(id: number, dir: "up" | "down") {
  const rows = await db.select().from(featured).orderBy(featured.sortOrder, featured.id);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= rows.length) return;
  const order = rows.map((r) => r.id);
  [order[idx], order[swap]] = [order[swap], order[idx]];
  for (let i = 0; i < order.length; i++) {
    await db.update(featured).set({ sortOrder: i }).where(eq(featured.id, order[i]));
  }
}

/* ---------------- blog posts (mirrored from blog.tindie.com) ---------------- */

// Most recent posts for the home-page "From the Blog" section.
export async function getRecentBlogPosts(limit = 6) {
  return db.select().from(blogPosts).orderBy(desc(blogPosts.publishedAt)).limit(limit);
}

/* ---------------- recommendations (home banner) ---------------- */

// Public: the single recommendation to show right now — active, within its
// scheduling window, most recent first.
export async function getActiveRecommendation() {
  const now = new Date();
  const rows = await db.select().from(recommendations)
    .where(eq(recommendations.status, "active"))
    .orderBy(desc(recommendations.createdAt));
  const live = rows.find((r) => {
    const okStart = !r.startsAt || new Date(r.startsAt as any) <= now;
    const okEnd = !r.endsAt || new Date(r.endsAt as any) >= now;
    return okStart && okEnd;
  });
  return live || null;
}

// Admin: full list with counts.
export async function getAllRecommendations() {
  return db.select().from(recommendations).orderBy(desc(recommendations.createdAt));
}

export async function createRecommendation(fields: {
  title: string; body?: string; url?: string; imageUrl?: string; ctaLabel?: string;
  startsAt?: string | null; endsAt?: string | null; status?: string;
}) {
  await db.insert(recommendations).values({
    title: fields.title,
    body: fields.body || "",
    url: fields.url || null,
    imageUrl: fields.imageUrl || null,
    ctaLabel: fields.ctaLabel || "Learn more",
    startsAt: fields.startsAt ? new Date(fields.startsAt) : null,
    endsAt: fields.endsAt ? new Date(fields.endsAt) : null,
    status: fields.status === "paused" ? "paused" : "active",
  });
}

export async function updateRecommendation(id: number, fields: {
  title?: string; body?: string; url?: string; imageUrl?: string; ctaLabel?: string;
  startsAt?: string | null; endsAt?: string | null; status?: string;
}) {
  const patch: Record<string, any> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.body !== undefined) patch.body = fields.body;
  if (fields.url !== undefined) patch.url = fields.url || null;
  if (fields.imageUrl !== undefined) patch.imageUrl = fields.imageUrl || null;
  if (fields.ctaLabel !== undefined) patch.ctaLabel = fields.ctaLabel || "Learn more";
  if (fields.startsAt !== undefined) patch.startsAt = fields.startsAt ? new Date(fields.startsAt) : null;
  if (fields.endsAt !== undefined) patch.endsAt = fields.endsAt ? new Date(fields.endsAt) : null;
  if (fields.status !== undefined) patch.status = fields.status === "paused" ? "paused" : "active";
  if (Object.keys(patch).length === 0) return;
  await db.update(recommendations).set(patch).where(eq(recommendations.id, id));
}

export async function deleteRecommendation(id: number) {
  await db.delete(recommendations).where(eq(recommendations.id, id));
}

export async function trackRecommendation(id: number, kind: "impression" | "click") {
  const col = kind === "click" ? recommendations.clicks : recommendations.impressions;
  await db.update(recommendations)
    .set({ [kind === "click" ? "clicks" : "impressions"]: sql`${col} + 1` })
    .where(eq(recommendations.id, id));
}

