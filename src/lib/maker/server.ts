import { rankParts } from "./rank-parts";
import "server-only";
import { createHash } from "node:crypto";
import { englishParts } from "./translation";
import { keywordSearch } from "@/vendor/bom2buy/digikey";
import { PartdataError } from "@/lib/partdata/client";
import { searchPartdata, status as partdataStatus } from "@/lib/partdata/maker";
import type { Part, ProviderStatus } from "./types";
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
    // A too-short query is the visitor's input, not a source failure.
    if (err.status === 400) throw err;
    statuses.push(
      partdataStatus(
        e instanceof PartdataError && e.code === "unconfigured" ? "unconfigured" : "error",
        err.message,
      ),
    );
  }
  if (!catalogueExact || includeSuppliers)
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
