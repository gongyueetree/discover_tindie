import { rankParts } from "./rank-parts";
import Papa from "papaparse";
import {
  autoMapColumn,
  findHeaderRow,
  normalizeRow,
  StdField,
} from "@/vendor/bom2buy/bom/normalizer";
import { exactMpn } from "@/vendor/bom2buy/parts/mpnIdentity";
import { sameManufacturer } from "@/vendor/bom2buy/bom/references";
import { samePackage } from "@/vendor/bom2buy/bom/packageNormalize";
import type { BomRow, Part, Offer } from "./types";
export { autoMapColumn };
export type { StdField };
export function readCsv(text: string) {
  const r = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  if (r.errors.some((e) => e.type === "Quotes"))
    throw Error("Invalid quoted CSV. Check the source file.");
  const table = r.data;
  if (table.length > 2001) throw Error("Maximum 2,000 BOM rows per import.");
  const { idx } = findHeaderRow(table);
  return { headers: table[idx] || [], rows: table.slice(idx + 1) };
}
export function normalizeTable(
  headers: string[],
  table: string[][],
  mapping: StdField[],
): BomRow[] {
  return table
    .map((cells, i): BomRow | null => {
      const raw: Record<string, string> = {},
        original: Record<string, string> = {};
      headers.forEach((h, j) => {
        original[h] = cells[j] || "";
        if (mapping[j] !== "ignore") raw[mapping[j]] = cells[j] || "";
      });
      const n = normalizeRow(raw, i + 1, { promoteValueToMpn: true });
      if (n.nonBom || n.dnp) return null;
      return {
        id: String(i + 1),
        reference: n.designator || String(i + 1),
        quantity: n.quantity,
        value: n.value || n.description || "",
        mpn: n.mpn || "",
        manufacturer: n.normalizedManufacturer || n.manufacturer || "",
        package: n.kicadFootprint || n.package || "",
        original,
        status: "unmatched" as const,
        reason:
          n.issues
            .filter((x) => x.severity === "error")
            .map((x) => x.code)
            .join(", ") || undefined,
      };
    })
    .filter((r): r is BomRow => r !== null);
}
export function matchRow(row: BomRow, candidates: Part[]): BomRow {
  candidates = rankParts(
    candidates,
    row.mpn || row.value,
    row.manufacturer,
    row.package,
    row.reference,
  );
  const exact = candidates.filter(
    (c) =>
      exactMpn(row.mpn, c.mpn) &&
      (!row.manufacturer ||
        sameManufacturer(row.manufacturer, c.manufacturer)) &&
      (!row.package ||
        !c.package ||
        samePackage(row.package, c.package, row.reference)),
  );
  const identities = new Set(
    exact.map((p) => p.mpn.toUpperCase() + "|" + p.manufacturer.toLowerCase()),
  );
  if (row.mpn && identities.size === 1 && exact.length) {
    return {
      ...row,
      candidates,
      selected: exact[0],
      status: "exact",
      reason:
        "Full part number matched; supplied manufacturer and package checked where available.",
    };
  }
  return {
    ...row,
    candidates,
    selected: undefined,
    status: candidates.length ? "review" : "unmatched",
    reason: !row.mpn
      ? "Specification only — select a candidate explicitly."
      : candidates.length
        ? "Confirm full part number, manufacturer and package."
        : "No candidate returned.",
  };
}
export function priceOffer(o: Offer, required: number) {
  if (!Number.isInteger(required) || required <= 0) return null;
  const quantity =
    Math.ceil(Math.max(required, o.moq || 1) / (o.multiple || 1)) *
    (o.multiple || 1);
  const tier = [...o.breaks]
    .filter(
      (b) => b.quantity <= quantity && Number.isFinite(b.price) && b.price > 0,
    )
    .sort((a, b) => b.quantity - a.quantity)[0];
  if (!tier) return null;
  return {
    quantity,
    unit: tier.price,
    total: quantity * tier.price,
    currency: o.currency,
    supplier: o.supplier,
    stockSufficient: o.stock !== null && o.stock >= quantity,
    retrievedAt: o.retrievedAt,
  };
}
export function rowPrice(row: BomRow, build: number, currency = "USD") {
  if (Number.isFinite(row.manualUnitPrice) && row.manualUnitPrice! >= 0)
    return {
      unit: row.manualUnitPrice!,
      total: row.manualUnitPrice! * row.quantity * build,
      quantity: row.quantity * build,
      currency,
      supplier: "Manual",
      retrievedAt: undefined as string | undefined,
    };
  if (!row.selected || !["exact", "confirmed"].includes(row.status))
    return null;
  return (
    row.selected.offers
      .map((o) => priceOffer(o, row.quantity * build))
      .filter(
        (p): p is NonNullable<typeof p> =>
          !!p && p.currency === currency && p.stockSufficient,
      )
      .sort((a, b) => a.total - b.total)[0] || null
  );
}
export function estimate(rows: BomRow[], build: number, currency = "USD") {
  const prices = rows.map((r) => rowPrice(r, build, currency));
  return {
    total: prices.reduce((n, p) => n + (p?.total || 0), 0),
    priced: prices.filter(Boolean).length,
    unpriced: prices.filter((p) => !p).length,
    currency,
  };
}
