import { rankParts } from "./rank-parts";
import "server-only";
import { withUnit } from "./english";
import { englishParts } from "./translation";
import { createHash } from "node:crypto";
import { searchParts, ezplmConfigured } from "@/vendor/bom2buy/partdata/ezplm";
import { keywordSearch } from "@/vendor/bom2buy/digikey";
import type { Part, Offer, ProviderStatus } from "./types";
export const EELIB_BASE = (
  process.env.EELIB_PUBLIC_API_BASE || "https://eelib.io/api/proxy"
).replace(/\/$/, "");
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
export async function eel(path: string, guest: string, init: RequestInit = {}) {
  const r = await fetch(`${EELIB_BASE}/${path}`, {
    ...init,
    redirect: "error",
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(25000),
    headers: {
      "X-Guest-Id": guest,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  }).catch(() => {
    throw new SourceError(
      "The catalogue service is unreachable from this server. Check network access to eelib.io.",
      502,
    );
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.ok === false)
    throw new SourceError(
      r.status === 429
        ? "The shared catalogue quota is reached. Please try later."
        : r.status === 401 || r.status === 403
          ? "This operation requires an authorized eelib service connection."
          : j?.error?.message || `Catalogue service returned HTTP ${r.status}`,
      r.status,
    );
  if (j?.meta?.demo)
    throw new SourceError(
      "The upstream returned example data. It is not shown as a live result.",
    );
  return j?.data ?? j;
}
export function mapComponent(p: any): Part {
  return {
    id: String(p.id || p.mpn),
    mpn: String(p.mpn || ""),
    manufacturer: String(p.manufacturer || ""),
    description: String(p.description || ""),
    package: p.package,
    datasheet: safeLink(p.datasheetUrl),
    source: p.source || "eelib",
    parameters: Object.fromEntries(
      [...(p.parameters || []), ...(p.otherParameters || [])].map((v: any) => [
        v.label || v.key,
        withUnit(v.value, v.unit),
      ]),
    ),
    cad: Object.entries(p.assets || {})
      .filter(
        ([k, v]) =>
          ["kicadSymbol", "kicadFootprint", "model3d"].includes(k) &&
          safeLink(v),
      )
      .map(([k, v]) => ({
        name:
          k === "kicadSymbol"
            ? "KiCad symbol"
            : k === "kicadFootprint"
              ? "KiCad footprint"
              : "3D model",
        url: safeLink(v)!,
        kind: k,
      })),
    offers: [],
  };
}
export function mapPrice(p: any): Offer {
  return {
    supplier: p.source,
    sku: p.sku,
    currency: p.currency,
    stock: typeof p.stock === "number" ? p.stock : null,
    moq: p.moq || 1,
    multiple: p.multiple || 1,
    breaks: (p.priceBreaks || []).map((t: any) => ({
      quantity: t.qty,
      price: t.unitPrice,
    })),
    url: safeLink(p.url),
    retrievedAt: p.updatedAt,
  };
}
export async function search(
  q: string,
  guest: string,
  includeSuppliers = false,
) {
  const parts: Part[] = [];
  const statuses: ProviderStatus[] = [];
  await (async () => {
    try {
      const d = await eel(
        `components/search?q=${encodeURIComponent(q)}&size=20`,
        guest,
      );
      parts.push(...(d.items || []).map(mapComponent));
      statuses.push({ source: "eelib / ezPLM", status: "ready" });
    } catch (e) {
      statuses.push({
        source: "eelib",
        status: "error",
        message: (e as Error).message,
      });
    }
  })();
  await (async () => {
    if (!ezplmConfigured()) return;
    try {
      parts.push(
        ...(await searchParts(q, 10)).map((p) => ({
          id: p.id,
          mpn: p.mpn,
          manufacturer: p.manufacturer,
          description: p.description || "",
          package: p.footprint,
          source: "ezPLM direct",
          datasheet: safeLink(p.pdf),
          parameters: Object.fromEntries(
            Object.entries(p.attributes || {})
              .filter(([, v]) => typeof v === "string" || typeof v === "number")
              .map(([k, v]) => [k, String(v)]),
          ),
          cad: [],
          offers: [],
        })),
      );
      statuses.push({ source: "ezPLM direct", status: "ready" });
    } catch {
      statuses.push({ source: "ezPLM direct", status: "error" });
    }
  })();
  const exactCatalogue = parts.some(
    (p) =>
      p.mpn.trim().toUpperCase() === q.trim().toUpperCase() && p.manufacturer,
  );
  if (!exactCatalogue || includeSuppliers)
    await Promise.all([
      (async () => {
        if (
          !process.env.DIGIKEY_CLIENT_ID ||
          !process.env.DIGIKEY_CLIENT_SECRET ||
          process.env.DIGIKEY_ENV !== "production"
        ) {
          statuses.push({ source: "DigiKey direct", status: "unconfigured" });
          return;
        }
        try {
          parts.push(
            ...(await keywordSearch(q, 8)).map((p) => ({
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
                  breaks: p.tiers
                    .map(([quantity, price]) => ({ quantity, price }))
                    .filter((t) => t.price > 0),
                  retrievedAt: p.retrievedAt,
                },
              ],
            })),
          );
          statuses.push({ source: "DigiKey direct", status: "ready" });
        } catch {
          statuses.push({ source: "DigiKey direct", status: "error" });
        }
      })(),
      (async () => {
        if (!process.env.MOUSER_API_KEY) {
          statuses.push({ source: "Mouser direct", status: "unconfigured" });
          return;
        }
        try {
          const r = await fetch(
            `https://api.mouser.com/api/v1/search/keyword?apiKey=${encodeURIComponent(process.env.MOUSER_API_KEY)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                SearchByKeywordRequest: {
                  keyword: q,
                  records: 8,
                  startingRecord: 0,
                  searchOptions: "None",
                },
              }),
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!r.ok) throw Error();
          const data = await r.json();
          if (data.Errors?.length) throw Error();
          parts.push(
            ...(data.SearchResults?.Parts || []).map((p: any) => {
              const money = (v: string) => {
                let s = String(v).replace(/[^0-9.,]/g, "");
                s =
                  s.lastIndexOf(",") > s.lastIndexOf(".")
                    ? s.replace(/\./g, "").replace(",", ".")
                    : s.replace(/,/g, "");
                return Number(s);
              };
              const breaks = (p.PriceBreaks || [])
                .map((b: any) => ({
                  quantity: Number(b.Quantity),
                  price: money(b.Price),
                }))
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
                    stock: /in stock/i.test(stockText)
                      ? Number(
                          stockText.replace(/,/g, "").match(/\d+/)?.[0] || 0,
                        )
                      : null,
                    moq: Number(p.Min) || 1,
                    multiple: Number(p.Mult) || 1,
                    breaks,
                    url: safeLink(p.ProductDetailUrl),
                    retrievedAt: new Date().toISOString(),
                  },
                ],
              };
            }),
          );
          statuses.push({ source: "Mouser direct", status: "ready" });
        } catch {
          statuses.push({ source: "Mouser direct", status: "error" });
        }
      })(),
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
const limits = new Map<string, { n: number; reset: number }>();
export function rateLimit(ip: string) {
  const key = createHash("sha256").update(ip).digest("hex");
  const now = Date.now();
  const x = limits.get(key);
  if (limits.size > 10000)
    for (const [k, v] of limits) if (v.reset < now) limits.delete(k);
  if (x && x.reset > now) {
    if (x.n++ > 120)
      throw new SourceError("Too many requests. Try again in a minute.", 429);
  } else limits.set(key, { n: 1, reset: now + 60000 });
}
