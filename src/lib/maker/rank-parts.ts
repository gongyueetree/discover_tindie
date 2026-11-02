import type { Part } from "./types";
import { sameManufacturer } from "@/vendor/bom2buy/bom/references";
import { samePackage } from "@/vendor/bom2buy/bom/packageNormalize";
const key = (s: string) => s.trim().toUpperCase();
function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
    prev = next;
  }
  return prev[b.length];
}
/** Ranking is presentation only. It never upgrades a similar part to an exact identity. */
export function rankParts(
  parts: Part[],
  query: string,
  manufacturer = "",
  pkg = "",
  reference = "",
): Part[] {
  const q = key(query).slice(0, 120);
  if (!q) return [...parts];
  const score = (p: Part) => {
    const m = key(p.mpn).slice(0, 120);
    const longer = m.startsWith(q) ? m.slice(q.length) : "";
    const identity =
      m === q
        ? 4
        : longer && /^(?:[-/]?(?:TR|REEL|RL|R7|R13)|[+#](?:PBF)?)$/.test(longer)
          ? 3
          : m.startsWith(q)
            ? 2
            : 1;
    const nums = (s: string) => s.match(/\d+(?:\.\d+)?/g)?.join("|") || "";
    const numeric = nums(q) === nums(m) ? 1 : 0;
    const maker = manufacturer
      ? sameManufacturer(manufacturer, p.manufacturer)
        ? 1
        : -1
      : 0;
    const pack =
      pkg && p.package ? (samePackage(pkg, p.package, reference) ? 1 : -1) : 0;
    return [
      identity,
      maker,
      numeric,
      pack,
      1 - distance(q, m) / Math.max(q.length, m.length, 1),
      -Math.abs(q.length - m.length),
    ];
  };
  return parts
    .map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => {
      for (let i = 0; i < a.s.length; i++) {
        const d = b.s[i] - a.s[i];
        if (d) return d;
      }
      return a.i - b.i;
    })
    .map((x) => x.p);
}
