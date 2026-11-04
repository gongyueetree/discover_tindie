import { fetchSignal } from "@/lib/maker/request-context";
/* ============================================================
   DigiKey API v4 服务端客户端（仅在 API Route 中使用，Key 不出服务器）
   - 2-legged OAuth（client_credentials）：Product Information v4 支持
   - Sandbox / Production 切换：DIGIKEY_ENV
   - 内存缓存：token + 按 MPN 缓存搜索结果（Vercel 热实例内有效）
   ============================================================ */

const BASES: Record<string, string> = {
  sandbox: "https://sandbox-api.digikey.com",
  production: "https://api.digikey.com",
};

function base() {
  return BASES[process.env.DIGIKEY_ENV === "production" ? "production" : "sandbox"];
}
export function isMock() {
  return process.env.DIGIKEY_MOCK === "true" || !process.env.DIGIKEY_CLIENT_ID || !process.env.DIGIKEY_CLIENT_SECRET;
}
export function dkMode() {
  return isMock() ? "mock" : process.env.DIGIKEY_ENV === "production" ? "production" : "sandbox";
}

let tokenCache: { token: string; exp: number } | null = null;
async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const resp = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.DIGIKEY_CLIENT_ID || "",
      client_secret: process.env.DIGIKEY_CLIENT_SECRET || "",
    }),
    cache: "no-store", signal: fetchSignal(15000),
  });
  if (!resp.ok) {
    const body = await resp.text();
    // 最常见故障：生产凭证打到 sandbox 端点（或反之）→ Invalid clientId
    const envNow = process.env.DIGIKEY_ENV === "production" ? "production" : "sandbox";
    const hint = resp.status === 401 && /invalid client/i.test(body)
      ? `（当前 DIGIKEY_ENV=${envNow}。若凭证来自 DigiKey 开发者后台的常规应用，请将 DIGIKEY_ENV 改为 production；Sandbox 需要单独创建 Sandbox 应用并使用其专属凭证）`
      : "";
    throw new Error(`DigiKey OAuth failed: ${resp.status} ${body.slice(0, 200)}${hint}`);
  }
  const data = await resp.json();
  tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 600) * 1000 };
  return tokenCache.token;
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-DIGIKEY-Client-Id": process.env.DIGIKEY_CLIENT_ID || "",
    "X-DIGIKEY-Locale-Site": "US",
    "X-DIGIKEY-Locale-Language": "en",
    "X-DIGIKEY-Locale-Currency": "USD",
    "Content-Type": "application/json",
  };
}

export type DkProduct = {
  mpn: string; dk: string; mfr: string; desc: string; pkg: string;
  stock?: number; moq:number; multiple:number; retrievedAt:string; lifecycle: string; tiers: [number, number][];
  eol: boolean; discontinued: boolean;
};

/* 防御性映射：DigiKey v4 Product → 内部结构 */
/** 生命周期标准化：拿不到就是 UNKNOWN，绝不默认 Active */
export function normalizeLifecycle(raw: any): "ACTIVE" | "NRND" | "EOL" | "OBSOLETE" | "LAST_TIME_BUY" | "UNKNOWN" {
  const s = String(raw || "").toLowerCase();
  if (!s) return "UNKNOWN";
  if (/last\s*time\s*buy|ltb/.test(s)) return "LAST_TIME_BUY";
  if (/obsolete|discontinued/.test(s)) return "OBSOLETE";
  if (/end\s*of\s*life|\beol\b/.test(s)) return "EOL";
  if (/nrnd|not\s*recommended/.test(s)) return "NRND";
  if (/^active$|in\s*production/.test(s)) return "ACTIVE";
  return "UNKNOWN";
}

export function mapProduct(p: any): DkProduct | null {
  if (!p) return null;
  const variation = (p.ProductVariations || [])[0] || {};
  const tiers: [number, number][] = (variation.StandardPricing || [])
    .map((t: any) => [Number(t.BreakQuantity) || 1, Number(t.UnitPrice) || 0] as [number, number])
    .filter((t: [number, number]) => t[1] > 0);
  return {
    mpn: p.ManufacturerProductNumber || p.ManufacturerPartNumber || "",
    dk: variation.DigiKeyProductNumber || p.DigiKeyPartNumber || "",
    mfr: p.Manufacturer?.Name || p.Manufacturer?.Value || "",
    desc: p.Description?.ProductDescription || p.ProductDescription || "",
    pkg: (p.Parameters || []).find((x: any) => /^(Package \/ Case|Supplier Device Package)$/.test(x.ParameterText || x.Parameter))?.ValueText || "",
    stock: variation.QuantityAvailableforPackageType != null ? Number(variation.QuantityAvailableforPackageType) : undefined,
    moq: Number(variation.MinimumOrderQuantity)||1, multiple:Number(variation.StandardPackage)||1, retrievedAt:new Date().toISOString(),
    lifecycle: normalizeLifecycle(p.ProductStatus?.Status || p.ProductStatus),
    tiers: tiers.length ? tiers : [[1, Number(p.UnitPrice) || 0]],
    eol: !!p.EndOfLife,
    discontinued: !!p.Discontinued,
  };
}

const searchCache = new Map<string, { data: DkProduct[]; exp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 价格库存 1 小时

export async function keywordSearch(keyword: string, limit = 3): Promise<DkProduct[]> {
  const key = `${keyword}::${limit}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() < hit.exp) return hit.data;
  const token = await getToken();
  const resp = await fetch(`${base()}/products/v4/search/keyword`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ Keywords: keyword, Limit: limit, Offset: 0 }),
    cache: "no-store", signal: fetchSignal(15000),
  });
  if (resp.status === 429) throw new Error("RATE_LIMITED");
  if (!resp.ok) throw new Error(`keywordSearch ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const products: DkProduct[] = [
    ...(data.ExactMatches || []),
    ...(data.Products || []),
  ].map(mapProduct).filter(Boolean) as DkProduct[];
  // 去重
  const seen = new Set<string>();
  const uniq = products.filter((p) => { if (seen.has(p.mpn)) return false; seen.add(p.mpn); return true; });
  searchCache.set(key, { data: uniq, exp: Date.now() + CACHE_TTL });
  return uniq;
}

export async function substitutions(dkPartNumber: string): Promise<DkProduct[]> {
  try {
    const token = await getToken();
    const resp = await fetch(`${base()}/products/v4/search/${encodeURIComponent(dkPartNumber)}/substitutions`, {
      headers: headers(token), cache: "no-store", signal: fetchSignal(15000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.ProductSubstitutes || data.Products || []).map(mapProduct).filter(Boolean) as DkProduct[];
  } catch { return []; }
}

/* 简单并发限制 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

