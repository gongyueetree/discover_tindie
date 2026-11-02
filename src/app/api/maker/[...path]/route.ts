import { translateTexts, englishParts } from "@/lib/maker/translation";
import { scanGithub, importGithub, githubReadme, githubRepoOf, githubUsable } from "@/lib/maker/github-server";
import { NextRequest, NextResponse } from "next/server";
import { search, SourceError, rateLimit, asSourceError } from "@/lib/maker/server";
import { matchRow } from "@/lib/maker/bom";
import { visitorHash, pdGetRaw, oneVisitorCharge } from "@/lib/partdata/client";
import { cadPreview, ezplmFile } from "@/lib/partdata/kicad-lib";
import {
  partDetail,
  designsBy,
  designDetail,
  githubSource,
  matchLines,
  familyInfo,
  familyRanking,
  resolveFamily,
  moduleTree,
  plannerParts,
  vendorImage,
  comparePartsBy,
} from "@/lib/partdata/maker";
import type { BomRow } from "@/lib/maker/types";

/**
 * Public Maker Tools API. Browser → here → partdata (signed, cached) / GitHub / distributors.
 * Never exposes partner credentials. All data endpoints are GET except BOM matching,
 * translation and GitHub import.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PART_ID = /^p_[a-z2-7]{8,40}$/;
const DESIGN_ID = /^d_[a-z2-7]{8,40}$/;

function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "local";
}

async function jsonBody(req: NextRequest, max: number) {
  const raw = await req.text();
  if (raw.length > max) throw new SourceError("Request too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new SourceError("Invalid request.", 400);
  }
}

async function handle(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path;
  const q = req.nextUrl.searchParams;
  const ip = clientIp(req);
  const visitor = visitorHash(ip);
  const [head, a] = path;
  let result: any;
  try {
    rateLimit(ip);
    /* ---------------------------------------------------------------- utilities */
    if (req.method === "POST" && head === "translate" && path.length === 1) {
      const body = await jsonBody(req, 100000);
      if (
        !Array.isArray(body.texts) ||
        body.texts.length > 100 ||
        body.texts.some((s: unknown) => typeof s !== "string" || s.length > 4000)
      )
        throw new SourceError("Invalid translation text list.", 400);
      result = { texts: await translateTexts(body.texts) };
    } else if (req.method === "POST" && head === "github" && path.length === 2) {
      const body = await jsonBody(req, 5000);
      if (a === "scan") {
        if (typeof body.url !== "string" || body.url.length > 1000) throw new SourceError("Invalid GitHub URL.", 400);
        result = await scanGithub(body.url);
      } else if (a === "import") {
        if (typeof body.token !== "string" || typeof body.project !== "string")
          throw new SourceError("Select a project first.", 400);
        const archive = await importGithub(body.token, body.project);
        return new Response(archive.bytes, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${archive.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
            "Cache-Control": "no-store",
          },
        });
      } else throw new SourceError("Not found", 404);
    } else if (req.method === "GET" && head === "parts" && path.length === 1) {
      /* ------------------------------------------------------------- components */
      const query = (q.get("q") || "").trim();
      if (query.length < 2 || query.length > 120) throw new SourceError("Enter 2–120 characters.", 400);
      result = await search(query, visitor);
    } else if (req.method === "GET" && head === "parts" && path.length === 2 && PART_ID.test(a)) {
      const [part] = await englishParts([await partDetail(a, visitor)]);
      result = { part };
    } else if (req.method === "GET" && head === "cad" && path.length === 2 && PART_ID.test(a)) {
      // CAD drawn by eelib's preview engine from the official KiCad library entry partdata names.
      const part = await partDetail(a, visitor);
      const ez = part.ezplmLibrary ? { partId: a, ...part.ezplmLibrary } : null;
      result = { mpn: part.mpn, ...(await cadPreview(part.symbolName, part.footprintName, ez)) };
    } else if (req.method === "GET" && head === "cad" && path.length === 3 && PART_ID.test(a) && ["symbol", "footprint", "model"].includes(path[2])) {
      // A part's file from ezPLM's own library (partdata signs and meters the request).
      const kind = path[2] as "symbol" | "footprint" | "model";
      const part = await partDetail(a, visitor);
      if (!part.ezplmLibrary?.[kind]) throw new SourceError("ezPLM's library has no such file for this part.", 404);
      const file = await ezplmFile(a, kind);
      const name = ((kind === "symbol" ? part.symbolName : part.footprintName) || part.mpn).split(":").pop()!.replace(/[^\w.+-]/g, "_").slice(0, 80);
      const ext = { symbol: "kicad_sym", footprint: "kicad_mod", model: "step" }[kind];
      return new Response(file.body as BodyInit, {
        headers: {
          "Content-Type": kind === "model" ? "model/step" : "text/plain; charset=utf-8",
          "Content-Disposition": `${kind === "model" ? "inline" : "attachment"}; filename="${name}.${ext}"`,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } else if (req.method === "GET" && head === "compare" && path.length === 1) {
      /* ------------------------------------------------- alternate comparison (eelib scoring) */
      const ref = (q.get("ref") || "").trim();
      const family = (q.get("family") || "").trim().toUpperCase();
      const given = (q.get("with") || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!ref || ref.length > 120 || given.length > 3 || given.some((x) => x.length > 120) || (family && !/^[A-Z0-9]{2,40}$/.test(family)))
        throw new SourceError("Choose a part and up to three candidates.", 400);
      result = await comparePartsBy(ref, given, family, visitor);
    } else if (req.method === "GET" && head === "pricing" && path.length === 2) {
      /* ------------------------------------------------- distributor quotes (optional) */
      const mpn = decodeURIComponent(a).slice(0, 120);
      const direct = await search(mpn, visitor, true, { partdata: false });
      const identity = (s: string) =>
        s
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .replace(/^STMICROELECTRONICS$/, "ST");
      const manufacturer = q.get("manufacturer") || "";
      result = {
        offers: direct.items
          .filter(
            (p) =>
              p.mpn.toUpperCase() === mpn.toUpperCase() &&
              (!manufacturer || identity(p.manufacturer) === identity(manufacturer)),
          )
          .flatMap((p) => p.offers),
        partialSources: direct.sources.filter((s) => s.source !== "Tindie parts database"),
      };
    } else if (req.method === "GET" && head === "references" && path.length === 2 && PART_ID.test(a)) {
      /* --------------------------------------------------------------- designs */
      result = await designsBy({ part: a }, Math.max(0, Number(q.get("offset")) || 0), visitor, 10);
    } else if (req.method === "GET" && head === "circuits" && path.length === 1) {
      const offset = Math.max(0, Math.min(100, Number(q.get("offset")) || 0));
      const part = q.get("part") || "";
      const mpn = (q.get("mpn") || "").trim();
      const family = (q.get("family") || "").trim().toUpperCase();
      const mod = (q.get("module") || "").trim();
      if (mod && /^[a-z0-9.]{2,40}$/.test(mod)) result = { ...(await designsBy({ function: mod }, offset, visitor)), module: mod };
      else if (part && PART_ID.test(part)) result = await designsBy({ part }, offset, visitor);
      else if (family) result = { ...(await designsBy({ family }, offset, visitor)), family };
      else if (mpn) {
        // An MPN first matches designs that use exactly this part number; if none, its family.
        result = await designsBy({ mpn }, offset, visitor);
        if (!result.items.length && offset === 0) {
          const fam = await resolveFamily(mpn, visitor);
          if (fam) result = { ...(await designsBy({ family: fam }, 0, visitor)), family: fam, widened: true };
        }
      } else throw new SourceError("Choose a component family or enter a part number.", 400);
    } else if (req.method === "GET" && head === "circuits" && path.length === 3 && DESIGN_ID.test(a) && path[2] === "board.svg") {
      // PCB preview generated by the parts database from the design's own board file.
      const svg = await pdGetRaw(`/api/pub/v1/designs/${a}/board.svg`);
      return new Response(svg.body, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } else if (req.method === "GET" && head === "circuits" && path.length === 3 && DESIGN_ID.test(a) && path[2] === "cover") {
      // For a parts database whose design list does not carry pictures yet: one design's picture.
      const d = await designDetail(a, visitor);
      const gh = d.kind === "open_source" ? githubRepoOf(d.sourceUrl) : null;
      result = {
        url:
          d.kind === "vendor"
            ? await vendorImage(d.sourceUrl)
            : d.coverImageUrl ||
              (gh ? (await githubReadme(gh.repo, gh.commit, gh.subdir)).image : null) ||
              (d.boardPreview ? `/api/maker/circuits/${a}/board.svg` : null),
      };
    } else if (req.method === "GET" && head === "circuits" && path.length === 3 && DESIGN_ID.test(a) && path[2] === "usable") {
      // Whether the design's repository holds files the viewer can open (null = could not tell).
      const d = await designDetail(a, visitor);
      result = { usable: d.kind === "vendor" ? true : /^https:\/\/github\.com\//.test(d.sourceUrl) ? await githubUsable(d.sourceUrl) : null };
    } else if (req.method === "GET" && head === "circuits" && path.length === 3 && DESIGN_ID.test(a) && path[2] === "about") {
      // Short introduction from the repository README (open-source designs only).
      const d = await designDetail(a, visitor);
      const gh = d.kind === "open_source" ? githubRepoOf(d.sourceUrl) : null;
      const info = gh ? await githubReadme(gh.repo, gh.commit, gh.subdir) : null;
      result = { intro: info?.intro || null, readmeUrl: info?.readmeUrl || null };
    } else if (req.method === "GET" && head === "circuits" && path.length === 2 && DESIGN_ID.test(a)) {
      const design = await designDetail(a, visitor);
      result = { design, github: design.kind === "open_source" ? githubSource(design.sourceUrl) : null };
    } else if (req.method === "GET" && head === "modules" && path.length === 1) {
      result = { items: await moduleTree() };
    } else if (req.method === "GET" && head === "planner-parts" && path.length === 1) {
      const query = (q.get("q") || "").trim();
      if (query.length < 2 || query.length > 120) throw new SourceError("Enter 2–120 characters.", 400);
      const [items] = [await englishParts(await plannerParts(query, visitor))];
      result = { items };
    } else if (req.method === "GET" && head === "families" && path.length === 1) {
      /* -------------------------------------------------------- knowledge graph */
      result = await familyRanking(
        (q.get("kind") || "").slice(0, 20),
        (q.get("q") || "").slice(0, 60),
        Math.max(0, Math.min(1000, Number(q.get("offset")) || 0)),
        visitor,
      );
    } else if (req.method === "GET" && head === "families" && path.length === 2) {
      result = await familyInfo(decodeURIComponent(a).toUpperCase(), visitor);
    } else if (req.method === "POST" && head === "match" && path.length === 1) {
      /* ---------------------------------------------------------- BOM matching */
      const body = await jsonBody(req, 100000);
      if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 20)
        throw new SourceError("Match 1–20 rows per batch.", 400);
      const rows: BomRow[] = body.rows.map((row: any) => {
        if (
          typeof row.id !== "string" ||
          typeof row.mpn !== "string" ||
          typeof row.value !== "string" ||
          typeof row.manufacturer !== "string" ||
          typeof row.package !== "string" ||
          !Number.isInteger(row.quantity) ||
          row.quantity < 0 ||
          row.quantity > 100000
        )
          throw new SourceError("Invalid BOM row.", 400);
        return { ...row, reference: String(row.reference || row.id).slice(0, 300), original: {}, status: "unmatched" };
      });
      result = { rows: await matchBomRows(rows, visitor) };
    } else throw new SourceError("Not found", 404);

    const res = NextResponse.json(result);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    const err = asSourceError(e);
    if (err.status >= 500) console.error("[maker-api]", head, err.status, err.message);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}

/** A searchable keyword for a row: full MPN, otherwise value (+ package size) for distributor search. */
function keyword(row: BomRow) {
  if (row.mpn) return row.mpn.slice(0, 120);
  if (/^[A-Za-z][A-Za-z0-9_.+/-]*\d[A-Za-z0-9_.+/-]*$/.test(row.value)) return row.value.slice(0, 120);
  const size = row.package.match(/(?:^|_)(0[2468]0[235]|1206|1210)(?:_|$)/)?.[1] || row.package;
  return [row.value, size].filter(Boolean).join(" ").slice(0, 120);
}

/**
 * One partdata /bom/match call for the whole batch (billed per 10 rows), then a distributor
 * search only for rows partdata could not identify. partdata never guesses: "ambiguous" and
 * "candidates" stay in review until the visitor confirms one.
 */
async function matchBomRows(rows: BomRow[], visitor: string): Promise<BomRow[]> {
  const sources = [{ source: "Tindie parts database", status: "ready" as const }];
  let lines: Awaited<ReturnType<typeof matchLines>> = [];
  let partdataError = "";
  const askable = rows.filter((r) => keyword(r).replace(/[^A-Za-z0-9]/g, "").length >= 3);
  if (askable.length)
    try {
      lines = await matchLines(
        askable.map((r) => ({ ref: r.id, mpn: r.mpn, manufacturer: r.manufacturer, value: r.mpn ? "" : r.value })),
        visitor,
      );
    } catch (e) {
      partdataError = asSourceError(e).message;
    }
  const byRef = new Map(lines.map((l) => [l.ref, l]));
  const out: BomRow[] = [];
  for (const row of rows) {
    const line = byRef.get(row.id);
    const st = partdataError
      ? [{ source: "Tindie parts database", status: "error" as const, message: partdataError }]
      : sources;
    if (line?.status === "exact" && line.items[0]) {
      out.push({
        ...row,
        candidates: line.items,
        selected: line.items[0],
        status: "exact",
        reason: "Unique full part number match in the Tindie parts database.",
        sources: st,
      });
      continue;
    }
    if (line && (line.status === "ambiguous" || line.status === "candidates") && line.items.length) {
      out.push({
        ...row,
        candidates: line.items,
        selected: undefined,
        status: "review",
        reason:
          line.status === "ambiguous"
            ? "Same part number from more than one manufacturer — choose one."
            : "Only a longer part number matched (prefix) — confirm before use.",
        sources: st,
      });
      continue;
    }
    // not_found (or no searchable MPN): distributors, when configured.
    const kw = keyword(row);
    if (kw.length < 2) {
      out.push({ ...row, status: "unmatched", reason: "No searchable part number or specification.", sources: st });
      continue;
    }
    try {
      const s = await search(kw, visitor, true, { partdata: false });
      const others = s.items.filter((p) => p.source !== "Tindie parts database");
      out.push({ ...matchRow(row, others), sources: [...st, ...s.sources.filter((x) => x.source !== "Tindie parts database")] });
    } catch {
      out.push({ ...row, status: "unmatched", reason: "Not found in the Tindie parts database.", sources: st });
    }
  }
  return out;
}

// Card pictures and README intros load by themselves as the visitor scrolls: never charged.
const PASSIVE = /^circuits\/[^/]+\/(cover|about|usable|board\.svg)$|^modules$|^translate$/;
const charged = (req: NextRequest, ctx: { params: { path: string[] } }) =>
  oneVisitorCharge(() => handle(req, ctx), { passive: PASSIVE.test(ctx.params.path.join("/")) });
export const GET = charged;
export const POST = charged;
