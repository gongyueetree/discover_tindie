import { parseReferences, normalizeManufacturer } from "./references";
import { normalizePackage } from "./packageNormalize";
/* ============================================================
   BOM 解析与标准化（从 App.tsx 抽出，便于测试与复用）
   兼容 KiCad / Altium / EasyEDA(立创EDA) / 中英文表头
   ============================================================ */

export type StdField =
  | "designator" | "quantity" | "mpn" | "manufacturer" | "value"
  | "package" | "description" | "customerPartNumber" | "supplierPartNumber"
  | "notes" | "ignore";

export const COLUMN_DICT: Record<Exclude<StdField, "ignore">, string[]> = {
  designator: ["位号", "ref", "refdes", "ref des", "designator", "designators", "reference", "references", "位置", "元件位号", "工位", "元件号", "location", "locations", "refdes."],
  quantity: ["数量", "qty", "quantity", "用量", "pcs", "count"],
  mpn: [
    "型号", "规格型号", "料号", "厂家型号", "制造商料号", "mpn", "part number", "partnumber",
    "part_number", "part#", "p/n", "pn", "part no", "manufacturer part", "manufacturerpartnumber",
    "designitemid", "lcsc part", "lcsc", "商品编号", "供应商编号",
  ],
  manufacturer: ["品牌", "厂商", "制造商", "生产商", "厂家", "生产厂商", "原厂", "manufacturer", "mfr", "mfg", "brand", "vendor", "make", "supplier", "mfg1", "mfr1"],
  value: ["参数", "规格", "value", "阻值", "容值", "spec", "comment", "标称值"],
  package: ["封装", "package", "footprint", "pcb footprint", "pcb decal", "decal", "case", "外形", "封装规格", "package/footprint", "封装形式"],
  description: ["描述", "名称", "description", "desc", "备注说明", "comment2", "物料名称", "元件名称", "name", "additional description", "规格描述", "品类", "类别"],
  customerPartNumber: ["客户料号", "customer part", "customerpn", "客户编码", "客户物料号", "物料编码", "内部编码", "公司料号", "erp料号", "内部料号", "item code", "part no.", "原料号"],
  supplierPartNumber: ["供应商料号", "supplier part", "distributor part", "订货号", "sku"],
  notes: ["备注", "note", "notes", "remark", "remarks", "说明"],
};

export function autoMapColumn(header: string): StdField {
  const h = String(header || "").toLowerCase().trim();
  if (!h) return "ignore";
  // 先精确匹配，避免 "customer part number" 被 mpn 的 "part number" 抢走
  for (const [field, aliases] of Object.entries(COLUMN_DICT)) {
    if (aliases.some((a) => h === a)) return field as StdField;
  }
  const priority: (keyof typeof COLUMN_DICT)[] = [
    "customerPartNumber", "supplierPartNumber", "designator", "quantity",
    "manufacturer", "package", "mpn", "value", "description", "notes",
  ];
  for (const field of priority) {
    if (COLUMN_DICT[field].some((a) => h.includes(a))) return field;
  }
  return "ignore";
}

/* ---------- 表头行定位：跳过标题/说明行 ---------- */
export function scoreHeaderRow(row: any[]): number {
  return (row || []).reduce((s: number, c: any) => (autoMapColumn(String(c ?? "")) !== "ignore" ? s + 1 : s), 0);
}
export function findHeaderRow(table: any[][], scanRows = 15): { idx: number; score: number } {
  let best = { idx: 0, score: 0 };
  for (let i = 0; i < Math.min(scanRows, table.length); i++) {
    const sc = scoreHeaderRow(table[i]);
    if (sc > best.score) best = { idx: i, score: sc };
  }
  return best;
}
/** 工作表是否像 BOM（用于跳过 Numbers 导出的说明页等） */
export function isBomSheet(table: any[][], minScore = 2): boolean {
  const { idx, score } = findHeaderRow(table);
  const dataRows = table.slice(idx + 1).filter((r) => (r || []).some((c) => String(c ?? "").trim() !== ""));
  return score >= minScore && dataRows.length > 0;
}

/* ---------- KiCad：Value 既可能是 MPN 也可能是阻容值 ---------- */
const VALUE_TOKEN = /^~?\d+(?:\.\d+)?\s*(?:p|n|u|µ|m|k|K|M|G|R)?\s*(?:F|f|H|h|Ω|ohm|OHM|Ohm|V|v|A|a|W|w|Hz|HZ|hz|%|R|r)?$/;
const RKM_CODE = /^\d+[RrKkMm]\d+$/;                    // 4K7 / 4R7
const DIELECTRIC = /^(X5R|X7R|X6S|X8R|C0G|NP0|NPO|Y5V|Z5U|NTC|PTC)$/i;

export function isValueToken(tk: string): boolean {
  const t = tk.trim();
  if (!t || t === "~" || t === "-") return true;
  if (VALUE_TOKEN.test(t) || RKM_CODE.test(t)) return true;
  if (/^±?\d+(?:\.\d+)?%$/.test(t)) return true;
  if (DIELECTRIC.test(t)) return true;
  return false;
}
export function looksLikePassiveValue(v: string): boolean {
  const tokens = String(v).split(/[,\/\s]+/).filter(Boolean);
  return tokens.length > 0 && tokens.every(isValueToken);
}
/* ---------- Value 中的 MPN 识别 ----------
   不规范 BOM 常把料号写在 Value 列，且可能与参数混在一格：
     "XFL5030"                        → 纯型号
     "10uF 16V GRM188R61C106MA73D"    → 参数 + 型号混合
     "10K 1%" / "SOT-23" / "LED_0603" → 不是型号
*/

/** 封装 / 外形代码：出现在 Value 列时是封装而非料号 */
const PACKAGE_CODE = new RegExp(
  "^(" +
  "SOT-?\\d+[A-Z]?|SOIC-?\\d+|SOP-?\\d+|SSOP-?\\d+|TSSOP-?\\d+|MSOP-?\\d+|" +
  "QFN-?\\d+|DFN-?\\d+|LQFP-?\\d+|TQFP-?\\d+|QFP-?\\d+|BGA-?\\d+|LGA-?\\d+|" +
  "DIP-?\\d+|SIP-?\\d+|TO-?\\d+[A-Z]{0,2}|SOD-?\\d+|SMA|SMB|SMC|DO-?\\d+|MINIMELF|MELF|SMAF|SMBF|" +
  "\\d{4}|\\d{3,4}METRIC|R?\\d{4}" +
  ")$", "i");

/** KiCad/Altium 符号名：类别前缀 + 封装/描述，如 LED_0603、R_0603、CONN_01x02 */
const SYMBOL_NAME = /^(R|C|L|D|Q|U|J|K|SW|LED|FB|TP|CONN|CRYSTAL|FUSE|TEST[_-]?POINT)[_-]/i;

/** 明显的非料号标签 */
const PLAIN_LABEL = /^(PWR|GND|VCC|VDD|VSS|SWD|SWDIO|SWCLK|NC|DNP|DNF|TESTPOINT|TEST[_-]?POINT|MOUNTINGHOLE|LOGO|FIDUCIAL)$/i;

/** 该 token 是否像制造商料号 */
/** 是否是位号形态：R1 / C1,C2,C3 / U101 */
export function looksLikeDesignator(v: string): boolean {
  const parts = String(v || "").split(/[,，、;\s]+/).filter(Boolean);
  if (!parts.length || parts.length > 60) return false;
  const hit = parts.filter((p) => /^[A-Z]{1,4}\d+[A-Z]?$/i.test(p)).length;
  return hit / parts.length >= 0.8;
}

/** 封装/脚位命名（Altium/PADS 风格）：C0402、R0603、0402-C、SO14NB、WSON8-0D5、SOT223-I90 */
const FOOTPRINT_LIKE = /^(?:[CRLDFU]\d{4}(?:[-_][A-Z0-9]+)?|\d{4}[-_]?[CRLD]|SO\d+[A-Z]*|WSON\d+.*|SOT\d+[-_].*|CONN?_.*|CON_.*|FP_.*|PKG_.*|\d{3,4}[-_]\d)$/i;

export function looksLikeMpn(v: string): boolean {
  const t = String(v || "").trim();
  if (t.length < 4 || t.length > 32) return false;
  // 含空白、中文、中文逗号、反引号、温度符号 → 是描述/规格串，不是料号
  if (/[\s，、；\u4e00-\u9fa5`℃°]/.test(t)) return false;
  // 逗号：只允许 Nexperia/NXP 风格的 ",115" 包装后缀
  if (t.includes(",") && !/,\d{3}$/.test(t)) return false;
  // 规格特征字符
  if (/[@Ω±%]/.test(t)) return false;
  // "10uF/10V/X5R"：斜杠分段里出现带单位的量值 → 是参数串
  // 但 "SMD1812P260TF/16"、"LP2985AIM5X-3.3/NOPB" 的斜杠是后缀，分段无单位量值
  if (t.includes("/")) {
    const segs = t.split("/");
    const valueSegs = segs.filter((seg) => /^\d+(?:\.\d+)?\s*[pnuµμmkKMR]?[FHVAWΩ]/i.test(seg) || /^\d+(?:\.\d+)?[kKM]\d*$/.test(seg));
    if (valueSegs.length >= 1 && segs.length >= 3) return false;
    if (valueSegs.length >= 2) return false;
  }
  // 下划线过多的是 EDA 规格串（MLCC_22pF_50V_0402_...）
  if ((t.match(/_/g) || []).length >= 3) return false;
  if (FOOTPRINT_LIKE.test(t)) return false;
  if (looksLikePassiveValue(t)) return false;   // 10uF / 4K7 / 1%
  if (PACKAGE_CODE.test(t)) return false;       // SOT-23 / LQFP-48 / 0603
  if (SYMBOL_NAME.test(t)) return false;        // LED_0603 / R_0603
  if (PLAIN_LABEL.test(t)) return false;        // PWR / SWD
  if (DIELECTRIC.test(t)) return false;         // X7R
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false; // 料号需字母+数字
  // 单位量纲结尾（8MHZ、100NF、3V3）视为参数
  if (/^\d+(?:\.\d+)?[A-Z]{1,3}\d*$/i.test(t) && /^(\d+(?:\.\d+)?)(P|N|U|M|K|G|R|V|A|W)/i.test(t)) {
    if (/(HZ|F|H|V|A|W|R|Ω)$/i.test(t)) return false;
  }
  return true;
}

/** 一格 Value 里同时有参数和料号时，把两者分开 */
export function extractMpnFromValue(rawValue: string): { mpn?: string; value?: string; alternates?: string[] } {
  const raw = String(rawValue || "").trim();
  if (!raw) return {};

  // 先分词再判断：整串判定会把 "10uF 16V GRM188..." 误当成一个料号
  // 保护 Nexperia/NXP 风格的 ",115" 包装后缀，不当作分隔符
  const protectedRaw = raw.replace(/,(\d{3})(?=$|[\s;])/g, "\u0001$1");

  // "A / B" 或 "A or B"：替代对写法，第一个为主料号
  const altParts = protectedRaw.split(/\s+\/\s+|\s+or\s+|\s*[;；|]\s*|\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (altParts.length >= 2 && altParts.every((p) => looksLikeMpn(p.replace(/\u0001/g, ",")))) {
    return { mpn: altParts[0].replace(/\u0001/g, ","), value: undefined,
             alternates: altParts.slice(1).map((m) => m.replace(/\u0001/g, ",")) };
  }

  // 分词：不按裸 "/" 切（SGM8954-1XN5G/TR 的 /TR 是后缀）；只有当整段不像料号时才再按 / 拆
  const tokens = protectedRaw.split(/[\s,;]+/).filter(Boolean)
    .flatMap((tk) => (tk.includes("/") && !looksLikeMpn(tk) ? tk.split("/") : [tk]))
    .filter(Boolean).map((t) => t.replace(/\u0001/g, ","));

  // 单 token：整格要么是料号要么是参数
  if (tokens.length === 1) {
    return looksLikeMpn(tokens[0]) ? { mpn: tokens[0] } : { value: raw };
  }

  const mpnTokens = tokens.filter(looksLikeMpn);
  // 恰好一个 token 像料号 → 拆分；多个则无法判定，整体留作 Value 交人工/AI 处理
  if (mpnTokens.length === 1) {
    const mpn = mpnTokens[0];
    const rest = tokens.filter((tk) => tk !== mpn).join(" ").trim();
    return { mpn, value: rest || undefined };
  }
  return { value: raw };
}

/** 判断整列是否其实是料号列（不规范 BOM 常把 MPN 放在 Value 表头下） */
export function columnLooksLikeMpn(values: string[], threshold = 0.5): boolean {
  const nonEmpty = values.map((v) => String(v || "").trim()).filter(Boolean);
  if (nonEmpty.length < 3) return false;
  const hits = nonEmpty.filter((v) => !!extractMpnFromValue(v).mpn).length;
  return hits / nonEmpty.length >= threshold;
}

/* ---------- 被动件参数抽取 ---------- */
export type PassiveSpec = {
  kind: "resistor" | "capacitor" | "inductor" | "diode" | "led" | "unknown";
  value?: string; tolerance?: string; voltage?: string; power?: string;
  dielectric?: string; current?: string; color?: string; pkg?: string;
};

const COLORS = ["red", "green", "blue", "white", "yellow", "orange", "amber", "红", "绿", "蓝", "白", "黄"];

export function extractPassiveSpec(line: { value?: string; description?: string; package?: string; designator?: string }): PassiveSpec {
  const text = `${line.value || ""} ${line.description || ""}`.trim();
  const ref = String(line.designator || "").toUpperCase();
  const spec: PassiveSpec = { kind: "unknown", pkg: line.package };

  if (/^R/.test(ref) || /\bRES\b/i.test(text)) spec.kind = "resistor";
  else if (/^C/.test(ref) || /\bCAP\b/i.test(text)) spec.kind = "capacitor";
  else if (/^(L|FB)/.test(ref) || /\bINDUCTOR\b|\bFERRITE\b/i.test(text)) spec.kind = "inductor";
  else if (/^D/.test(ref) && /LED/i.test(text)) spec.kind = "led";
  else if (/^D/.test(ref) || /\bDIODE\b/i.test(text)) spec.kind = "diode";

  const tol = text.match(/±?\s*(\d+(?:\.\d+)?)\s*%/);
  if (tol) spec.tolerance = `${tol[1]}%`;
  const volt = text.match(/(\d+(?:\.\d+)?)\s*V\b/i);
  if (volt) spec.voltage = `${volt[1]}V`;
  const power = text.match(/(\d+\/\d+|\d+(?:\.\d+)?)\s*W\b/i);
  if (power) spec.power = `${power[1]}W`;
  const cur = text.match(/(\d+(?:\.\d+)?)\s*(mA|A)\b/i);
  if (cur) spec.current = `${cur[1]}${cur[2]}`;
  const die = text.match(/\b(X5R|X7R|X6S|X8R|C0G|NP0|NPO|Y5V|Z5U)\b/i);
  if (die) spec.dielectric = die[1].toUpperCase();
  if (spec.kind === "led") {
    const col = COLORS.find((c) => text.toLowerCase().includes(c));
    if (col) spec.color = col;
  }
  const val = String(line.value || "").split(/[,\/\s]+/)[0];
  if (val && isValueToken(val)) spec.value = val;
  return spec;
}

/* ---------- 规格串解析 ----------
   客户 BOM 常把参数和封装塞在一个串里：
     "CC0402,100nF"                     → 封装 0402，值 100nF
     "MLCC_22pF_`50V_0402_C0G(NPO)_0.5mm" → 值 22pF，耐压 50V，封装 0402，介质 C0G
     "100n，50V，C0402"                  → 值 100n，耐压 50V，封装 0402
     "Capacitor Cer. SMD,15p/25V-20%-X7R-0603" → 值 15p，耐压 25V，容差 20%，X7R，0603
*/
const CHIP_SIZE_RE = /(?:^|[^\d])(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)(?![\d])/;

export function parseSpecString(text?: string): { value?: string; package?: string; voltage?: string; tolerance?: string; dielectric?: string } {
  const raw = String(text || "").trim();
  if (!raw) return {};
  const out: ReturnType<typeof parseSpecString> = {};
  // 封装：尺寸码（含 C0402 / 0402-C 形式）
  const sz = raw.match(CHIP_SIZE_RE);
  if (sz) out.package = sz[1];
  else {
    const ic = raw.match(/\b(SOT-?\d+(?:-\d+)?|SOIC-?\d+|SOP-?\d+|SSOP-?\d+|TSSOP-?\d+|MSOP-?\d+|QFN-?\d+|DFN-?\d+|LQFP-?\d+|TQFP-?\d+|SOD-?\d+|SMA|SMB|SMC|DIP-?\d+|TO-?\d+)\b/i);
    if (ic) out.package = ic[1].toUpperCase();
  }
  const volt = raw.match(/(\d+(?:\.\d+)?)\s*V(?![A-Za-z])/i);
  if (volt) out.voltage = `${volt[1]}V`;
  const tol = raw.match(/[±+\-]?\s*(\d+(?:\.\d+)?)\s*%/);
  if (tol) out.tolerance = `${tol[1]}%`;
  const die = raw.match(/\b(X5R|X7R|X6S|X7S|X8R|C0G|NP0|NPO|Y5V|Z5U)\b/i);
  if (die) out.dielectric = die[1].toUpperCase();
  // 值：第一个可解析的电气量（排除耐压那种带 V 的）
  for (const tk of raw.split(/[,，、;；_\s\/\-`()]+/).filter(Boolean)) {
    if (/V$/i.test(tk) && /^\d/.test(tk)) continue;      // 50V 是耐压
    if (/^\d+(?:\.\d+)?%$/.test(tk)) continue;
    // 裸数字（23、0402）不算值：会把 SOT-23 的 23 误当阻值。值必须带单位或 RKM 字母
    if (!/[a-zA-ZµμΩ]/.test(tk)) continue;
    if (isValueToken(tk)) { out.value = tk; break; }
  }
  return out;
}

/* ---------- 从中英混排的描述里抽料号 ----------
   "IC;SN74LVC1T45DBVR，用于TPL45-A;" / "型号：LMX5069MS；输入电压…" / "贴片;MCU;1SX110HN3F43E3VG，商业级"
   规则从严：≥7 字符、字母+数字、非封装/规格形态；多个候选取最长。
   短 token（TPL45、SS14）宁可漏掉也不猜——漏了可人工补，猜错会买错料。 */
export function extractEmbeddedMpn(text?: string): string | undefined {
  const raw = String(text || "");
  if (!raw) return undefined;
  // 在中文与拉丁字符边界插入分隔，避免 "用于TPL45" 粘连
  const spaced = raw.replace(/([\u4e00-\u9fa5])([A-Za-z0-9])/g, "$1 $2").replace(/([A-Za-z0-9])([\u4e00-\u9fa5])/g, "$1 $2");
  const tokens = spaced.split(/[\s,，;；:：()（）\[\]【】\/、]+/).filter(Boolean);
  const cands = tokens.filter((t) => t.length >= 7 && /[A-Za-z]/.test(t) && /\d/.test(t) && looksLikeMpn(t)
    && !/^\d+(?:\.\d+)?[a-zA-ZµμΩ]{1,3}$/.test(t));   // 排除 "5.6mΩ"/"100UF" 这类单个量值
  if (!cands.length) return undefined;
  return cands.sort((a, b) => b.length - a.length)[0];
}

/* ---------- 一格多料号（客户 AVL 写法） ----------
   "CGA0603C0G150J500JT\r\nCC0603JRNPO9BN150\r\n0603CG150J500NT" 配合
   厂商列 "HRE\r\nYAGEO\r\nFH"：第一个为主料号，其余为已认可替代 */
export function splitMultiMpn(mpnCell?: string, mfrCell?: string): {
  mpn?: string; manufacturer?: string; alternates: { mpn: string; manufacturer?: string }[];
  packageHint?: string; descriptionHint?: string;
} {
  const rawParts = String(mpnCell || "").split(/[\r\n]+|\s*[;；|]\s*/).map((x) => x.trim()).filter(Boolean);
  const mfrs = String(mfrCell || "").split(/[\r\n]+|\s*[;；|]\s*/).map((x) => x.trim()).filter(Boolean);
  // 分号后可能跟封装（"AMS117-1.2V;SOT-223;"）或中文描述（"TPS53355DQPR；1.5V 至 15V…"）
  const mpnParts: string[] = []; let packageHint: string | undefined; let descriptionHint: string | undefined;
  for (const p of rawParts) {
    if (looksLikeMpn(p) || (/^[A-Za-z0-9][A-Za-z0-9\-.]+ [A-Za-z0-9]{1,4}$/.test(p) && looksLikeMpn(p.replace(/\s+/g, "")))) mpnParts.push(p);
    else if (!packageHint && parseSpecString(p).package && p.length <= 16) packageHint = p;
    else descriptionHint = descriptionHint ? `${descriptionHint} ${p}` : p;
  }
  if (!mpnParts.length) return { mpn: undefined, alternates: [], packageHint, descriptionHint };
  if (mpnParts.length === 1) return { mpn: mpnParts[0], manufacturer: mfrs.join(" ") || undefined, alternates: [], packageHint, descriptionHint };
  const paired = mpnParts.map((m, i) => ({ mpn: m, manufacturer: mfrs.length === mpnParts.length ? mfrs[i] : undefined }));
  return { mpn: paired[0].mpn, manufacturer: paired[0].manufacturer ?? (mfrs.length === 1 ? mfrs[0] : undefined), alternates: paired.slice(1), packageHint, descriptionHint };
}

/* ---------- 非物料行识别 ----------
   BOM 末尾常有 Total / 合计 / 小计，中间可能有分类标题行（如 "电阻"），
   这些行不是物料，不该参与匹配与采购。 */
const SUMMARY_WORDS = /^(total|subtotal|sum|grand\s*total|合计|总计|小计|总价|汇总|备注|说明|以下空白|end\s*of\s*bom)$/i;

export function isNonBomRow(line: {
  designator?: string; quantity?: number; mpn?: string; value?: string; description?: string;
}): { isNonBom: boolean; reason?: string } {
  const cells = [line.designator, line.mpn, line.value, line.description]
    .map((c) => String(c ?? "").trim()).filter(Boolean);

  // 整行只有一个短文本且是汇总词
  if (cells.length === 1 && SUMMARY_WORDS.test(cells[0])) {
    return { isNonBom: true, reason: "SUMMARY_ROW" };
  }
  // 任一字段是汇总词，且没有料号也没有参数
  if (!line.mpn && !line.value && cells.some((c) => SUMMARY_WORDS.test(c))) {
    return { isNonBom: true, reason: "SUMMARY_ROW" };
  }
  // 完全没有可识别内容
  if (!cells.length) return { isNonBom: true, reason: "EMPTY_ROW" };
  // 只有位号栏有一句自由文本（含多个英文单词、无位号形态）且无数量/料号/参数 → 说明行
  const onlyDes = cells.length === 1 && !!line.designator && !line.mpn && !line.value;
  if (onlyDes && (!line.quantity || line.quantity === 0)) {
    const d = String(line.designator).trim();
    const words = d.split(/\s+/);
    const refLike = words.filter((w) => /^[A-Za-z]{1,4}\d+/.test(w)).length;
    if ((words.length >= 3 && refLike / words.length < 0.5) || /^(NL|N\/A|NA|TBD)$/i.test(d)) {
      return { isNonBom: true, reason: "NOTE_ROW" };
    }
  }
  return { isNonBom: false };
}

/* ---------- 质量检查 ---------- */
export type BomIssue = { code: string; detail?: string; severity: "error" | "warning" | "info" };

export type NormalizedLine = {
  lineNumber: number;
  designator?: string; quantity: number; mpn?: string; manufacturer?: string;
  value?: string; package?: string; description?: string;
  customerPartNumber?: string; supplierPartNumber?: string; notes?: string;
  mpnFromValue?: boolean;
  mpnFromDesignator?: boolean;
  /** 汇总行/空行等非物料行 */
  nonBom?: boolean;
  /** 同一格里列出的已认可替代料（客户 AVL 写法） */
  alternateMpns?: { mpn: string; manufacturer?: string }[];
  packageFromSpec?: boolean;
  valueFromSpec?: boolean;
  /** 不贴装（DNP） */
  dnp?: boolean;
  /** 料号是从中英混排描述里抽出来的，置信度低于显式料号列 */
  mpnFromText?: boolean;
  /** 展开后的单个位号 */
  referenceList?: string[];
  referencesExpanded?: boolean;
  normalizedManufacturer?: string;
  manufacturerMatched?: boolean;
  normalizedPackage?: string;
  kicadFootprint?: string;
  /** 封装来源：客户 KiCad 工程 / 标准映射 / 待核对 */
  footprintSource?: "KICAD_BOM" | "STANDARD" | "UNRESOLVED";
  mountType?: "SMD" | "THT" | "UNKNOWN";
  packageImperial?: string;
  packageMetric?: string;
  spec?: PassiveSpec;
  issues: BomIssue[];
};

export function normalizeRow(
  raw: Record<string, any>, lineNumber: number, opts: { promoteValueToMpn?: boolean } = {}
): NormalizedLine {
  const line: NormalizedLine = {
    lineNumber,
    designator: str(raw.designator), quantity: parseQty(raw.quantity),
    mpn: str(raw.mpn), manufacturer: str(raw.manufacturer), value: str(raw.value),
    package: str(raw.package), description: str(raw.description),
    customerPartNumber: str(raw.customerPartNumber), supplierPartNumber: str(raw.supplierPartNumber),
    notes: str(raw.notes), issues: [],
  };

  // 一格多料号：主料号 + 替代清单
  if (line.mpn && /[\r\n;；|]/.test(line.mpn)) {
    const original = line.mpn;
    const sp = splitMultiMpn(line.mpn, line.manufacturer);
    line.mpn = sp.mpn; line.manufacturer = sp.manufacturer;
    if (!line.mpn) {
      const embedded = extractEmbeddedMpn(original);
      if (embedded) { line.mpn = embedded; line.mpnFromText = true; line.description = line.description || original; }
    }
    if (sp.alternates.length) line.alternateMpns = sp.alternates;
    if (sp.packageHint && !line.package) line.package = sp.packageHint;
    if (sp.descriptionHint && !line.description) line.description = sp.descriptionHint;
  }
  // 料号内部的单个空格（"FRC0603J102 TS"）是排版问题，折叠后再判断
  if (line.mpn && /^[A-Za-z0-9][A-Za-z0-9\-.]+ [A-Za-z0-9]{1,4}$/.test(line.mpn)) {
    const collapsed = line.mpn.replace(/\s+/g, "");
    if (looksLikeMpn(collapsed)) line.mpn = collapsed;
  }
  if (line.alternateMpns) {
    line.alternateMpns = line.alternateMpns.map((a) =>
      /^[A-Za-z0-9][A-Za-z0-9\-.]+ [A-Za-z0-9]{1,4}$/.test(a.mpn) ? { ...a, mpn: a.mpn.replace(/\s+/g, "") } : a);
  }
  // 料号列里放的其实是规格串/混合描述：先试着从中抽出嵌入的料号，
  // 抽不到再清掉交给规格解析。纯数字/数字-横杠（1804797、54-00347）是合法订购号，保留。
  if (line.mpn && !looksLikeMpn(line.mpn) && !/^[\d\-]{5,}$/.test(line.mpn)) {
    const embedded = extractEmbeddedMpn(line.mpn);
    const spec = parseSpecString(line.mpn);
    if (embedded) {
      line.description = line.description ? `${line.description} ${line.mpn}` : line.mpn;
      line.mpn = embedded;
      line.mpnFromText = true;
    } else if (spec.package || (spec.value && /[a-zA-ZµμΩ]/.test(spec.value))) {
      line.description = line.description || line.mpn;
      line.mpn = undefined;
    }
  }
  // DNP：数量栏写"不贴/DNP/NC/不装/空贴"，或参数栏只有 "/"
  const dnpWord = /^(不贴|不装|空贴|dnp|dni|dnl|nl|np|nc|n\/a|do not populate|not loaded|no load|不焊)$/i;
  if (dnpWord.test(String(raw.quantity ?? "").trim())
      || dnpWord.test(String(raw.value ?? "").trim())
      || (String(raw.value ?? "").trim() === "/" && !line.mpn)) {
    line.dnp = true;
  }

  if (opts.promoteValueToMpn !== false && !line.mpn && line.value) {
    const { mpn, value, alternates } = extractMpnFromValue(line.value);
    if (mpn) {
      line.mpn = mpn;
      line.value = value;            // 混合内容时保留剩余参数
      line.mpnFromValue = true;
      if (alternates?.length) line.alternateMpns = alternates.map((m) => ({ mpn: m }));
    }
  }

  /* 行级兜底：列映射错位时（如料号列被当成位号），
     若"位号"内容明显是料号而非位号形态，提升为 MPN。
     列级内容推断在样本不足时可能漏判，这里再兜一层。 */
  /* 先判断是否为位号形态（含 R1-R10 这类区间写法），
     再考虑"料号落在位号列"的兜底——否则区间位号会被误当料号搬走。 */
  const refsProbe = line.designator ? parseReferences(line.designator) : null;
  const looksLikeRefList = !!refsProbe && refsProbe.refs.length > 0 &&
    (refsProbe.expandedRanges.length > 0 || refsProbe.refs.length > 1 || looksLikeDesignator(line.designator || ""));

  if (!line.mpn && line.designator && !looksLikeRefList
      && looksLikeMpn(line.designator) && !looksLikeDesignator(line.designator)) {
    line.mpn = line.designator;
    line.designator = undefined;
    line.mpnFromDesignator = true;
  }
  line.spec = extractPassiveSpec(line);

  // 从规格/描述串补全缺失的 value / package（"CC0402,100nF"、"MLCC_22pF_50V_0402_..."）
  {
    const src = [line.value, line.description].filter(Boolean).join(" ");
    const spec = parseSpecString(src);
    if (!line.package && spec.package) { line.package = spec.package; line.packageFromSpec = true; }
    if ((!line.value || !isValueToken(String(line.value).split(/[\s,，\/]+/)[0])) && spec.value) {
      line.value = spec.value; line.valueFromSpec = true;
    }
    // 值列本身若是封装码（"C0402"），挪到封装
    if (line.value && !line.package && CHIP_SIZE_RE.test(line.value) && !isValueToken(line.value)) {
      line.package = line.value.match(CHIP_SIZE_RE)![1]; line.value = undefined;
    }
  }

  // 描述里明确写了封装尺寸，且与封装列不一致 → 标记冲突（2W 电阻不可能是 1206）
  {
    const descPkg = parseSpecString(line.description).package;
    if (descPkg && line.package && !line.packageFromSpec) {
      const a = String(descPkg).toUpperCase(), b = String(line.package).toUpperCase();
      const isSize = (x: string) => /^(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)$/.test(x);
      if (isSize(a) && isSize(b) && a !== b) {
        line.issues.push({ code: "DESCRIPTION_PACKAGE_CONFLICT", severity: "warning",
          detail: `描述写 ${a}，封装列为 ${b}，请与客户确认` });
      }
    }
  }

  // 厂商归一：TI / 德州仪器 / Texas Instrument 视为同一家
  if (line.manufacturer) {
    const mfr = normalizeManufacturer(line.manufacturer);
    line.normalizedManufacturer = mfr.normalized;
    line.manufacturerMatched = mfr.matched;
  }
  // 封装归一到 KiCad canonical form，并给出英制/公制对照
  if (line.package) {
    const pkg = normalizePackage(line.package, line.designator);
    line.normalizedPackage = pkg.normalized;
    line.kicadFootprint = pkg.kicadFootprint;
    line.footprintSource = pkg.footprintSource;
    line.mountType = pkg.mountType;
    if (pkg.imperial) { line.packageImperial = pkg.imperial; line.packageMetric = pkg.metric; }
    // 英制/公制歧义、SOP 宽窄体、QFN 裸焊盘等：提示核对，不替用户猜
    if (pkg.warning) line.issues.push({ code: "PACKAGE_AMBIGUOUS", severity: "info", detail: pkg.warning } as any);
  }

  if (line.dnp) {
    line.issues.push({ code: "DNP", severity: "info", detail: "不贴装，不参与采购" });
    return line;
  }
  const nonBom = isNonBomRow({ ...line, quantity: String(raw.quantity ?? "").trim() === "" ? 0 : line.quantity });
  if (nonBom.isNonBom) {
    line.nonBom = true;
    line.issues.push({ code: nonBom.reason!, severity: "info", detail: "非物料行，不参与匹配与采购" });
    return line;
  }

  /* 位号展开：支持 R1-R10 / C1,C3,C5-C9 等区间写法。
     原始字符串保留在 designator，展开结果用于数量校验。 */
  const parsedRefs = line.designator ? parseReferences(line.designator) : null;
  if (parsedRefs) {
    line.referenceList = parsedRefs.refs;
    if (parsedRefs.expandedRanges.length) line.referencesExpanded = true;
    if (parsedRefs.unparsed.length) {
      line.issues.push({ code: "REFERENCE_UNPARSED", severity: "warning",
        detail: `无法解析的位号片段：${parsedRefs.unparsed.join(", ")}` });
    }
  }
  const refCount = parsedRefs ? parsedRefs.refs.length : 0;
  if (refCount > 1 && refCount !== line.quantity) {
    line.issues.push({ code: "QTY_DESIGNATOR_MISMATCH", severity: "warning", detail: `位号数 ${refCount} ≠ 数量 ${line.quantity}` });
  }
  if (!line.mpn) line.issues.push({ code: "MISSING_MPN", severity: "warning" });
  if (!line.package) line.issues.push({ code: "MISSING_PACKAGE", severity: "info" });
  if (line.quantity <= 0) line.issues.push({ code: "ZERO_QUANTITY", severity: "error" });
  return line;
}

/** 跨行检查：同 MPN 多封装、位号重复 */
export function crossCheck(lines: NormalizedLine[]): NormalizedLine[] {
  const pkgByMpn = new Map<string, Set<string>>();
  const refSeen = new Map<string, number>();
  for (const l of lines) {
    if (l.mpn) {
      const k = l.mpn.toUpperCase();
      if (!pkgByMpn.has(k)) pkgByMpn.set(k, new Set());
      if (l.package) pkgByMpn.get(k)!.add(l.package.toUpperCase());
    }
    for (const r of (l.designator || "").split(/[,，、;\s]+/).filter(Boolean)) {
      const key = r.toUpperCase();
      if (refSeen.has(key)) {
        l.issues.push({ code: "DUPLICATE_DESIGNATOR", severity: "error", detail: `${r} 与行 ${refSeen.get(key)} 重复` });
      } else refSeen.set(key, l.lineNumber);
    }
  }
  for (const l of lines) {
    if (l.mpn && (pkgByMpn.get(l.mpn.toUpperCase())?.size || 0) > 1) {
      l.issues.push({ code: "MPN_MULTIPLE_PACKAGES", severity: "warning" });
    }
  }
  return lines;
}

/** 空白视为 1（多数 BOM 省略数量表示 1）；显式填 0 必须保留以便报错 */
export function parseQty(v: any): number {
  if (v === null || v === undefined || String(v).trim() === "") return 1;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
}

function str(v: any): string | undefined {
  const s = String(v ?? "").trim();
  return s === "" || s === "~" ? undefined : s;
}

/* 列映射下拉的展示元数据（UI 单一事实来源） */
export const STD_FIELDS_META: { key: StdField; label: string }[] = [
  { key: "designator", label: "Designator 位号" },
  { key: "quantity", label: "Quantity 数量" },
  { key: "mpn", label: "MPN 料号" },
  { key: "manufacturer", label: "Manufacturer 品牌" },
  { key: "value", label: "Value 参数" },
  { key: "package", label: "Package 封装" },
  { key: "description", label: "Description 描述" },
  { key: "customerPartNumber", label: "Customer P/N 客户料号" },
  { key: "supplierPartNumber", label: "Supplier P/N 供应商料号" },
  { key: "notes", label: "Notes 备注" },
  { key: "ignore", label: "— Ignore 忽略 —" },
];

