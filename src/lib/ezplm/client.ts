import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { fetchSignal } from "@/lib/maker/request-context";
import { categoryEn, hasCjk, manufacturerCanonical, manufacturerEn } from "@/lib/partdata/glossary";
import type { Part } from "@/lib/maker/types";

/* ============================================================================
   ezPLM public query API (read only), called directly from the server.
   GET /api/v1/api-key/parts?keyword=&pageSize=   (whitelisted manufacturers only, daily call limit)
   Auth: X-API-Key, X-Timestamp (Unix seconds), X-Nonce (single use) and
   X-Signature = base64url(HMAC-SHA256(key, METHOD \n path \n sorted encoded query \n timestamp \n nonce)).
   The key is the HMAC secret unless EZPLM_API_SECRET is given. Credentials never leave the server.
============================================================================ */

export const EZPLM_SOURCE = "ezPLM";
const PARTS_PATH = "/api/v1/api-key/parts";

export const ezplmConfigured = () => !!process.env.EZPLM_API_KEY?.trim();
const base = () => (process.env.EZPLM_API_BASE || "https://www.ezplm.cn").replace(/\/+$/, "");

/** Sorted (key, then value), URL-encoded query: used both in the signature and in the URL. */
export function canonicalQuery(query: Record<string, string | number | undefined | null>) {
  return Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => [String(k), String(v)] as [string, string])
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export function signature(secret: string, method: string, path: string, query: string, timestamp: string, nonce: string) {
  return createHmac("sha256", secret).update([method.toUpperCase(), path, query, timestamp, nonce].join("\n")).digest("base64url");
}

export function signedHeaders(method: string, path: string, query: string, now = Date.now(), nonce: string = randomUUID()) {
  const key = process.env.EZPLM_API_KEY?.trim() || "";
  const secret = process.env.EZPLM_API_SECRET?.trim() || key;
  const timestamp = String(Math.floor(now / 1000));
  return {
    "X-API-Key": key,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Signature": signature(secret, method, path, query, timestamp, nonce),
    Accept: "application/json",
  };
}

/** A field that may be a string or an object such as { name } / { value } / { url }. */
function text(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["enName", "name", "value", "title", "label", "text", "cnName"]) if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim();
    if (typeof o.url === "string") return o.url;
  }
  return undefined;
}
function link(v: unknown) {
  const s = typeof v === "object" && v && typeof (v as any).url === "string" ? (v as any).url : text(v);
  try {
    const u = new URL(String(s));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
/** attributes: an object { name: value } or a list of { name, value } (both seen in ezPLM data). */
function parameters(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: unknown, val: unknown) => {
    const key = text(k);
    const value = text(val);
    if (key && value && Object.keys(out).length < 40) out[key.slice(0, 80)] = value.slice(0, 200);
  };
  if (Array.isArray(v)) for (const a of v) put(a?.name ?? a?.key ?? a?.label, a?.value ?? a?.val);
  else if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) put(k, val);
  return out;
}

export function toPart(p: any): Part | null {
  const id = p?.id ?? p?.partlibId ?? p?.partLibId;
  const mpn = text(p?.mpn ?? p?.MPN ?? p?.partNumber);
  if (!id || !mpn) return null;
  const maker = text(p.manufacturer) ?? text(p.mfr) ?? text(p.supplier) ?? "";
  const description = text(p.description) ?? text(p.desc) ?? text(p.productName) ?? "";
  const params = parameters(p.attributes);
  const category = text(p.category);
  return {
    id: "ez:" + String(id),
    mpn,
    manufacturer: manufacturerEn(manufacturerCanonical(maker)) || maker,
    description,
    package: text(p.package) ?? text(p.packageName),
    datasheet: link(p.pdf ?? p.datasheet),
    productUrl: link(p.officialUrl),
    category: category ? categoryEn(category) : undefined,
    symbolName: text(p.symbol) ?? null,
    footprintName: text(p.footprint) ?? null,
    source: EZPLM_SOURCE,
    parameters: params,
    cad: [],
    offers: [],
    fieldSources: { mpn: "ezplm", manufacturer: "ezplm", description: "ezplm" },
    ...(hasCjk(maker) || hasCjk(description) || Object.entries(params).some(([k, v]) => hasCjk(k) || hasCjk(v))
      ? { originalText: { description, parameters: params } }
      : {}),
  };
}

function rows(d: any): any[] {
  for (const x of [d?.data?.list, d?.data?.items, d?.data?.data, d?.data, d?.items]) if (Array.isArray(x)) return x;
  return [];
}

/** One parts query (one call against ezPLM's daily limit). 429 → Error("RATE_LIMITED") with daily = true. */
export async function searchParts(keyword: string, pageSize = 10): Promise<Part[]> {
  const query = canonicalQuery({ keyword: keyword.trim(), pageSize: Math.max(1, Math.min(20, pageSize)) });
  const r = await fetch(`${base()}${PARTS_PATH}?${query}`, {
    headers: signedHeaders("GET", PARTS_PATH, query),
    cache: "no-store",
    signal: fetchSignal(10_000),
  });
  if (r.status === 429) throw Object.assign(new Error("RATE_LIMITED"), { daily: true });
  if (r.status === 401 || r.status === 403) throw new Error("OAuth: ezPLM rejected the API key or signature");
  if (!r.ok) throw new Error(`ezPLM HTTP ${r.status}`);
  return rows(await r.json())
    .map(toPart)
    .filter((p): p is Part => !!p);
}
