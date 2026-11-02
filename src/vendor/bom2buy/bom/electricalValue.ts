/* ============================================================
   电气参数归一化：把各种写法折算成统一基准单位，
   使 "4.3k" / "4K3" / "4300R" / "4.3 kOhm" 视为同一个值。
   用于无 MPN 行的参数匹配。
   ============================================================ */

export type ValueKind = "resistance" | "capacitance" | "inductance" | "frequency" | "unknown";

const MULTIPLIER: Record<string, number> = {
  p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3,
  "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9,
};

/** 单位 → 量纲（大小写敏感处理：m=milli, M=Mega） */
function unitKind(u: string): ValueKind {
  const s = u.toLowerCase();
  if (s === "f") return "capacitance";
  if (s === "h") return "inductance";
  if (s === "hz") return "frequency";
  if (s === "r" || s === "ohm" || s === "ohms" || s === "ω" || s === "") return "resistance";
  return "unknown";
}

/** 解析单个值 token → { kind, base }，base 为基准单位（Ω / F / H / Hz）下的数值 */
export function parseElectricalValue(raw: string): { kind: ValueKind; base: number } | null {
  const t = String(raw || "").trim().replace(/\s+/g, "");
  if (!t) return null;

  // RKM 记法：4K7 = 4.7k，4R7 = 4.7Ω，1M5 = 1.5MΩ
  const rkm = t.match(/^(\d+)([RrKkMm])(\d+)$/);
  if (rkm) {
    const mul = rkm[2].toLowerCase() === "r" ? 1 : MULTIPLIER[rkm[2].toLowerCase() === "k" ? "k" : "M"];
    const num = Number(`${rkm[1]}.${rkm[3]}`);
    return { kind: "resistance", base: num * (rkm[2].toLowerCase() === "r" ? 1 : mul) };
  }

  // 常规：数字 + 可选倍率 + 可选单位
  // 倍率含大写 P/N/U：国内 BOM 与 DigiKey 描述常全大写（1UF、100NF、22PF、4.7UH），曾全部解析失败
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([pnuµμmkKMGPNU]?)\s*(F|f|H|h|Hz|HZ|hz|R|r|Ω|ohms?|OHMS?|Ohms?)?$/);   // DigiKey 参数表写作 "10 kOhms"
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return null;

  const rawMul = m[2] || "";
  const rawUnit = m[3] || "";

  let kind = unitKind(rawUnit);
  // 大写 P/N/U 只在电容/电感上有意义（没有"皮欧"这种写法），其余情况不认
  if ((rawMul === "P" || rawMul === "N" || rawMul === "U") && kind !== "capacitance" && kind !== "inductance") return null;
  /* 大写 M 的歧义：
     电阻  M = 兆欧（10M）
     电感  兆亨不存在，全大写的 "10MH" 只能是毫亨
     电容  兆法不存在；全大写的 "MF/MFD" 老式写法常指微法，也可能是毫法——两种都合理，不猜，返回未知 */
  if (rawMul === "M" && kind === "capacitance") return null;
  const mul = rawMul === "M" && kind === "inductance" ? 1e-3 : (MULTIPLIER[rawMul] ?? MULTIPLIER[rawMul.toLowerCase()] ?? 1);

  // 无单位时按倍率猜量纲：k/M 常见于电阻
  if (kind === "resistance" && !rawUnit && (rawMul === "k" || rawMul === "K" || rawMul === "M")) kind = "resistance";

  return { kind, base: num * mul };
}

/** 两个值是否等价（相对误差 1% 内，容忍 0.1uF vs 100nF 这类写法差异） */
export function valuesEqual(a: string, b: string): boolean {
  const pa = parseElectricalValue(a), pb = parseElectricalValue(b);
  if (!pa || !pb) return false;
  if (pa.kind !== pb.kind && pa.kind !== "unknown" && pb.kind !== "unknown") return false;
  if (pa.base === 0 || pb.base === 0) return pa.base === pb.base;
  return Math.abs(pa.base - pb.base) / Math.max(pa.base, pb.base) < 0.01;
}

/** 从一段文本里抽出所有可解析的电气值（用于在目录描述中查找） */
export function extractValues(text: string): { raw: string; kind: ValueKind; base: number }[] {
  const out: { raw: string; kind: ValueKind; base: number }[] = [];
  for (const tk of String(text || "").split(/[\s,\/;()]+/).filter(Boolean)) {
    const p = parseElectricalValue(tk);
    if (p && p.kind !== "unknown") out.push({ raw: tk, kind: p.kind, base: p.base });
  }
  return out;
}

/** BOM 行的参数值是否与目录条目的描述匹配 */
export function valueMatchesDescription(lineValue: string, description: string): boolean {
  const target = parseElectricalValue(lineValue);
  if (!target || target.kind === "unknown") return false;
  return extractValues(description).some(
    (v) => v.kind === target.kind && Math.abs(v.base - target.base) / Math.max(v.base, target.base) < 0.01
  );
}

