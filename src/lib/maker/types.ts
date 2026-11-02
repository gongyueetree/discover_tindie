export type ProviderStatus = {
  source: string;
  status: "ready" | "unconfigured" | "error";
  message?: string;
};
export type Offer = {
  supplier: string;
  sku: string;
  currency: string;
  stock: number | null;
  moq: number;
  multiple: number;
  breaks: { quantity: number; price: number }[];
  url?: string;
  retrievedAt: string;
};
export type Part = {
  originalText?: { description: string; parameters: Record<string, string> };
  translation?: { status: string; method: string; sourceHash: string };
  id: string;
  mpn: string;
  manufacturer: string;
  description: string;
  package?: string;
  datasheet?: string;
  image?: string;
  source: string;
  parameters: Record<string, string>;
  cad: { name: string; url: string; kind: string }[];
  offers: Offer[];
  /** partdata (ezPLM data platform) fields; absent for distributor-only results. */
  category?: string;
  lifecycle?: string | null;
  symbolName?: string | null;
  footprintName?: string | null;
  usedInDesigns?: number;
  productUrl?: string;
  /** Where each field came from: ezplm | enriched | distributor. */
  fieldSources?: Record<string, string>;
  /** Fields held back by the platform because of an unresolved conflict. */
  withheld?: string[] | null;
  /** True once the detail endpoint was read (list items carry only the summary). */
  detailed?: boolean;
  hasDatasheetInEzplm?: boolean;
};
export type Circuit = {
  id: string;
  name: string;
  description: string;
  format: string;
  category: string;
  parts: number | null;
  files: string[];
  sourceUrl?: string;
  license?: string;
  revision?: string;
  downloadUrl?: string;
  thumbnail?: string;
  example?: boolean;
};
export type BomRow = {
  sources?: ProviderStatus[];
  manualUnitPrice?: number;
  priceError?: string;
  id: string;
  reference: string;
  quantity: number;
  value: string;
  mpn: string;
  manufacturer: string;
  package: string;
  original: Record<string, string>;
  selected?: Part;
  status: "unmatched" | "review" | "exact" | "confirmed";
  candidates?: Part[];
  reason?: string;
};
