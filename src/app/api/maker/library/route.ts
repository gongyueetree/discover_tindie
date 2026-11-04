import { identify } from "@/lib/maker/identify";
import { fetchSignal, withRequestDeadline } from "@/lib/maker/request-context";
import { limitRoute, noteResource } from "@/lib/maker/limits";
import { SourceError } from "@/lib/maker/server";
import { NextRequest, NextResponse } from "next/server";
import { boundedBody } from "@/vendor/canon/lib/allegro-http";
import { visitorHash, oneVisitorCharge } from "@/lib/partdata/client";
import { partDetail, searchPartdata } from "@/lib/partdata/maker";
import { resolveName, footprintUrl, ezplmText } from "@/lib/partdata/kicad-lib";
const API =
  "https://gitlab.com/api/v4/projects/kicad%2Flibraries%2Fkicad-footprints";
const REV = "10.0.0";
const safe = /^[A-Za-z0-9_.+,()-]{1,160}$/;
const cache = new Map<string, { at: number; data: any }>();
async function read(url: string, json = true) {
  const old = cache.get(url);
  if (old && Date.now() - old.at < 3600000) return old.data;
  const r = await fetch(url, {
    redirect: "error",
    signal: fetchSignal(25000),
  });
  if (!r.ok) throw Error(`Library returned HTTP ${r.status}`);
  const bytes = await boundedBody(r.body, 2 * 1024 * 1024);
  const text = new TextDecoder().decode(bytes);
  const data = json ? JSON.parse(text) : text;
  if (cache.size > 300) cache.clear();
  cache.set(url, { at: Date.now(), data });
  return data;
}
export async function GET(req: NextRequest) {
  return withRequestDeadline(50_000, req.signal, () => oneVisitorCharge(() => library(req)), await identify(req));
}

async function library(req: NextRequest) {
  const limited = await limitRoute(req, "files");
  if (limited) return limited;
  try {
    const q = req.nextUrl.searchParams;
    const kind = q.get("kind");
    if (kind === "ezplm") {
      // Footprint named by the Tindie parts database (partdata), drawn from the official KiCad library.
      const partId = q.get("partId") || "";
      const mpn = (q.get("mpn") || "").trim();
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      const visitor = visitorHash(ip);
      let id = /^p_[a-z2-7]{8,40}$/.test(partId) ? partId : "";
      if (!id) {
        if (!mpn || mpn.length > 120) throw Error("Invalid part number");
        const found = await searchPartdata(mpn, visitor);
        const exact = found.items.find((p) => p.mpn.toUpperCase() === mpn.toUpperCase());
        if (!exact) throw Error(`${mpn} is not in the Tindie parts database`);
        id = exact.id;
      }
      // A part's footprint: counted like its page, and an ezPLM file under the same identity as
      // /api/maker/cad/{id}/footprint (one file, one count, whichever way it is opened).
      await noteResource("detail", id);
      const part = await partDetail(id, visitor);
      const fp = resolveName("footprint", part.footprintName);
      if (!part.footprintName) throw Error(`No footprint is recorded for ${part.mpn}`);
      if (!fp && part.ezplmLibrary?.footprint) {
        // Not in the official KiCad library: ezPLM's own library has it.
        await noteResource("file", `cad:${id}:footprint`);
        const name = part.footprintName.split(":").pop()!;
        const text = await ezplmText(id, "footprint").catch(() => {
          throw Error(`The footprint ${part.footprintName} is listed in ezPLM's library, but its file could not be downloaded right now.`);
        });
        return NextResponse.json({
          text,
          name: `ezPLM:${name}`,
          source: "EZPLM",
          url: `/api/maker/cad/${id}/footprint`,
          revision: "ezplm",
          model: part.ezplmLibrary.model,
        });
      }
      if (!fp) throw Error(`Footprint ${part.footprintName} is not in the official KiCad library or ezPLM's library`);
      const url = footprintUrl(fp.library, fp.name);
      return NextResponse.json({
        text: await read(url, false),
        name: `${fp.library}:${fp.name}`,
        source: "KICAD",
        url,
        revision: REV,
        model: true,
      });
    }
    const lib = q.get("library") || "",
      name = q.get("name") || "";
    if ((lib && !safe.test(lib)) || (name && !safe.test(name)))
      return NextResponse.json(
        { error: "Invalid library name" },
        { status: 400 },
      );
    if (kind === "file") {
      if (!lib || !name) throw Error("Choose a footprint");
      const url = `https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/${REV}/${encodeURIComponent(lib + ".pretty")}/${encodeURIComponent(name + ".kicad_mod")}`;
      return NextResponse.json({
        text: await read(url, false),
        name: `${lib}:${name}`,
        source: "KICAD",
        url,
        revision: REV,
      });
    }
    const entries: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const params = new URLSearchParams({
        ref: REV,
        per_page: "100",
        page: String(page),
        ...(lib ? { path: lib + ".pretty" } : {}),
      });
      const data = await read(`${API}/repository/tree?${params}`);
      entries.push(...data);
      if (data.length < 100) break;
      if (page === 20) throw Error("Library listing exceeded its page limit");
    }
    const suffix = lib ? ".kicad_mod" : ".pretty";
    const query = (q.get("q") || "").toLowerCase();
    const names = entries
      .filter((e) => e.name.endsWith(suffix) && (!lib || e.type === "blob"))
      .map((e) => e.name.slice(0, -suffix.length))
      .filter((n: string) => n.toLowerCase().includes(query))
      .sort();
    return NextResponse.json({ names, library: lib, revision: REV });
  } catch (e) {
    if (e instanceof SourceError && e.status === 429) return NextResponse.json({ error: e.message }, { status: 429 });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
