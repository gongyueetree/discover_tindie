import { fetchSignal, remainingMs, requestDeadline } from "@/lib/maker/request-context";
import { rankParts } from "./rank-parts";
import "server-only";
import { createHash } from "node:crypto";
import { englishParts } from "./translation";
import { keywordSearch } from "@/vendor/bom2buy/digikey";
import { PartdataError } from "@/lib/partdata/client";
import { searchPartdata, status as partdataStatus } from "@/lib/partdata/maker";
import { ezplmConfigured, searchParts as ezplmSearch, EZPLM_SOURCE } from "@/lib/ezplm/client";
import type { Part, ProviderStatus } from "./types";
import { noteAsync, recordTerm } from "@/lib/maker-analytics";
import { limitVisitor, reserveSupplierCall, supplierCached, supplierCacheKey, supplierCooldown, supplierCoolingDown, SupplierUnavailable, type Bucket, type Provider } from "./limits";
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
    ezplm: ezplmConfigured(),
  };
}

export async function search(
  q: string,
  visitor: string,
  includeSuppliers = false,
  { partdata = true, deadline = requestDeadline() }: { partdata?: boolean; /** epoch ms the whole request must finish by */ deadline?: number } = {},
) {
  const parts: Part[] = [];
  const statuses: ProviderStatus[] = [];
  let catalogueExact = false;
  // ezPLM's own catalogue runs alongside the parts database (it does not wait for it); its rows are
  // added after the parts database's, so a part both know keeps the richer parts-database record.
  const ezParts: Part[] = [];
  const ezStatuses: ProviderStatus[] = [];
  const ezplm = partdata
    ? supplierLookup("ezplm", EZPLM_SOURCE, q, visitor, ezStatuses, ezParts, (k) => ezplmSearch(k, 10), deadline)
    : Promise.resolve();
  if (partdata) try {
    const r = await searchPartdata(q, visitor);
    parts.push(...r.items);
    catalogueExact = r.exact;
    statuses.push(partdataStatus("ready"));
  } catch (e) {
    const err = asSourceError(e);
    // A too-short query is the visitor's input, not a source failure. A visitor over their daily
    // parts-database quota (429) must not be turned into paid distributor lookups instead.
    if (err.status === 400 || err.status === 429) {
      await ezplm;
      throw err;
    }
    statuses.push(
      partdataStatus(
        e instanceof PartdataError && e.code === "unconfigured" ? "unconfigured" : "error",
        err.message,
      ),
    );
  }
  await ezplm;
  parts.push(...ezParts);
  statuses.push(...ezStatuses);
  if (!catalogueExact || includeSuppliers)
    await Promise.all([
      supplierLookup("digikey", "DigiKey direct", q, visitor, statuses, parts, digikeyParts, deadline),
      supplierLookup("mouser", "Mouser direct", q, visitor, statuses, parts, mouserParts, deadline),
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
    items: await englishParts(rankParts([...merged.values()], q), visitor, deadline),
    sources: statuses,
  };
}
/** Per-visitor request rate (shared across instances when Redis is configured; see limits.ts). */
export async function rateLimit(ip: string, bucket: Bucket = "api") {
  await limitVisitor(bucket, createHash("sha256").update(ip).digest("hex").slice(0, 32));
}

const NAME: Record<Provider, string> = { digikey: "DigiKey", mouser: "Mouser", ezplm: "ezPLM" };
const COOLDOWN_MSG: Record<Provider, string> = {
  digikey: "DigiKey asked us to slow down; live prices resume shortly",
  mouser: "Mouser asked us to slow down; live prices resume shortly",
  ezplm: "ezPLM asked us to slow down; its results return shortly",
};
/** Catalogue answers change rarely and every call counts against ezPLM's daily limit: kept up to a
    day, but no longer than the signed datasheet links in them stay valid. */
const CACHE_SECONDS: Partial<Record<Provider, (parts: Part[]) => number>> = { ezplm: (parts) => linksValidFor(parts, 86_400) };

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
  deadline: number,
) {
  if (!suppliersConnected()[provider]) {
    statuses.push({ source, status: "unconfigured" });
    return;
  }
  // Time left in this request (the explicit deadline, or the request's own if that is sooner).
  const left = () => Math.min(deadline - Date.now(), remainingMs());
  const SKIP = "Skipped to keep this request fast — retry for live prices";
  if (left() < 7_000) {
    statuses.push({ source, status: "error", message: SKIP });
    return;
  }
  const key = supplierCacheKey(provider, q);
  try {
    const { value } = await supplierCached(key, async () => {
      const cooling = await supplierCoolingDown(provider);
      if (cooling !== false) throw new SupplierSkip(cooling || COOLDOWN_MSG[provider]);
      // Checked again after waiting for the cache / lock: never start a paid call that cannot finish.
      if (left() < 7_000) throw new SupplierSkip(SKIP);
      if (!(await reserveSupplierCall(provider, visitor))) throw new SupplierSkip("Live distributor lookups are paused for today (usage limit reached)");
      if (left() < 5_000) throw new SupplierSkip(SKIP);
      // The fetches below use the request's signal: at the deadline (or if the visitor leaves) the
      // network request itself is aborted. Quota reserved for a call already sent is not refunded.
      return load(q);
    }, Date.now() + Math.max(0, left() - 4_000), CACHE_SECONDS[provider]);
    parts.push(...value.map((p) => ({ ...p, offers: p.offers.map((o) => ({ ...o })) })));
    statuses.push({ source, status: "ready" });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    const name = NAME[provider];
    const daily = m === "RATE_LIMITED" && !!(e as { daily?: boolean }).daily;
    const reason = daily
      ? `${name}'s daily API quota is used up; ${provider === "ezplm" ? "its results" : "live prices"} return when it resets`
      : COOLDOWN_MSG[provider];
    if (m === "RATE_LIMITED") {
      // A spent daily quota: try again in an hour; the per-minute limit: as long as asked (default 2 min).
      supplierCooldown(provider, daily ? 3600 : (e as { retryAfter?: number }).retryAfter || 120, reason);
      noteAsync(() => recordTerm("error:supplier", `${provider} · ${daily ? "daily quota used up" : "per-minute limit"}`));
    } else if (!(e instanceof SupplierSkip || e instanceof SupplierUnavailable))
      noteAsync(() => recordTerm("error:supplier", `${provider} · ${/OAuth/.test(m) ? "credentials rejected" : "request failed"}`));
    statuses.push({
      source,
      status: "error",
      message:
        e instanceof SupplierSkip || e instanceof SupplierUnavailable
          ? m
          : m === "RATE_LIMITED"
            ? reason
            : /OAuth/.test(m)
              ? `${name} credentials rejected`
              : `${name} request failed`,
    });
  }
}
class SupplierSkip extends Error {}

/** Seconds until the first signed link (`?e=<unix seconds>`) in these parts expires, less 5 minutes; at most `max`, at least 10 minutes. */
export function linksValidFor(parts: Part[], max: number, now = Date.now()) {
  let ttl = max;
  for (const p of parts)
    for (const u of [p.datasheet, p.productUrl, p.image]) {
      if (!u) continue;
      try {
        const e = Number(new URL(u).searchParams.get("e"));
        if (Number.isFinite(e) && e > 1e9) ttl = Math.min(ttl, e - now / 1000 - 300);
      } catch {
        /* not a URL */
      }
    }
  return Math.max(600, Math.floor(ttl));
}


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
    signal: fetchSignal(15000),
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
