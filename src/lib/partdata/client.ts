import "server-only";
import { fetchSignal, remainingMs, sharedFetchSignal } from "@/lib/maker/request-context";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * partdata counts every call that carries X-End-User against that visitor's daily allowance.
 * One visitor action (a search, opening the graph, a BOM match) fans out into many upstream
 * calls, so within one request to this site only the FIRST upstream call is attributed to the
 * visitor; the rest count only toward the partner key's daily total. Passive lookups the
 * visitor did not ask for (card pictures, README intros) are never attributed.
 */
const visitorScope = new AsyncLocalStorage<{ charged: boolean }>();
export function oneVisitorCharge<T>(fn: () => T, { passive = false }: { passive?: boolean } = {}): T {
  return visitorScope.run({ charged: passive }, fn);
}
function attribute(visitor?: string) {
  const scope = visitorScope.getStore();
  if (!visitor || !scope) return visitor;
  if (scope.charged) return undefined;
  scope.charged = true;
  return visitor;
}

/**
 * Signed server-side client for the ezPLM data platform Partner API
 * (gongyueetree/ezplm_partdata, docs/PUBLIC_API.md).
 *
 *   browser → this app's /api/maker/* routes (visitor limits, cache) → partdata
 *
 * Credentials are server-only environment variables. Never prefix them with NEXT_PUBLIC_.
 */
const BASE = () => (process.env.PARTDATA_API_BASE || "").replace(/\/$/, "");
const KEY = () => process.env.PARTDATA_API_KEY || "";
const SECRET = () => process.env.PARTDATA_API_SECRET || "";

export function partdataConfigured() {
  return Boolean(BASE() && KEY() && SECRET());
}

export class PartdataError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = "upstream_error",
    public retryable = false,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined | null>;

/** Same as the platform: (key, value) sorted, encodeURIComponent, empty values dropped. */
export function canonicalQuery(q: Query) {
  return Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => [k, String(v)] as [string, string])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export function signature(secret: string, method: string, path: string, qs: string, ts: string, nonce: string, raw = "") {
  const lines = [method, path, qs, ts, nonce];
  if (raw) lines.push(createHash("sha256").update(raw).digest("hex"));
  return createHmac("sha256", secret).update(lines.join("\n")).digest("base64url");
}

/**
 * Anonymous per-visitor key for X-End-User: sha256(ip + daily salt), first 32 hex chars.
 * The salt rotates daily so the platform cannot link a visitor across days.
 */
export function visitorHash(ip: string) {
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.PARTDATA_VISITOR_SALT || SECRET() || "tindie";
  return createHash("sha256").update(`${ip}|${day}|${salt}`).digest("hex").slice(0, 32);
}

// The platform answers with Cache-Control: private, max-age=600 and asks partners to cache
// identical requests. Responses are public catalogue data (not per-visitor), so one cache
// is shared by all visitors of this instance.
const TTL = 600_000;
const cache = new Map<string, { until: number; value: Promise<any> }>();

function remember(key: string, load: () => Promise<any>) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (cache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.until < now) cache.delete(k);
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  }
  const value = load();
  cache.set(key, { until: Date.now() + TTL, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

/**
 * Admin → Discover traffic → "Parts database errors": which kind of failure, on which endpoint, how
 * often per day (lib/maker-analytics.ts). Best-effort; never affects the request.
 */
function noteFailure(path: string, kind: string, ms: number) {
  const endpoint = path.replace(/\/(p|d)_[a-z2-7]+/g, "/{id}").replace(/\/families\/[^/]+/, "/families/{family}").slice(0, 60);
  console.error("[partdata]", kind, endpoint, `${ms} ms`);
  void import("@/lib/maker-analytics")
    .then(({ recordTerm }) => recordTerm("error:partdata", `${kind} · ${endpoint}`))
    .catch(() => undefined);
}

const MESSAGES: Record<string, string> = {
  unauthorized: "The data service rejected this site's credentials.",
  bad_signature: "The data service rejected this site's request signature.",
  timestamp_out_of_window: "The server clock is out of sync with the data service.",
  forbidden_scope: "This site's data key does not include that permission.",
  rate_limited: "The parts database is busy. Please try again in a minute.",
  quota_exceeded: "Today's parts database quota is used up. Please try again tomorrow.",
  visitor_quota_exceeded: "You have reached today's lookup limit. Please try again tomorrow.",
  detail_quota_exceeded: "Today's part-detail quota is used up. Search results remain available.",
  query_too_short: "Enter at least 3 characters of a part number.",
};

async function send(method: "GET" | "POST", path: string, query: Query, body: unknown, visitor?: string) {
  if (!partdataConfigured())
    throw new PartdataError(
      "The parts database is not connected yet (PARTDATA_API_BASE / KEY / SECRET).",
      503,
      "unconfigured",
    );
  visitor = attribute(visitor);
  const qs = canonicalQuery(query);
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(12).toString("hex");
  let res: Response;
  const t0 = Date.now();
  try {
    res = await fetch(`${BASE()}${path}${qs ? "?" + qs : ""}`, {
      method,
      cache: "no-store",
      redirect: "error",
      signal: sharedFetchSignal(20000),
      headers: {
        Accept: "application/json",
        "X-Api-Key": KEY(),
        "X-Timestamp": ts,
        "X-Nonce": nonce,
        "X-Signature": signature(SECRET(), method, path, qs, ts, nonce, raw),
        ...(visitor ? { "X-End-User": visitor } : {}),
        ...(raw ? { "Content-Type": "application/json" } : {}),
      },
      body: raw || undefined,
    });
  } catch (e) {
    // A timeout (the request's time ran out) and a failed connection are told apart: only the
    // second is worth an immediate retry (pdGet), and both are recorded for the admin dashboard.
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    noteFailure(path, timedOut ? "timeout" : "unreachable", Date.now() - t0);
    throw new PartdataError(
      timedOut ? "The parts database did not answer in time. Please retry." : "The parts database is unreachable right now. Please retry.",
      timedOut ? 504 : 502,
      timedOut ? "timeout" : "unreachable",
      true,
    );
  }
  if (!res.ok && res.status !== 404) noteFailure(path, `HTTP ${res.status}`, Date.now() - t0);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // FastAPI wraps HTTPException detail as {"detail": {...}}; KG routes return {"error": {...}} directly.
    const err = json?.error ?? json?.detail?.error ?? {};
    const code = String(err.code || "upstream_error");
    if (res.status >= 500 || code === "unauthorized" || code === "bad_signature")
      console.error("[partdata]", method, path, res.status, code);
    throw new PartdataError(
      MESSAGES[code] || (res.status === 404 ? "Not found in the parts database." : `The parts database returned HTTP ${res.status}.`),
      res.status === 401 || res.status === 403 ? 502 : res.status,
      code,
      Boolean(err.retryable),
    );
  }
  if (!json || typeof json !== "object" || !("data" in json))
    throw new PartdataError("The parts database returned an unexpected response.");
  return json as { data: any; meta: any };
}

/** Signed GET, cached for 10 minutes per path + query. */
export function pdGet(path: string, query: Query = {}, visitor?: string): Promise<{ data: any; meta: any }> {
  // A GET that fails with a server error (500/503) is tried once more after a short pause, when the
  // request still has time: a passing hiccup should not show the visitor an error banner.
  const once = () => send("GET", path, query, undefined, visitor);
  return remember(`GET ${path}?${canonicalQuery(query)}`, () =>
    once().catch(async (e) => {
      // Server errors and failed connections (a restart, a dropped connection) are tried once more;
      // a timeout is not (the time is already spent).
      if (!(e instanceof PartdataError) || e.status < 500 || e.code === "timeout" || remainingMs() < 5_000) throw e;
      await new Promise((r) => setTimeout(r, 400));
      return once();
    }),
  );
}

/** Signed POST, cached by body hash (BOM matching of the same rows is common while editing). */
export function pdPost(path: string, body: unknown, visitor?: string): Promise<{ data: any; meta: any }> {
  const key = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return remember(`POST ${path} ${key}`, () => send("POST", path, {}, body, visitor));
}

/**
 * Admin connection check: one uncached signed GET of the knowledge-graph snapshot.
 * Reports host (not the key), latency, HTTP status and the remaining daily quota header.
 */
export async function pdProbe() {
  const base = BASE();
  const out: Record<string, unknown> = {
    configured: partdataConfigured(),
    host: base ? new URL(base).host : null,
    keyId: KEY() ? KEY().slice(0, 6) + "…" : null,
  };
  if (!partdataConfigured()) return out;
  const path = "/api/kg/v1/snapshots/current";
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(12).toString("hex");
  const t0 = Date.now();
  try {
    const r = await fetch(base + path, {
      cache: "no-store",
      signal: sharedFetchSignal(15000),
      headers: {
        Accept: "application/json",
        "X-Api-Key": KEY(),
        "X-Timestamp": ts,
        "X-Nonce": nonce,
        "X-Signature": signature(SECRET(), "GET", path, "", ts, nonce),
      },
    });
    const j = await r.json().catch(() => null);
    Object.assign(out, {
      ok: r.ok,
      status: r.status,
      latencyMs: Date.now() - t0,
      remainingToday: r.headers.get("X-RateLimit-Remaining-Day"),
      error: r.ok ? null : (j?.error ?? j?.detail?.error ?? null),
      snapshot: r.ok
        ? { designs: j?.data?.designs, families: j?.data?.families, pairs: j?.data?.pairs, computedAt: j?.meta?.computed_at }
        : null,
    });
  } catch (e) {
    Object.assign(out, { ok: false, latencyMs: Date.now() - t0, error: { code: "unreachable", message: String(e) } });
  }
  return out;
}

const raws = new Map<string, { until: number; value: Promise<{ type: string; body: Uint8Array }> }>();

/** Signed GET of a non-JSON resource (e.g. a design's board.svg), cached for an hour; at most 2 MB. */
export function pdGetRaw(
  path: string,
  { max = 2 * 1024 * 1024, cache = true }: { max?: number; cache?: boolean } = {},
): Promise<{ type: string; body: Uint8Array }> {
  const hit = cache ? raws.get(path) : undefined;
  if (hit && hit.until > Date.now()) return hit.value;
  if (raws.size > 300) raws.clear();
  const value = (async () => {
    if (!partdataConfigured()) throw new PartdataError("The parts database is not connected.", 503, "unconfigured");
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(12).toString("hex");
    let r: Response;
    try {
      r = await fetch(BASE() + path, {
        cache: "no-store",
        redirect: "error",
        signal: sharedFetchSignal(45000),
        headers: { "X-Api-Key": KEY(), "X-Timestamp": ts, "X-Nonce": nonce, "X-Signature": signature(SECRET(), "GET", path, "", ts, nonce) },
      });
    } catch {
      throw new PartdataError("The parts database is unreachable right now.", 502, "unreachable", true);
    }
    if (!r.ok) throw new PartdataError(r.status === 404 ? "Not found." : `HTTP ${r.status}`, r.status === 404 ? 404 : 502);
    const len = Number(r.headers.get("content-length") || 0);
    if (len > max) throw new PartdataError("File too large.", 502);
    const body = new Uint8Array(await r.arrayBuffer());
    if (body.length > max) throw new PartdataError("File too large.", 502);
    return { type: r.headers.get("content-type") || "application/octet-stream", body };
  })();
  if (!cache) return value;
  raws.set(path, { until: Date.now() + 3600_000, value });
  value.catch(() => raws.delete(path));
  return value;
}

/**
 * Signed GET of a large file (an ezPLM STEP model) passed through as a stream with a byte cap,
 * never held whole in memory. Not cached here (the browser / CDN cache the response).
 */
export async function pdGetStream(path: string, max: number): Promise<{ type: string; stream: ReadableStream<Uint8Array> }> {
  if (!partdataConfigured()) throw new PartdataError("The parts database is not connected.", 503, "unconfigured");
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(12).toString("hex");
  let r: Response;
  try {
    r = await fetch(BASE() + path, {
      cache: "no-store",
      redirect: "error",
      // This stream belongs to this one request: the visitor leaving cancels it (even before headers).
      signal: fetchSignal(45000),
      headers: { "X-Api-Key": KEY(), "X-Timestamp": ts, "X-Nonce": nonce, "X-Signature": signature(SECRET(), "GET", path, "", ts, nonce) },
    });
  } catch {
    throw new PartdataError("The parts database is unreachable right now.", 502, "unreachable", true);
  }
  if (!r.ok) {
    await r.body?.cancel().catch(() => undefined);
    throw new PartdataError(r.status === 404 ? "Not found." : `HTTP ${r.status}`, r.status === 404 ? 404 : 502);
  }
  if (Number(r.headers.get("content-length") || 0) > max) {
    await r.body?.cancel().catch(() => undefined);
    throw new PartdataError("File too large.", 502);
  }
  const { peekStream } = await import("@/lib/maker/stream-body");
  const { stream } = await peekStream(r.body, 0, max);
  return { type: r.headers.get("content-type") || "application/octet-stream", stream };
}
