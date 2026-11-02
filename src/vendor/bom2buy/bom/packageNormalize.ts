/* ============================================================
   封装规范化 —— 以 KiCad 标准封装名作为 canonical form
   BOM 里同一封装写法千差万别：SOP8 / SO-8 / SOIC8 / SOIC-8 / 8-SOIC，
   统一到 KiCad footprint 后才能做可靠的封装一致性判断。

   特别注意英制/公制混淆：0402 英制 = 1005 公制，
   而 0402 公制 = 01005 英制 —— 搞反了会选错元件尺寸。
   ============================================================ */

export type MountType = "SMD" | "THT" | "UNKNOWN";

export type PackageInfo = {
  raw: string;
  /** 归一后的通用封装代码，如 "0402"（英制）、"SOIC-8" */
  normalized: string;
  /** KiCad 标准封装名，用作 canonical form */
  kicadFootprint?: string;
  family?: string;
  pinCount?: number;
  mountType: MountType;
  /** 被动件尺寸的英制/公制对照 */
  imperial?: string;
  metric?: string;
  matched: boolean;
  /** kicadFootprint 的来源。
   *  KICAD_BOM   客户 BOM/工程里明确写了 KiCad 封装，原样保留
   *  STANDARD    名称唯一确定尺寸（0603、SOT-23-5、SOD-123 等），按标准库映射
   *  UNRESOLVED  名称不足以确定尺寸/间距/裸焊盘，不给具体封装 */
  footprintSource?: "KICAD_BOM" | "STANDARD" | "UNRESOLVED";
  /** 需要人核对的地方，如英制/公制歧义、SOP 宽窄体 */
  warning?: string;
};

/* ---------- 被动件尺寸：英制 ↔ 公制 ---------- */
const CHIP_SIZES: { imperial: string; metric: string; kicad: (t: string) => string }[] = [
  { imperial: "01005", metric: "0402", kicad: (t) => `${t}_0402_1005Metric` },
  { imperial: "0201", metric: "0603", kicad: (t) => `${t}_0201_0603Metric` },
  { imperial: "0402", metric: "1005", kicad: (t) => `${t}_0402_1005Metric` },
  { imperial: "0603", metric: "1608", kicad: (t) => `${t}_0603_1608Metric` },
  { imperial: "0805", metric: "2012", kicad: (t) => `${t}_0805_2012Metric` },
  { imperial: "1206", metric: "3216", kicad: (t) => `${t}_1206_3216Metric` },
  { imperial: "1210", metric: "3225", kicad: (t) => `${t}_1210_3225Metric` },
  { imperial: "1812", metric: "4532", kicad: (t) => `${t}_1812_4532Metric` },
  { imperial: "2010", metric: "5025", kicad: (t) => `${t}_2010_5025Metric` },
  { imperial: "2512", metric: "6332", kicad: (t) => `${t}_2512_6332Metric` },
];

// 修正：0402 英制对应 1005 公制；上表首行 01005 英制对应 0402 公制
CHIP_SIZES[0] = { imperial: "01005", metric: "0402", kicad: (t) => `${t}_01005_0402Metric` };

/** 位号前缀 → KiCad 库前缀与元件字母 */
const REF_TO_LIB: Record<string, { lib: string; letter: string }> = {
  R: { lib: "Resistor_SMD", letter: "R" },
  C: { lib: "Capacitor_SMD", letter: "C" },
  L: { lib: "Inductor_SMD", letter: "L" },
  FB: { lib: "Inductor_SMD", letter: "L" },
  D: { lib: "Diode_SMD", letter: "D" },
  LED: { lib: "LED_SMD", letter: "LED" },
};

/* ---------- IC 封装别名 ---------- */
type IcPkg = { canonical: string; kicad?: string; family: string; mount: MountType; pins?: number; warning?: string };

function icAliases(): Record<string, IcPkg> {
  const map: Record<string, IcPkg> = {};
  const k = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, "");
  const reg = (canonical: string, aliases: string[], info: Omit<IcPkg, "canonical">) => {
    const key = k;
    map[key(canonical)] = { canonical, ...info };
    aliases.forEach((a) => (map[key(a)] = { canonical, ...info }));
  };

  /* 只有"名称唯一确定尺寸"的封装才给 KiCad 名。
     曾经按模板拼出 TSSOP-48_4.4x5mm、LQFP-100_10x10mm、QFN-16_5x5mm 这类名字——
     尺寸是编的，KiCad 库里要么不存在、要么尺寸错误。同名封装有多种尺寸/间距/裸焊盘时，
     只给封装族与引脚数，kicad 留空并提示核对。 */
  const NEEDS_DIMS = "封装名称不足以确定本体尺寸/引脚间距，请按数据手册核对";
  // SOIC：只有明确写 SOIC-8 才按 JEDEC 窄体；SOP8/SO-8 在国内 BOM 里常指 208mil 宽体
  reg("SOIC-8", ["SOIC8", "8-SOIC", "8SOIC"], { kicad: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", family: "SOIC", mount: "SMD", pins: 8 });
  for (const n of [8, 14, 16, 18, 20, 24, 28]) {
    if (n !== 8) reg(`SOIC-${n}`, [`SOIC${n}`, `${n}-SOIC`], { family: "SOIC", mount: "SMD", pins: n, warning: NEEDS_DIMS });
    // 规范名仍记 SOIC-n：与 SOIC 同族可比较；但宽窄体不确定，不给具体封装
    for (const a of [`SOP${n}`, `SOP-${n}`, `SO-${n}`, `SO${n}`])
      map[k(a)] = { canonical: `SOIC-${n}`, family: "SOIC", mount: "SMD", pins: n, warning: "SOP/SO 有窄体(150mil)与宽体(208mil)之分，" + NEEDS_DIMS };
  }
  // TSSOP 4.4mm 体宽系列（JEDEC MO-153）：8–28 脚尺寸固定
  const TSSOP: Record<number, string> = { 8: "4.4x3mm", 14: "4.4x5mm", 16: "4.4x5mm", 20: "4.4x6.5mm", 24: "4.4x7.8mm", 28: "4.4x9.7mm" };
  for (const n of [8, 10, 14, 16, 20, 24, 28, 38, 48, 56]) {
    reg(`TSSOP-${n}`, [`TSSOP${n}`, `${n}-TSSOP`], TSSOP[n]
      ? { kicad: `Package_SO:TSSOP-${n}_${TSSOP[n]}_P0.65mm`, family: "TSSOP", mount: "SMD", pins: n }
      : { family: "TSSOP", mount: "SMD", pins: n, warning: NEEDS_DIMS });
  }
  // MSOP：8 脚间距 0.65，10 脚间距 0.5（不是同一个间距）
  reg("MSOP-8", ["MSOP8", "8-MSOP"], { kicad: "Package_SO:MSOP-8_3x3mm_P0.65mm", family: "MSOP", mount: "SMD", pins: 8 });
  reg("MSOP-10", ["MSOP10", "10-MSOP"], { kicad: "Package_SO:MSOP-10_3x3mm_P0.5mm", family: "MSOP", mount: "SMD", pins: 10 });
  for (const n of [8, 10]) reg(`VSSOP-${n}`, [`VSSOP${n}`], { family: "VSSOP", mount: "SMD", pins: n, warning: NEEDS_DIMS });
  for (const n of [3, 5, 6, 8]) {
    reg(`SOT-23-${n}`, [`SOT23-${n}`, `SOT-23${n}`, n === 3 ? "SOT-23" : "", n === 3 ? "SOT23" : ""].filter(Boolean), {
      kicad: n === 3 ? "Package_TO_SOT_SMD:SOT-23" : `Package_TO_SOT_SMD:SOT-23-${n}`,
      family: "SOT", mount: "SMD", pins: n,
    });
  }
  // QFN/DFN：同引脚数有多种尺寸，且几乎都带裸露焊盘（EP）——名称永远不足以确定封装
  for (const n of [8, 10, 12, 16, 20, 24, 28, 32, 40, 44, 48, 56, 64]) {
    reg(`QFN-${n}`, [`QFN${n}`, `${n}-QFN`, `VQFN-${n}`, `WQFN-${n}`, `VQFN${n}`], { family: "QFN", mount: "SMD", pins: n, warning: "QFN 同引脚数有多种尺寸且通常带裸露焊盘，" + NEEDS_DIMS });
    reg(`DFN-${n}`, [`DFN${n}`, `${n}-DFN`, `WSON-${n}`, `SON-${n}`], { family: "DFN", mount: "SMD", pins: n, warning: "DFN 同引脚数有多种尺寸且通常带裸露焊盘，" + NEEDS_DIMS });
  }
  for (const n of [32, 44, 48, 64, 80, 100, 144, 176]) {
    reg(`LQFP-${n}`, [`LQFP${n}`, `${n}-LQFP`], { family: "QFP", mount: "SMD", pins: n, warning: NEEDS_DIMS });
    reg(`TQFP-${n}`, [`TQFP${n}`, `${n}-TQFP`], { family: "QFP", mount: "SMD", pins: n, warning: NEEDS_DIMS });
  }
  // DIP：8–20 脚是 300mil；24/28 有 300/600mil 两种，40 脚是 600mil
  for (const n of [8, 14, 16, 18, 20]) {
    reg(`DIP-${n}`, [`DIP${n}`, `PDIP-${n}`, `PDIP${n}`, `${n}-DIP`], { kicad: `Package_DIP:DIP-${n}_W7.62mm`, family: "DIP", mount: "THT", pins: n });
  }
  for (const n of [24, 28, 40]) {
    reg(`DIP-${n}`, [`DIP${n}`, `PDIP-${n}`, `PDIP${n}`, `${n}-DIP`], { family: "DIP", mount: "THT", pins: n, warning: "DIP 有 300mil / 600mil 两种行距，" + NEEDS_DIMS });
  }
  // TO-220 有立式/卧式之分，不能替用户选
  reg("TO-220", ["TO220", "TO-220-3"], { family: "TO", mount: "THT", pins: 3, warning: "TO-220 有立式/卧式安装之分，请确认" });
  reg("TO-252", ["TO252", "DPAK", "TO-252-3"], { kicad: "Package_TO_SOT_SMD:TO-252-3_TabPin2", family: "TO", mount: "SMD" });
  reg("TO-263", ["TO263", "D2PAK"], { kicad: "Package_TO_SOT_SMD:TO-263-3_TabPin2", family: "TO", mount: "SMD" });
  reg("SOD-123", ["SOD123"], { kicad: "Diode_SMD:D_SOD-123", family: "SOD", mount: "SMD" });
  reg("SOD-323", ["SOD323"], { kicad: "Diode_SMD:D_SOD-323", family: "SOD", mount: "SMD" });
  reg("SMA", ["DO-214AC"], { kicad: "Diode_SMD:D_SMA", family: "SMx", mount: "SMD" });
  reg("SMB", ["DO-214AA"], { kicad: "Diode_SMD:D_SMB", family: "SMx", mount: "SMD" });
  reg("SMC", ["DO-214AB"], { kicad: "Diode_SMD:D_SMC", family: "SMx", mount: "SMD" });
  return map;
}

const IC_PACKAGES = icAliases();
const key = (s: string) => String(s || "").toLowerCase().replace(/[\s\-_.]/g, "");

const LIB_BY_LETTER: Record<string, string> = { R: "Resistor_SMD", C: "Capacitor_SMD", L: "Inductor_SMD", D: "Diode_SMD", LED: "LED_SMD" };

/** 从 KiCad 封装名里解析出封装族与引脚数（不改名字本身） */
function familyFromKicadBody(body: string): { normalized: string; family?: string; pinCount?: number; mountType: MountType } {
  const chip = body.match(/_(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)_\d{4}Metric/i);
  if (chip) return { normalized: chip[1], family: "CHIP", pinCount: 2, mountType: "SMD" };
  // SOT-23-5 的 23 是封装族编号，5 才是引脚数
  const sot = body.match(/\b(SOT|SOD)-?(\d+)(?:-(\d+))?/i);
  if (sot) return { normalized: `${sot[1].toUpperCase()}-${sot[2]}${sot[3] ? "-" + sot[3] : ""}`, family: sot[1].toUpperCase(), pinCount: sot[3] ? Number(sot[3]) : (sot[1].toUpperCase() === "SOT" && sot[2] === "23" ? 3 : undefined), mountType: "SMD" };
  const named = body.match(/\b(V?QFN|DFN|LQFP|TQFP|TSSOP|SSOP|VSSOP|MSOP|SOIC|SOP|DIP|BGA)-(\d+)/i);
  if (named) {
    const fam = named[1].toUpperCase().replace(/^VQFN$/, "QFN");
    return { normalized: `${fam}-${named[2]}`, family: fam === "SOP" ? "SOIC" : fam, pinCount: Number(named[2]), mountType: /^DIP/i.test(fam) ? "THT" : "SMD" };
  }
  return { normalized: body, mountType: "UNKNOWN" };
}

/** 客户已经给出 KiCad 封装：比任何按名称推断都强，原样保留 */
function fromKicadString(raw: string, designator?: string): PackageInfo | null {
  // ① 带库名：Package_SO:SOIC-8_3.9x4.9mm_P1.27mm
  const qualified = raw.match(/^([A-Za-z0-9_+.-]+):([A-Za-z0-9_+.,()xX-]+)$/);
  // ② 不带库名但是 KiCad 标准命名：C_0603_1608Metric、R_0402_1005Metric
  const bare = !qualified && raw.match(/^(R|C|L|D|LED)_(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)_\d{4}Metric$/i);
  if (!qualified && !bare) return null;
  const body = qualified ? qualified[2] : raw;
  const fam = familyFromKicadBody(body);
  const size = fam.family === "CHIP" ? CHIP_SIZES.find((c) => c.imperial === fam.normalized) : undefined;
  const kicad = qualified ? raw : `${LIB_BY_LETTER[(bare as RegExpMatchArray)[1].toUpperCase()]}:${raw}`;
  return {
    raw, ...fam, kicadFootprint: kicad, footprintSource: "KICAD_BOM",
    imperial: size?.imperial, metric: size?.metric, matched: true,
  };
}

/** 公制尺寸码 → 英制。这些码只作公制理解（不存在同名英制尺寸） */
const METRIC_ONLY: Record<string, string> = { "1005": "0402", "1608": "0603", "2012": "0805", "3216": "1206", "3225": "1210", "4532": "1812", "5025": "2010", "6332": "2512" };

export function normalizePackage(raw?: string, designator?: string): PackageInfo {
  const original = String(raw || "").trim();
  if (!original) return { raw: "", normalized: "", mountType: "UNKNOWN", matched: false };

  // ① 客户已给 KiCad 封装
  const fromKicad = fromKicadString(original, designator);
  if (fromKicad) return fromKicad;

  const body = original.includes(":") ? original.split(":").pop()!.trim() : original;
  const refPrefix = String(designator || "").match(/^([A-Za-z]+)/)?.[1]?.toUpperCase();
  const lib = refPrefix ? REF_TO_LIB[refPrefix] : undefined;
  const chip = (imp: string, warning?: string): PackageInfo => {
    const size = CHIP_SIZES.find((s) => s.imperial === imp)!;
    return {
      raw: original, normalized: imp,
      kicadFootprint: lib ? `${lib.lib}:${size.kicad(lib.letter)}` : undefined,
      footprintSource: lib ? "STANDARD" : "UNRESOLVED",
      family: "CHIP", pinCount: 2, mountType: "SMD",
      imperial: imp, metric: size.metric, matched: true, warning,
    };
  };

  // ② 双标注"英制 (公制 Metric)"，DigiKey 标准写法：0402 (1005 Metric)。以成对一致的英制为准
  const dual = body.match(/(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)\s*[(（]\s*(\d{4})\s*Metric\s*[)）]/i);
  if (dual) {
    const size = CHIP_SIZES.find((c) => c.imperial === dual[1]);
    if (size && size.metric === dual[2]) return chip(dual[1]);
  }
  // ③ 明确标了公制（1608、0603 公制、0603Metric）
  const explicitMetric = /metric|公制|毫米/i.test(body);
  const metricCode = body.match(/(?:^|[_\-\s(（])(1005|1608|2012|3216|3225|4532|5025|6332)(?:[_\-\s)）]|$|metric)/i)?.[1];
  if (metricCode) return chip(METRIC_ONLY[metricCode]);
  if (explicitMetric) {
    // "0603 公制" = 英制 0201；"0402 公制" = 英制 01005
    const m = body.match(/(0402|0603)/)?.[1];
    if (m) return chip(m === "0603" ? "0201" : "01005");
  }

  // ④ 被动件尺寸码（默认按英制理解）
  const sizeMatch = body.match(/(?:^|[_\-\s])?(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)(?:[_\-\s]|$)/);
  if (sizeMatch) {
    const imp = sizeMatch[1];
    const explicitImperial = /imperial|英制|inch/i.test(body);
    // 0402、0603 同时是合法的英制码和公制码（公制 0603 = 英制 0201），会选错尺寸
    const ambiguous = !explicitImperial && (imp === "0402" || imp === "0603");
    return chip(imp, ambiguous ? `按英制 ${imp} 理解；若客户按公制书写则应为英制 ${imp === "0603" ? "0201" : "01005"}，请确认尺寸制式` : undefined);
  }

  // ④ IC 封装别名
  const ic = IC_PACKAGES[key(body)];
  if (ic) {
    return {
      raw: original, normalized: ic.canonical, kicadFootprint: ic.kicad,
      footprintSource: ic.kicad ? "STANDARD" : "UNRESOLVED", warning: ic.warning,
      family: ic.family, pinCount: ic.pins, mountType: ic.mount, matched: true,
    };
  }

  // ⑤ 从串里抽取封装族+引脚数，如 "MSOP-10_3x3mm_P0.5mm"、"QFN-32-1EP_5x5mm"
  //    必须在去分隔符之前解析：MSOP-10_3x3mm 不能变成 103 脚
  const generic = body.match(/\b(SOIC|SOP|SSOP|TSSOP|MSOP|VSSOP|QFN|VQFN|DFN|LQFP|TQFP|QFP|BGA|DIP|SOT|TO|SOD)-?(\d+)?/i);
  if (generic) {
    const fam = generic[1].toUpperCase().replace(/^VQFN$/, "QFN");
    const canon = generic[2] ? `${fam}-${generic[2]}` : fam;
    const hit = IC_PACKAGES[key(canon)];
    const hasEp = /\bEP\b|-\d?EP|EXPOSED|裸露/i.test(body);
    const base = hit
      ? { normalized: hit.canonical, family: hit.family, pinCount: hit.pins, mountType: hit.mount }
      : { normalized: canon, family: fam, pinCount: generic[2] ? Number(generic[2]) : undefined,
          mountType: (/^(DIP|TO-2[25])/i.test(canon) ? "THT" : "SMD") as MountType };
    // 带了尺寸/EP 描述时，别名表里的"标准封装"未必是这一颗——不套用
    const extraDims = /\d+(?:\.\d+)?\s*[xX×]\s*\d+(?:\.\d+)?\s*mm|P\d/.test(body) || hasEp;
    const std = hit?.kicad && (!extraDims || hit.kicad.split(":").pop()!.toUpperCase() === body.toUpperCase()) ? hit.kicad : undefined;
    // 客户写的是完整 KiCad 命名（只缺库名），如 QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm
    const KICAD_NAME = /^(?:SOIC|SSOP|TSSOP|MSOP|VSSOP|QFN|DFN|LQFP|TQFP)-\d+(?:-1EP)?_[\d.]+x[\d.]+mm_P[\d.]+mm(?:_EP[\d.]+x[\d.]+mm)?$/i;
    const libFor = /QFN|DFN/i.test(fam) ? "Package_DFN_QFN" : /QFP/i.test(fam) ? "Package_QFP" : "Package_SO";
    const named = !std && KICAD_NAME.test(body) && (!hasEp || /_EP[\d.]+x/i.test(body)) ? `${libFor}:${body}` : undefined;
    const kicad = std || named;
    return {
      raw: original, ...base, kicadFootprint: kicad,
      footprintSource: named ? "KICAD_BOM" : kicad ? "STANDARD" : "UNRESOLVED",
      warning: kicad ? undefined : (hasEp ? "带裸露焊盘，" : "") + "封装名称已归一，尺寸/间距/焊盘请按数据手册核对",
      matched: !!hit,
    };
  }

  return { raw: original, normalized: body, mountType: "UNKNOWN", matched: false, footprintSource: "UNRESOLVED" };
}

/** 两个封装是否可视为同一封装（canonical 一致即可） */
export function samePackage(a?: string, b?: string, designator?: string): boolean {
  const pa = normalizePackage(a, designator), pb = normalizePackage(b, designator);
  if (!pa.normalized || !pb.normalized) return false;
  if (pa.kicadFootprint && pb.kicadFootprint) return pa.kicadFootprint === pb.kicadFootprint;
  return pa.normalized.toUpperCase() === pb.normalized.toUpperCase();
}

/** 英制 ↔ 公制换算，供人工核对 */
export function imperialToMetric(imp: string): string | undefined {
  return CHIP_SIZES.find((s) => s.imperial === imp)?.metric;
}
export function metricToImperial(met: string): string | undefined {
  return CHIP_SIZES.find((s) => s.metric === met)?.imperial;
}

/** 从描述文本里找封装（"CAP CER 0.1UF 16V X7R 0402" → 0402）。找不到返回 undefined，不猜。
    注意与"包装方式"区分：Factory Reel / Cut Tape / Tray 是包装，不是封装。 */
export function packageFromText(text?: string, designator?: string): PackageInfo | undefined {
  const t = String(text || "");
  const tok = t.match(/\b(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)\b/)?.[1]
    || t.match(/\b(?:SOT|SOD|SOIC|SOP|TSSOP|SSOP|MSOP|VSSOP|QFN|DFN|LQFP|TQFP|DIP|TO)-?\d+(?:-\d+)?\b/i)?.[0];
  if (!tok) return undefined;
  const p = normalizePackage(tok, designator);
  return p.matched ? p : undefined;
}

