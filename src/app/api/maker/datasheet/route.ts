import { identify } from "@/lib/maker/identify";
import { admitFile, meteredStream } from "@/lib/maker/limits";
import { fetchSignal, withRequestDeadline } from "@/lib/maker/request-context";
import { limitRoute } from "@/lib/maker/limits";
import { NextRequest } from "next/server";
import { peekStream } from "@/lib/maker/stream-body";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const hosts = [
  "qn.ezplm.com",
  "ezplm.cn",
  "st.com",
  "st.com.cn",
  "ti.com",
  "analog.com",
  "nxp.com",
  "microchip.com",
  "onsemi.com",
  "infineon.com",
  "mouser.com",
  "mouser.cn",
  "digikey.com",
  "lcsc.com",
  "espressif.com",
  "renesas.com",
  "nexperia.com",
  "rohm.com",
  "toshiba.com",
  "silabs.com",
  "diodes.com",
];
function allowed(u: URL) {
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    (!u.port || u.port === "443") &&
    [
      ...hosts,
      ...(process.env.MAKER_DATASHEET_HOSTS || "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean),
    ].some((h) => u.hostname === h || u.hostname.endsWith("." + h))
  );
}
/** Within one deadline and the client's cancel signal: the upstream download stops if the visitor leaves. */
export async function GET(req: NextRequest) {
  return withRequestDeadline(50000, req.signal, () => get(req), await identify(req));
}

async function get(req: NextRequest) {
  const limited = await limitRoute(req, "files");
  if (limited) return limited;
  try {
    // The datasheet's full URL (without a #fragment, which never changes the file) is its identity.
    const raw = req.nextUrl.searchParams.get("url") || "";
    let id = raw;
    try {
      const u = new URL(raw);
      u.hash = "";
      id = u.href;
    } catch {
      /* rejected below */
    }
    await admitFile("datasheet:" + id);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Too many requests." }, { status: 429 });
  }
  try {
    let url = new URL(req.nextUrl.searchParams.get("url") || "");
    const signal = fetchSignal(25000);
    for (let i = 0; i < 5; i++) {
      if (!allowed(url))
        return new Response(
          "This datasheet host is not enabled for inline reading.",
          { status: 400 },
        );
      const r = await fetch(url, {
        redirect: "manual",
        signal,
        headers: { Accept: "application/pdf" },
      });
      if (r.status >= 300 && r.status < 400) {
        const location = r.headers.get("location");
        await r.body?.cancel();
        if (!location) throw Error("Missing redirect destination");
        url = new URL(location, url);
        continue;
      }
      if (!r.ok) {
        await r.body?.cancel();
        throw Error("Datasheet source returned HTTP " + r.status);
      }
      if (Number(r.headers.get("content-length")) > 30 * 1024 * 1024) {
        await r.body?.cancel();
        throw Error("Datasheet exceeds the 30 MB reading limit");
      }
      // Streamed through (never buffered whole); the first 1 KB must look like a PDF.
      const { head, stream, cancel } = await peekStream(r.body, 1024, 30 * 1024 * 1024);
      if (!new TextDecoder().decode(head.subarray(0, 1024)).includes("%PDF-")) {
        await cancel();
        throw Error("The source does not provide a readable PDF");
      }
      return new Response(meteredStream(stream), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="datasheet.pdf"',
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    throw Error("Too many source redirects");
  } catch (e) {
    return new Response(
      e instanceof Error ? e.message : "Datasheet unavailable",
      { status: 502 },
    );
  }
}
