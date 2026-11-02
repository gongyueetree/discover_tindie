import { NextRequest, NextResponse } from "next/server";
import { boundedBody } from "@/vendor/canon/lib/allegro-http";
import { eel } from "@/lib/maker/server";
import { randomUUID } from "node:crypto";
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
    signal: AbortSignal.timeout(25000),
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
  try {
    const q = req.nextUrl.searchParams;
    const kind = q.get("kind");
    if (kind === "ezplm") {
      const mpn = q.get("mpn") || "";
      if (!mpn || mpn.length > 120) throw Error("Invalid part number");
      const d = await eel(
        `components/${encodeURIComponent(mpn)}`,
        randomUUID(),
      );
      const raw = d.assets?.kicadFootprint;
      if (!raw)
        throw Error("No source footprint is available for this exact part");
      const u = new URL(raw);
      const hosts = (process.env.MAKER_CAD_HOSTS || "qn.ezplm.com").split(",");
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        !hosts.includes(u.hostname)
      )
        throw Error("CAD storage host is not configured");
      return NextResponse.json({
        text: await read(u.href, false),
        name: d.assets.footprintName || d.package || mpn,
        source: "EZPLM",
        url: u.href,
        model: !!d.assets.model3d,
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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
