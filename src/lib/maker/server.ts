import { rankParts } from "./rank-parts";
import "server-only";
import { createHash } from "node:crypto";
import { englishParts } from "./translation";
import { keywordSearch } from "@/vendor/bom2buy/digikey";
import { PartdataError } from "@/lib/partdata/client";
import { searchPartdata, status as partdataStatus } from "@/lib/partdata/maker";
import type { Part, ProviderStatus } from "./types";
import { limitRequest, reserveSupplierCall, supplierCached, supplierCacheKey, supplierCooldown, supplierCoolingDown, type Bucket, type Provider } from "./limits";
export class SourceError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
export function safeLink(v: unknown) {
  try {
    const u = new URL(String(v));
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
/** Errors from partdata keep their HTTP status and visitor-facing message. */
export function asSourceError(e: unknown) {
  if (e instanceof SourceError) return e;
  if (e instanceof PartdataError) return new SourceError(e.message, e.status);
  return new SourceError(e instanceof Error ? e.message : "The request could not be completed.", 502);
}
/** Which distributor APIs this deployment can call (yes / no only; never the keys). */
export function suppliersConnected() {
  return {
    digikey: !!process.env.DIGIKEY_CLIENT_ID && !!process.env.DIGIKEY_CLIENT_SECRET && process.env.DIGIKEY_ENV === "production",
    mouser: !!process.env.MOUSER_API_KEY,
  };
}

export async function search(
  q: string,
  visitor: string,
  includeSuppliers = false,
  { partdata = true }: { partdata?: boolean } = {},
) {
  const parts: Part[] = [];
  const statuses: ProviderStatus[] = [];
  let catalogueExact = false;
  if (partdata) try {
    const r = await searchPartdata(q, visitor);
    parts.push(...r.items);
    catalogueExact = r.exact;
    statuses.push(partdataStatus("ready"));
  } catch (e) {
    const err = asSourceError(e);
    // A too-short query is the visitor's input, not a source failure. A visitor over their daily
    // parts-database quota (429) must not be turned into paid distributor lookups instead.
    if (err.status === 400 || err.status === 429) throw err;
    statuses.push(
      partdataStatus(
        e instanceof PartdataError && e.code === "unconfigured" ? "unconfigured" : "error",
        err.message,
      ),
    );
  }
  if (!catalogueExact || includeSuppliers)
    await Promise.all([
      supplierLookup("digikey", "DigiKey direct", q, visitor, statuses, parts, digikeyParts),
      supplierLookup("mouser", "Mouser direct", q, visitor, statuses, parts, mouserParts),
    ]);
  const merged = new Map<string, Part>();
  for (const p of parts) {
    const k =
      p.mpn.trim().toUpperCase() + "|" + p.manufacturer.trim().toLowerCase();
    const previous = merged.get(k);
    if (previous) previous.offers.push(...p.offers);
    else merged.set(k, p);
  }
  return {
    items: await englishParts(rankParts([...merged.values()], q)),
    sources: statuses,
  };
}
/** Per-visitor request rate (shared across instances when Redis is configured; see limits.ts). */
export async function rateLimit(ip: string, bucket: Bucket = "api") {
  await limitRequest(createHash("sha256").update(ip).digest("hex").slice(0, 32), bucket);
}

const COOLDOWN_MSG: Record<Provider, string> = { digikey: "DigiKey asked us to slow down; live prices resume shortly", mouser: "Mouser asked us to slow down; live prices resume shortly" };

/**
 * One distributor lookup: shared cache first; otherwise a real call only if the distributor is not
 * cooling down after a 429 and the site-wide and visitor budgets allow it (reserved before calling).
 */
async function supplierLookup(
  provider: Provider,
  source: string,
  q: string,
  visitor: string,
  statuses: ProviderStatus[],
  parts: Part[],
  load: (q: string) => Promise<Part[]>,
) {
  if (!suppliersConnected()[provider]) {
    statuses.push({ source, status: "unconfigured" });
    return;
  }
  const key = supplierCacheKey(provider, q);
  try {
    const { value } = await supplierCached(key, async () => {
      if (await supplierCoolingDown(provider)) throw new SupplierSkip(COOLDOWN_MSG[provider]);
      if (!(await reserveSupplierCall(provider, visitor))) throw new SupplierSkip("Live distributor lookups are paused for today (usage limit reached)");
      return load(q);
    });
    parts.push(...value.map((p) => ({ ...p, offers: p.offers.map((o) => ({ ...o })) })));
    statuses.push({ source, status: "ready" });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m === "RATE_LIMITED") supplierCooldown(provider, (e as any).retryAfter || 600);
    statuses.push({
      source,
      status: "error",
      message:
        e instanceof SupplierSkip
          ? m
          : m === "RATE_LIMITED"
            ? `${provider === "digikey" ? "DigiKey" : "Mouser"} daily API quota used up`
            : /OAuth/.test(m)
              ? `${provider === "digikey" ? "DigiKey" : "Mouser"} credentials rejected`
              : `${provider === "digikey" ? "DigiKey" : "Mouser"} request failed`,
    });
  }
}
class SupplierSkip extends Error {}

async function digikeyParts(q: string): Promise<Part[]> {
  return (await keywordSearch(q, 8)).map((p) => ({
    id: "dk:" + p.dk,
    mpn: p.mpn,
    manufacturer: p.mfr,
    description: p.desc,
    package: p.pkg,
    source: "DigiKey",
    parameters: {},
    cad: [],
    offers: [
      {
        supplier: "DigiKey",
        sku: p.dk,
        currency: "USD",
        stock: p.stock ?? null,
        moq: p.moq,
        multiple: p.multiple,
        breaks: p.tiers.map(([quantity, price]) => ({ quantity, price })).filter((t) => t.price > 0),
        retrievedAt: p.retrievedAt,
      },
    ],
  }));
}

async function mouserParts(q: string): Promise<Part[]> {
  const r = await fetch(`https://api.mouser.com/api/v1/search/keyword?apiKey=${encodeURIComponent(process.env.MOUSER_API_KEY || "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ SearchByKeywordRequest: { keyword: q, records: 8, startingRecord: 0, searchOptions: "None" } }),
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 429) throw Object.assign(Error("RATE_LIMITED"), { retryAfter: Number(r.headers.get("retry-after")) || 0 });
  if (!r.ok) throw Error();
  const data = await r.json();
  if (data.Errors?.length) throw Error(JSON.stringify(data.Errors).match(/limit|exceed/i) ? "RATE_LIMITED" : "");
  const money = (v: string) => {
    let s = String(v).replace(/[^0-9.,]/g, "");
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    return Number(s);
  };
  return (data.SearchResults?.Parts || []).map((p: any): Part => {
    const breaks = (p.PriceBreaks || [])
      .map((b: any) => ({ quantity: Number(b.Quantity), price: money(b.Price) }))
      .filter((b: any) => b.quantity > 0 && b.price > 0);
    const stockText = String(p.Availability || "");
    return {
      id: "mouser:" + p.MouserPartNumber,
      mpn: p.ManufacturerPartNumber,
      manufacturer: p.Manufacturer,
      description: p.Description,
      package: p.Package,
      source: "Mouser",
      datasheet: safeLink(p.DataSheetUrl),
      parameters: {},
      cad: [],
      offers: [
        {
          supplier: "Mouser",
          sku: p.MouserPartNumber,
          currency: p.PriceBreaks?.[0]?.Currency || "USD",
          stock: /in stock/i.test(stockText) ? Number(stockText.replace(/,/g, "").match(/\d+/)?.[0] || 0) : null,
          moq: Number(p.Min) || 1,
          multiple: Number(p.Mult) || 1,
          breaks,
          url: safeLink(p.ProductDetailUrl),
          retrievedAt: new Date().toISOString(),
        },
      ],
    } as Part;
  });
}
