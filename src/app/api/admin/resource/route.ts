export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyResource, updateResource, createResource, deleteResource, moveResource, bulkDeleteResources, bulkSetResourceStatus } from "@/lib/queries";
import { zText, zTags, zUrlOptional, safeHttpUrl } from "@/lib/validate";
import { isEditor } from "@/lib/guard";

// Whitelisted, length-capped fields — no pass-through of arbitrary keys.
const fieldsSchema = z.object({
  name: zText(200).optional(),
  slug: z.string().max(120).regex(/^[a-z0-9-]*$/i).optional(),
  url: zUrlOptional,
  // Site-relative path ("/logos/kicad.png") or a public http(s) URL.
  logo: z.string().max(2048).optional()
    .refine((v) => v === undefined || v === "" || (/^\/[\w\-./]*$/.test(v) && !v.includes("..")) || safeHttpUrl(v) !== null,
      { message: "must be a site path or public http(s) URL" }),
  description: zText(1000).optional(),
  category: zText(60).optional(),
  capLabel: zText(100).optional(),
  tags: zTags(15).optional(),
  audiences: zTags(15).optional(),
  pricing: zText(100).optional(),
  platforms: zTags(15).optional(),
  isPick: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isPartner: z.boolean().optional(),
  isSponsored: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  linkOk: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  status: z.enum(["active", "hidden"]).optional(),
});

const schema = z.object({
  id: z.number().int().positive().optional(),
  ids: z.array(z.number().int().positive()).max(500).optional(),
  action: z.enum(["verify", "update", "create", "delete", "move", "bulkDelete", "bulkHide", "bulkUnhide"]),
  url: zUrlOptional,
  fields: fieldsSchema.optional(),
  dir: z.enum(["up", "down"]).optional(),
});

export async function POST(req: Request) {
  if (!(await isEditor())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { id, ids, action, url, fields, dir } = parsed.data;
  if (action === "verify" && id != null) await verifyResource(id, url);
  else if (action === "update" && id != null && fields) await updateResource(id, fields as any);
  else if (action === "create" && fields) await createResource(fields as any);
  else if (action === "delete" && id != null) await deleteResource(id);
  else if (action === "move" && id != null && dir) await moveResource(id, dir);
  else if (action === "bulkDelete" && ids) await bulkDeleteResources(ids);
  else if (action === "bulkHide" && ids) await bulkSetResourceStatus(ids, "hidden");
  else if (action === "bulkUnhide" && ids) await bulkSetResourceStatus(ids, "active");
  else return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

