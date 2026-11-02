import {partFamily} from "@/lib/maker/part-family";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eel, rateLimit } from "@/lib/maker/server";
import {
  buildComponentGraph,
  GraphData,
  GraphDesign,
} from "@/lib/maker/component-graph";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cache = new Map<string, { until: number; promise: Promise<GraphData> }>();
async function generate(focus: string, guest: string): Promise<GraphData> {
  const q = new URLSearchParams({ limit: "24" });
  if (focus) q.set("mpn", partFamily(focus).family);
  const listing = await eel("circuit-atlas/designs?" + q, guest, {
    signal: AbortSignal.timeout(10000),
  });
  if (listing.demo) throw Error("The source returned demo data.");
  const rows = (listing.items || [])
    .filter((d: GraphDesign) => !d.withdrawn)
    .slice(0, 24);
  const designs: GraphDesign[] = [];
  let failed = 0;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        try {
          const d = await eel(
            "circuit-atlas/designs/" + encodeURIComponent(row.id),
            guest,
            { signal: AbortSignal.timeout(7000) },
          );
          if (d.demo || !d.design?.bom?.items) throw Error("BOM unavailable");
          designs.push(d.design);
        } catch {
          failed++;
        }
      }
    }),
  );
  if (rows.length && !designs.length)
    throw Error("No project BOM could be loaded. Please retry later.");
  // Preserve catalogue order, independent of request completion order.
  designs.sort(
    (a, b) =>
      rows.findIndex((r: GraphDesign) => r.id === a.id) -
      rows.findIndex((r: GraphDesign) => r.id === b.id),
  );
  const graph = buildComponentGraph(designs, focus);
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    scope: {
      requested: rows.length,
      loaded: designs.length,
      failed,
      projects: graph.projects,
      truncated: designs.filter((d) => d.bom?.truncated).length,
      catalogueTotal: listing.total || 0,
      generatedAt: new Date().toISOString(),
      sourceDate: listing.source?.sourceDate || null,
      matchedPart: focus,
      eligibleNodes: graph.eligibleNodes,
    },
  };
}
export async function GET(req: NextRequest) {
  try {
    rateLimit(req.headers.get("x-forwarded-for")?.split(",")[0] || "local");
    const focus = (req.nextUrl.searchParams.get("mpn") || "").trim();
    if (focus.length > 120)
      return NextResponse.json(
        { error: "Part number too long" },
        { status: 400 },
      );
    const key = focus.toUpperCase();
    let hit = cache.get(key);
    if (!hit || hit.until < Date.now()) {
      if (cache.size >= 32) cache.delete(cache.keys().next().value!);
      const promise = generate(focus, randomUUID());
      hit = { until: Date.now() + 600000, promise };
      cache.set(key, hit);
      promise.catch(() => {
        if (cache.get(key)?.promise === promise) cache.delete(key);
      });
    }
    return NextResponse.json(await hit.promise, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Graph unavailable" },
      { status: 502 },
    );
  }
}
