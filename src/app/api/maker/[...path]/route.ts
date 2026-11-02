import { applySymbolTypography } from "@/lib/maker/symbol-typography";
import { circuitMetadata } from "@/lib/maker/circuit-metadata";
import { englishDisplay, translateTexts } from "@/lib/maker/translation";
import { scanGithub, importGithub } from "@/lib/maker/github-server";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  eel,
  EELIB_BASE,
  search,
  mapPrice,
  SourceError,
  rateLimit,
} from "@/lib/maker/server";
import { boundedBody } from "@/vendor/canon/lib/allegro-http";
import { matchRow } from "@/lib/maker/bom";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function guestId(req: NextRequest) {
  const v = req.cookies.get("maker_guest")?.value;
  return v && /^[a-f0-9-]{36}$/.test(v) ? v : randomUUID();
}
async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const guest = guestId(req);
  const path = params.path;
  const q = req.nextUrl.searchParams;
  let result: any;
  try {
    rateLimit(req.headers.get("x-forwarded-for")?.split(",")[0] || "local");
    if (req.method === "POST" && path[0] === "translate" && path.length === 1) {
      const raw = await req.text();
      if (raw.length > 100000)
        throw new SourceError("Translation request too large.", 413);
      const body = JSON.parse(raw);
      if (
        !Array.isArray(body.texts) ||
        body.texts.length > 100 ||
        body.texts.some(
          (s: unknown) => typeof s !== "string" || s.length > 4000,
        )
      )
        throw new SourceError("Invalid translation text list.", 400);
      result = { texts: await translateTexts(body.texts) };
    } else if (
      req.method === "POST" &&
      path[0] === "github" &&
      path.length === 2
    ) {
      const raw = await req.text();
      if (raw.length > 5000)
        throw new SourceError("Import request too large.", 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new SourceError("Invalid request.", 400);
      }
      if (path[1] === "scan") {
        if (typeof body.url !== "string" || body.url.length > 1000)
          throw new SourceError("Invalid GitHub URL.", 400);
        result = await scanGithub(body.url);
      } else if (path[1] === "import") {
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
    } else if (
      req.method === "GET" &&
      path[0] === "drawings" &&
      path.length === 2 &&
      /^[a-f0-9-]{36}$/.test(path[1])
    ) {
      result = await eel(`circuit-atlas/views/${path[1]}/drawings`, guest);
    } else if (req.method === "GET" && path[0] === "cad" && path.length === 2) {
      result = await eel(
        `components/${encodeURIComponent(path[1])}/ecad-preview`,
        guest,
      );
      if (result.demo)
        throw new SourceError("No live CAD preview is available.");
      if (result.symbol?.preview) {
        try {
          const detail = await eel(`components/${encodeURIComponent(path[1])}`, guest);
          const url = new URL(detail.assets?.kicadSymbol);
          const hosts = (process.env.MAKER_CAD_HOSTS || "qn.ezplm.com").split(",").map(v=>v.trim());
          if (url.protocol === "https:" && !url.username && !url.password && hosts.includes(url.hostname)) {
            const response = await fetch(url, {redirect:"error",signal:AbortSignal.timeout(10000)});
            if (response.ok) {
              const bytes = await boundedBody(response.body, 2 * 1024 * 1024);
              result.symbol.preview = applySymbolTypography(result.symbol.preview, new TextDecoder().decode(bytes));
            }
          }
        } catch { /* Upstream preview remains usable with KiCad default text sizes. */ }
      }
    } else if (
      req.method === "GET" &&
      path[0] === "cad" &&
      path.length === 3 &&
      path[2] === "model"
    ) {
      const d = await eel(`components/${encodeURIComponent(path[1])}`, guest);
      const raw = d.assets?.model3d;
      if (!raw) throw new SourceError("This component has no 3D model.", 404);
      const u = new URL(raw);
      const allowed = (process.env.MAKER_CAD_HOSTS || "qn.ezplm.com")
        .split(",")
        .filter(Boolean);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        !allowed.some((h) => u.hostname === h)
      )
        throw new SourceError(
          "The CAD storage host needs to be added to MAKER_CAD_HOSTS on the server.",
          503,
        );
      const r = await fetch(u, {
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok)
        throw new SourceError("The component model is unavailable.", 502);
      const bytes = await boundedBody(r.body, 25 * 1024 * 1024);
      const head = new TextDecoder().decode(bytes.subarray(0, 100)).trimStart();
      if (!head.startsWith("ISO-10303-21;") && !head.startsWith("#VRML V2.0"))
        throw new SourceError(
          "The CAD asset is not a supported STEP / VRML model.",
          422,
        );
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Model-Format": head.startsWith("#VRML") ? "wrl" : "step",
          "Cache-Control": "private,max-age=300",
        },
      });
    } else if (
      req.method === "GET" &&
      path[0] === "parts" &&
      path.length === 1
    ) {
      const query = (q.get("q") || "").trim();
      if (query.length < 2 || query.length > 120)
        throw new SourceError("Enter 2–120 characters.", 400);
      result = await search(query, guest);
    } else if (
      req.method === "GET" &&
      path[0] === "pricing" &&
      path.length === 2
    ) {
      let offers: ReturnType<typeof mapPrice>[] = [],
        partialSources: unknown[] = [];
      try {
        const p = await eel(
          `pricing/${encodeURIComponent(path[1])}?currency=USD&qty=${Math.max(1, Math.min(100000, Number(q.get("qty")) || 1))}&manufacturer=${encodeURIComponent(q.get("manufacturer") || "")}`,
          guest,
        );
        offers = (p.offers || []).map(mapPrice);
        partialSources = p.partialSources || [];
      } catch (e) {
        partialSources.push({
          source: "eelib pricing",
          status: "error",
          message: e instanceof Error ? e.message : "Pricing unavailable",
        });
      }
      const direct = await search(path[1], guest, true);
      const identity = (s: string) =>
        s
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .replace(/^STMICROELECTRONICS$/, "ST");
      const manufacturer = q.get("manufacturer") || "";
      offers.push(
        ...direct.items
          .filter(
            (p) =>
              p.mpn.toUpperCase() === path[1].toUpperCase() &&
              (!manufacturer ||
                identity(p.manufacturer) === identity(manufacturer)),
          )
          .flatMap((p) => p.offers),
      );
      result = {
        offers,
        partialSources: [...partialSources, ...direct.sources],
      };
    } else if (
      req.method === "GET" &&
      path[0] === "references" &&
      path.length === 2
    ) {
      const usages = await eel(
        `circuit-atlas/part-usages?${new URLSearchParams({ mpn: path[1], limit: "50" })}`,
        guest,
      );
      result = {
        items: (usages.exact || [])
          .filter((u: any) => u.line?.how === "mpn_exact")
          .map((u: any) => ({
            ...u.design,
            designators: u.line.designators,
            matchedMpn: u.line.mpn,
          })),
        limit: 50,
      };
    } else if (
      req.method === "GET" &&
      path[0] === "circuits" &&
      path.length === 1
    ) {
      const query = new URLSearchParams({ limit: "24" });
      for (const key of ["q", "module", "category", "cursor", "mpn"]) {
        const v = q.get(key);
        if (v && v.length <= 220) query.set(key, v);
      }
      // Optional authenticated, globally ranked catalogue supplied by the data owner.
      // It must use the same design IDs and filters/cursors as CircuitAtlas.
      if (process.env.EELIB_RANKED_CIRCUITS_URL) {
        const u = new URL(process.env.EELIB_RANKED_CIRCUITS_URL);
        if (u.protocol !== "https:")
          throw new SourceError("Ranked catalogue must use HTTPS.", 503);
        for (const [k, v] of query) u.searchParams.set(k, v);
        u.searchParams.set("sort", "stars_desc");
        const r = await fetch(u, {
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            Accept: "application/json",
            ...(process.env.EELIB_RANKED_CIRCUITS_TOKEN
              ? {
                  Authorization: `Bearer ${process.env.EELIB_RANKED_CIRCUITS_TOKEN}`,
                }
              : {}),
          },
        });
        if (!r.ok)
          throw new SourceError("Ranked catalogue is unavailable.", r.status);
        const payload = await r.json();
        result = payload.data ?? payload;
        if (!Array.isArray(result.items) || result.sort !== "stars_desc")
          throw new SourceError(
            "Ranked catalogue did not confirm global Star ordering.",
            502,
          );
        result = { ...result, ordering: "stars_desc" };
      } else {
        result = await eel(`circuit-atlas/designs?${query}`, guest);
        result = { ...result, ordering: "catalogue", rankingAvailable: false };
      }
      result.items = (result.items || []).map(circuitMetadata);
    } else if (
      req.method === "GET" &&
      path[0] === "categories" &&
      path.length === 1
    ) {
      result = await eel("circuit-atlas/module-categories", guest);
    } else if (
      path[0] === "circuits" &&
      /^[a-zA-Z0-9._:-]{1,120}$/.test(path[1] || "")
    ) {
      const id = encodeURIComponent(path[1]);
      if (req.method === "GET" && path.length === 2)
        result = await eel(`circuit-atlas/designs/${id}`, guest);
      else if (
        req.method === "POST" &&
        path[2] === "view" &&
        path.length === 3
      ) {
        result = await eel(`circuit-atlas/designs/${id}/view`, guest, {
          method: "POST",
        });
      } else if (
        req.method === "GET" &&
        path[2] === "view" &&
        path.length === 3
      ) {
        const d = await eel(`circuit-atlas/designs/${id}/view`, guest);
        if (d.view?.state !== "ready")
          throw new SourceError(
            "This preview is not ready yet. Request preparation below, then refresh once the catalogue finishes parsing.",
            409,
          );
        const bundle = await eel(
          `circuit-atlas/views/${encodeURIComponent(d.view.id)}/ir`,
          guest,
        );
        result = { bundle, view: d.view };
      } else if (
        req.method === "GET" &&
        path[2] === "download" &&
        path.length === 3
      ) {
        if (!process.env.EELIB_DOWNLOAD_SERVICE_TOKEN)
          throw new SourceError(
            "Original ZIP downloads require the eelib download service to authorize anonymous Tindie access. Online viewing remains available.",
            503,
          );
        const d = await eel(`circuit-atlas/designs/${id}/download`, guest, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.EELIB_DOWNLOAD_SERVICE_TOKEN}`,
          },
        });
        const url = new URL(d.download?.url || d.download);
        const allowed = (process.env.EELIB_DOWNLOAD_HOSTS || "")
          .split(",")
          .filter(Boolean);
        if (url.protocol !== "https:" || !allowed.includes(url.hostname))
          throw new SourceError(
            "Download storage host is not configured.",
            503,
          );
        const r = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) throw new SourceError("Project download unavailable.");
        if (Number(r.headers.get("content-length")) > 75 * 1024 * 1024)
          throw new SourceError("Archive exceeds 75 MB.", 413);
        return new Response(await boundedBody(r.body, 75 * 1024 * 1024), {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${id.replace(/[^\w-]/g, "")}.zip"`,
            "Cache-Control": "no-store",
          },
        });
      } else throw new SourceError("Not found", 404);
    } else if (
      req.method === "GET" &&
      path[0] === "thumbnail" &&
      /^[a-f0-9]{64}\.svg$/.test(path[1] || "") &&
      path.length === 2
    ) {
      const r = await fetch(
        `${EELIB_BASE}/circuit-atlas/thumbnails/${path[1]}`,
        { redirect: "error", signal: AbortSignal.timeout(15000) },
      );
      return new Response(r.body, {
        status: r.status,
        headers: {
          "Content-Type": "image/svg+xml",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          "Cache-Control": "public,max-age=3600",
        },
      });
    } else if (
      req.method === "GET" &&
      path[0] === "models" &&
      /^[a-f0-9-]{36}$/.test(path[1] || "")
    ) {
      if (path.length === 2)
        result = await eel(`circuit-atlas/views/${path[1]}/models`, guest);
      else if (path.length === 3 && /^[a-f0-9]{64}$/.test(path[2])) {
        const r = await fetch(
          `${EELIB_BASE}/circuit-atlas/views/${path[1]}/models/${path[2]}`,
          { redirect: "error", signal: AbortSignal.timeout(25000) },
        );
        return new Response(r.body, {
          status: r.status,
          headers: { "Content-Type": "application/octet-stream" },
        });
      } else throw new SourceError("Not found", 404);
    } else if (
      req.method === "POST" &&
      path[0] === "match" &&
      path.length === 1
    ) {
      const raw = await req.text();
      if (raw.length > 100000)
        throw new SourceError("BOM request too large.", 413);
      const body = JSON.parse(raw);
      if (!Array.isArray(body.rows) || body.rows.length > 20)
        throw new SourceError("Match up to 20 rows per batch.", 400);
      const cache = new Map<string, Awaited<ReturnType<typeof search>>>();
      const rows = [];
      for (const row of body.rows) {
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
        const keyword = (
          row.mpn ||
          (/^[A-Za-z][A-Za-z0-9_.+/-]*\d[A-Za-z0-9_.+/-]*$/.test(row.value)
            ? row.value
            : [
                row.value,
                row.package.match(
                  /(?:^|_)(0[2468]0[235]|1206|1210)(?:_|$)/,
                )?.[1] || row.package,
              ]
                .filter(Boolean)
                .join(" "))
        ).slice(0, 120);
        if (keyword.length < 2) {
          rows.push({
            ...row,
            status: "unmatched",
            reason: "No searchable part number or specification.",
          });
          continue;
        }
        if (!cache.has(keyword))
          cache.set(keyword, await search(keyword, guest));
        const s = cache.get(keyword)!;
        rows.push({ ...matchRow(row, s.items), sources: s.sources });
      }
      result = { rows };
    } else throw new SourceError("Not found", 404);
    if (
      ["references", "circuits", "categories"].includes(path[0]) &&
      !path.includes("view")
    )
      result = await englishDisplay(result);
    const res = NextResponse.json(result);
    res.cookies.set("maker_guest", guest, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 86400 * 30,
      path: "/",
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    console.error(
      "[maker-api]",
      path[0],
      e instanceof Error ? e.message : "Unknown error",
      (e as any)?.cause?.code || "",
    );
    const status = e instanceof SourceError ? e.status : 500;
    return NextResponse.json(
      {
        error:
          e instanceof SourceError
            ? e.message
            : "The request could not be completed. Please retry.",
      },
      { status },
    );
  }
}
export const GET = handle;
export const POST = handle;
