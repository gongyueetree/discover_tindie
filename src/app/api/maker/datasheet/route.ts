import { NextRequest } from "next/server";
import { boundedBody } from "@/vendor/canon/lib/allegro-http";
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
export async function GET(req: NextRequest) {
  try {
    let url = new URL(req.nextUrl.searchParams.get("url") || "");
    const signal = AbortSignal.timeout(25000);
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
      const bytes = await boundedBody(r.body, 30 * 1024 * 1024);
      if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-"))
        throw Error("The source does not provide a readable PDF");
      return new Response(bytes, {
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
