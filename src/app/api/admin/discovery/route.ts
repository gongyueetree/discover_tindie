export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { approveDiscovery, rejectDiscovery, updateDiscovery, getComments, deleteComment, unpublishDiscovery, deleteDiscovery, bulkApproveDiscoveries, bulkRejectDiscoveries, bulkUnpublishDiscoveries, bulkDeleteDiscoveries } from "@/lib/queries";
import { zText, zTags, zUrlOptional } from "@/lib/validate";
import { isEditor } from "@/lib/guard";

// Whitelisted, length-capped fields — no pass-through of arbitrary keys.
const fieldsSchema = z.object({
  title: zText(200).optional(),
  summary: zText(1000).optional(),
  why: zText(1000).optional(),
  category: zText(60).optional(),
  sourceName: zText(120).optional(),
  sourceUrl: zUrlOptional,
  imageUrl: zUrlOptional,
  imageLicense: zText(40).optional(),
  icon: zText(10).optional(),
  chips: zTags(10).optional(),
  license: zText(80).optional(),
  availability: zText(120).optional(),
  relatedTags: zTags(10).optional(),
  aiScore: z.number().int().min(0).max(100).optional(),
  flag: zText(20).nullable().optional(),
  isSponsored: z.boolean().optional(),
  isPick: z.boolean().optional(),
  status: z.enum(["collected", "ai_reviewed", "needs_review", "approved", "scheduled", "published", "rejected"]).optional(),
  publishDate: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const schema = z.object({
  id: z.number().int().positive().optional(),
  ids: z.array(z.number().int().positive()).max(500).optional(),
  action: z.enum(["approve", "reject", "update", "comments", "deleteComment", "unpublish", "delete", "bulkApprove", "bulkReject", "bulkUnpublish", "bulkDelete"]),
  fields: fieldsSchema.optional(),
  commentId: z.number().int().positive().optional(),
});

export async function POST(req: Request) {
  if (!(await isEditor())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { id, ids, action, fields, commentId } = parsed.data;
  if (action === "approve" && id != null) await approveDiscovery(id);
  else if (action === "reject" && id != null) await rejectDiscovery(id);
  else if (action === "update" && id != null && fields) await updateDiscovery(id, fields as any);
  else if (action === "comments" && id != null) return NextResponse.json({ ok: true, comments: await getComments(id) });
  else if (action === "deleteComment" && commentId != null) await deleteComment(commentId);
  else if (action === "unpublish" && id != null) await unpublishDiscovery(id);
  else if (action === "delete" && id != null) await deleteDiscovery(id);
  else if (action === "bulkApprove" && ids) await bulkApproveDiscoveries(ids);
  else if (action === "bulkReject" && ids) await bulkRejectDiscoveries(ids);
  else if (action === "bulkUnpublish" && ids) await bulkUnpublishDiscoveries(ids);
  else if (action === "bulkDelete" && ids) await bulkDeleteDiscoveries(ids);
  else return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

