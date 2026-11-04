import { identify } from "@/lib/maker/identify";
import { admitFile, meteredStream } from "@/lib/maker/limits";
import { fetchSignal, withRequestDeadline } from "@/lib/maker/request-context";
import { limitRoute } from "@/lib/maker/limits";
export const runtime = "nodejs";
export const maxDuration = 30;
import { boundedBody } from "@/vendor/canon/lib/allegro-http";

/** Only the manufacturer's public KiCad model directory; no user-supplied URL/host. */
/** Within one deadline and the client's cancel signal: the upstream download stops if the visitor leaves. */
export async function GET(request: Request) {
  return withRequestDeadline(27000, request.signal, () => get(request), await identify(request));
}

async function get(request: Request) {
  const limited = await limitRoute(request, "files");
  if (limited) return limited;
  try {
    await admitFile("esp3d:" + (new URL(request.url).searchParams.get("path") ?? ""));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Too many requests." }, { status: 429 });
  }
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!/^[\w.+()-]+\.(step|stp|wrl)$/i.test(path))
    return new Response("Invalid model path", { status: 400 });
  const url = `https://raw.githubusercontent.com/espressif/kicad-libraries/main/3dmodels/espressif.3dshapes/${encodeURIComponent(path)}`;
  const redirect = () =>
    new Response(null, {
      status: 307,
      headers: { Location: url, "Cache-Control": "public, max-age=86400" },
    });
  try {
    const response = await fetch(url, {
      signal: fetchSignal(20000),
      redirect: "error",
      next: { revalidate: 86400 },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return new Response("Manufacturer model unavailable", {
        status: response.status === 404 ? 404 : 502,
      });
    }
    // Large STEP files bypass the function response body limit via the allowlisted, CORS-enabled vendor URL.
    const length = Number(response.headers.get("content-length"));
    if (length > 20 * 1024 * 1024) {
      await response.body?.cancel();
      return new Response("Model too large", { status: 413 });
    }
    if (length > 4 * 1024 * 1024) {
      await response.body?.cancel();
      return redirect();
    }
    const bytes = await boundedBody(response.body, 20 * 1024 * 1024);
    if (bytes.byteLength > 4 * 1024 * 1024) return redirect();
    return new Response(meteredStream(new Blob([bytes]).stream()), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    });
  } catch {
    return new Response("Manufacturer model request failed", { status: 502 });
  }
}
