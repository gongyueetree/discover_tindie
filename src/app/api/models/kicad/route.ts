import { identify } from "@/lib/maker/identify";
import { noteResource } from "@/lib/maker/limits";
import { fetchSignal, withRequestDeadline } from "@/lib/maker/request-context";
import { peekStream } from "@/lib/maker/stream-body";
import { limitRoute } from "@/lib/maker/limits";
export const runtime = "nodejs";
export const maxDuration = 30;
// Public library assets only. No caller-provided hosts, redirects or credentials.
/** Within one deadline and the client's cancel signal: the upstream download stops if the visitor leaves. */
export async function GET(request: Request) {
  return withRequestDeadline(27000, request.signal, () => get(request), await identify(request));
}

async function get(request: Request) {
  const limited = await limitRoute(request, "files");
  if (limited) return limited;
  try {
    await noteResource("file", "kicad3d:" + (new URL(request.url).searchParams.get("path") || ""));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Too many requests." }, { status: 429 });
  }
  const params = new URL(request.url).searchParams,
    path = params.get("path") ?? "",
    revision = params.get("revision") ?? "master";
  if (!/^[\w.-]+\.3dshapes\/[\w.+()-]+\.(?:step|stp|wrl)$/i.test(path))
    return new Response("Invalid model path", { status: 400 });
  if (revision !== "master" && !/^[a-f0-9]{40}$/.test(revision))
    return new Response("Invalid revision", { status: 400 });
  try {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const url =
      `https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/${revision}/` +
      encoded;
    const mirrorUrl =
      "https://raw.githubusercontent.com/KiCad/kicad-packages3D/master/" +
      encoded;
    let upstream: Response | undefined;
    try {
      upstream = await fetch(url, {
        signal: fetchSignal(18000),
        redirect: "error",
        next: { revalidate: 86400 },
      });
    } catch {
      /* Try the official GitHub mirror on transient GitLab errors. */
    }
    let mirror = false;
    if ((!upstream || !upstream.ok) && revision === "master") {
      await upstream?.body?.cancel();
      upstream = await fetch(mirrorUrl, {
        signal: fetchSignal(9000),
        redirect: "error",
        next: { revalidate: 86400 },
      });
      mirror = true;
    }
    if (!upstream?.ok)
      return new Response("Official KiCad model unavailable", {
        status: upstream?.status === 404 ? 404 : 502,
      });
    // Streamed through with a 20 MB cap (never buffered whole); the header must be STEP or VRML.
    const valid = (bytes: Uint8Array) => {
      const header = new TextDecoder().decode(bytes.subarray(0, 80)).trimStart();
      return header.startsWith("ISO-10303-21;") || header.startsWith("#VRML V2.0");
    };
    const MAX = 20 * 1024 * 1024;
    if (Number(upstream.headers.get("content-length")) > MAX) {
      await upstream.body?.cancel();
      throw Error("Model too large");
    }
    let body = await peekStream(upstream.body, 80, MAX).catch((e) => {
      throw Error(e instanceof Error && e.message === "too large" ? "Model too large" : "empty");
    });
    if (!valid(body.head) && revision === "master" && !mirror) {
      await body.cancel();
      const fallback = await fetch(mirrorUrl, {
        signal: fetchSignal(9000),
        redirect: "error",
        next: { revalidate: 86400 },
      });
      if (!fallback.ok) return new Response("Official model payload invalid", { status: 502 });
      body = await peekStream(fallback.body, 80, MAX);
    }
    if (!valid(body.head)) {
      await body.cancel();
      return new Response("Official model payload invalid", { status: 502 });
    }
    return new Response(body.stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    });
  } catch (e) {
    return new Response(
      e instanceof Error && e.message === "Model too large"
        ? "Model too large"
        : "Official KiCad library request failed",
      {
        status:
          e instanceof Error && e.message === "Model too large" ? 413 : 502,
      },
    );
  }
}
