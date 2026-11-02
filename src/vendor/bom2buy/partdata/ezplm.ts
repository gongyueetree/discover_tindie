/* ============================================================
   EZPLM 元器件主数据客户端（只读查询）
   接口：GET /api/v1/api-key/parts、GET /api/v1/api-key/reference-designs
   鉴权：X-API-Key + X-Timestamp + X-Nonce + X-Signature(HMAC-SHA256)

   注意：手册未明确签名串的分隔符与 HMAC 密钥来源，故做成可配置，
   并提供 scripts/verify-ezplm.mjs 自动探测正确组合。
   ============================================================ */
import crypto from "crypto";

export type EzplmPart = {
  id: string;
  mpn: string;
  manufacturer: string;      // 接口返回对象，此处取其名称
  description?: string;
  category?: string;
  officialUrl?: string;
  footprint?: string;
  symbol?: string;
  pdf?: string;
  attributes?: Record<string, any>;
  raw?: unknown;
};

export type EzplmReferenceDesign = {
  name: string;
  link?: string;
  image?: string;
  description?: string;
};

export function ezplmConfigured(): boolean {
  return !!process.env.EZPLM_API_KEY && !!process.env.EZPLM_API_BASE;
}

/* ---------- 签名 ---------- */
export type SignScheme = {
  /** 签名串分隔符：手册未明确，常见为 "\n" 或 "&" 或 "" */
  delimiter: string;
  /** HMAC 密钥：用独立 secret，或直接用 API Key */
  secret: string;
  /** 签名输出编码：官方为 base64url（去除 = 填充） */
  encoding: "hex" | "base64" | "base64url";
  /** query 排序后的拼接形式 */
  queryStyle: "kv" | "encoded";
  /** 时间戳单位：手册只说 Unix 时间戳，未明确秒或毫秒 */
  tsUnit: "s" | "ms";
};

/* 官方签名规则（samples/api-key-signing-demo.*）：
     X-API-Key 作为 HMAC 密钥
     canonicalRequest = [METHOD, path, 字典序URL编码query, timestamp(秒), nonce].join("\n")
     X-Signature = base64url(HMAC-SHA256(apiKey, canonicalRequest))，去掉 = 填充
   环境变量仅用于对方日后调整签名方案时覆盖，默认即为官方方案。 */
export function defaultScheme(): SignScheme {
  const enc = process.env.EZPLM_SIGN_ENCODING;
  return {
    delimiter: process.env.EZPLM_SIGN_DELIMITER ?? "\n",
    secret: process.env.EZPLM_API_SECRET || process.env.EZPLM_API_KEY || "",
    encoding: enc === "hex" || enc === "base64" ? enc : "base64url",
    queryStyle: (process.env.EZPLM_SIGN_QUERY_STYLE as any) === "kv" ? "kv" : "encoded",
    tsUnit: process.env.EZPLM_SIGN_TS_UNIT === "ms" ? "ms" : "s",
  };
}

/** 按手册顺序拼签名串：method / path / 排序后的 query / timestamp / nonce */
/** 字典序 + URL 编码的规范化 query（与签名串、请求 URL 共用） */
export function canonicalQuery(query: Record<string, any>, style: SignScheme["queryStyle"] = "encoded"): string {
  const entries = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => [String(k), String(v)] as [string, string])
    .sort(([lk, lv], [rk, rv]) => (lk === rk ? lv.localeCompare(rv) : lk.localeCompare(rk)));
  return style === "encoded"
    ? entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    : entries.map(([k, v]) => `${k}=${v}`).join("&");
}

export function buildSignBase(
  method: string, path: string, query: Record<string, string | number | undefined>,
  timestamp: string, nonce: string, scheme: SignScheme
): string {
  const entries = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string])
    .sort(([lk, lv], [rk, rv]) => (lk === rk ? lv.localeCompare(rv) : lk.localeCompare(rk)));
  const q = scheme.queryStyle === "encoded"
    ? entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    : entries.map(([k, v]) => `${k}=${v}`).join("&");
  return [method.toUpperCase(), path, q, timestamp, nonce].join(scheme.delimiter);
}

export function sign(base: string, scheme: SignScheme): string {
  const hmac = crypto.createHmac("sha256", scheme.secret).update(base, "utf8");
  if (scheme.encoding === "base64url") {
    // Node 的 base64url 已去填充；此处再兜底一次，兼容旧运行时
    return hmac.digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return hmac.digest(scheme.encoding as "hex" | "base64");
}

export function authHeaders(
  method: string, path: string, query: Record<string, any>, scheme = defaultScheme()
): Record<string, string> {
  const timestamp = scheme.tsUnit === "ms" ? String(Date.now()) : String(Math.floor(Date.now() / 1000));
  // nonce 只能用一次，用随机串防重放
  const nonce = crypto.randomUUID();
  const base = buildSignBase(method, path, query, timestamp, nonce, scheme);
  return {
    "X-API-Key": process.env.EZPLM_API_KEY || "",
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Signature": sign(base, scheme),
    Accept: "application/json",
  };
}

/* ---------- 响应映射 ----------
   实测返回：id, mpn, description, officialUrl, manufacturer(对象),
   category(可能为对象), footprint, symbol, pdf, attributes
*/

/** 字段可能是字符串，也可能是 { name } / { value } / { title } 形式的对象 */
export function textOf(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const cand = v.name ?? v.value ?? v.title ?? v.label ?? v.text ?? v.cnName ?? v.enName;
    if (typeof cand === "string") return cand.trim() || undefined;
    if (typeof v.url === "string") return v.url;
  }
  return undefined;
}

export function mapPart(p: any): EzplmPart | null {
  if (!p) return null;
  const id = p.id ?? p.partlibId ?? p.partLibId;
  const mpn = p.mpn ?? p.MPN ?? p.partNumber;
  if (!id || !mpn) return null;
  return {
    id: String(id),
    mpn: String(mpn),
    manufacturer: textOf(p.manufacturer) ?? textOf(p.mfr) ?? textOf(p.supplier) ?? "",
    description: textOf(p.description) ?? textOf(p.desc) ?? textOf(p.productName),
    category: textOf(p.category),
    officialUrl: textOf(p.officialUrl),
    footprint: textOf(p.footprint),
    symbol: textOf(p.symbol),
    pdf: textOf(p.pdf),
    attributes: p.attributes && typeof p.attributes === "object" ? p.attributes : undefined,
    raw: p,
  };
}

function listOf(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.list)) return data.data.list;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

/* ---------- 查询 ---------- */
const PARTS_PATH = "/api/v1/api-key/parts";
const REFDESIGN_PATH = "/api/v1/api-key/reference-designs";

export async function searchParts(keyword: string, pageSize = 10): Promise<EzplmPart[]> {
  if (!ezplmConfigured() || !keyword?.trim()) return [];
  const query = { keyword: keyword.trim(), pageSize: String(pageSize) };
  const headers = authHeaders("GET", PARTS_PATH, query);
  const q = canonicalQuery(query);
  const url = `${process.env.EZPLM_API_BASE}${PARTS_PATH}${q ? `?${q}` : ""}`;
  try {
    const resp = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`ezPLM HTTP ${resp.status}`);
    const data = await resp.json();
    return listOf(data).map(mapPart).filter(Boolean) as EzplmPart[];
  } catch (error) { throw error; }
}

export async function getReferenceDesigns(partlibId: string, pageSize = 10): Promise<EzplmReferenceDesign[]> {
  if (!ezplmConfigured() || !partlibId) return [];
  const query = { partlibId, pageSize: String(pageSize) };
  const headers = authHeaders("GET", REFDESIGN_PATH, query);
  const q = canonicalQuery(query);
  const url = `${process.env.EZPLM_API_BASE}${REFDESIGN_PATH}${q ? `?${q}` : ""}`;
  try {
    const resp = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`ezPLM HTTP ${resp.status}`);
    const data = await resp.json();
    return listOf(data).map((d: any) => ({
      name: String(d?.name ?? ""), link: d?.link, image: d?.image, description: d?.description,
    })).filter((d) => d.name);
  } catch (error) { throw error; }
}

/* ---------- 给 BOM 用的两个能力 ---------- */

/** 校验/补全：已有 MPN 时，确认它是否存在并补厂商与描述 */
export async function resolveMpn(mpn: string): Promise<EzplmPart | null> {
  const hits = await searchParts(mpn, 5);
  const norm = (s: string) => s.trim().toUpperCase();
  return hits.find((h) => norm(h.mpn) === norm(mpn)) || null;
}

/** 反查候选：无 MPN 时，用参数/描述检索候选料号，供人工或后续问价 */
export async function suggestCandidates(
  line: { value?: string; package?: string; description?: string; aiKeyword?: string },
  limit = 5
): Promise<EzplmPart[]> {
  const kw = [line.aiKeyword, line.description, line.value, line.package]
    .filter(Boolean).join(" ").trim();
  if (!kw) return [];
  return (await searchParts(kw, limit)).slice(0, limit);
}

