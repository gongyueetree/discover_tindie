/* ============================================================
   按内容推断列类型
   仅凭表头文字映射很脆弱：表头可能缺失、被拆行、用非常规叫法，
   或整列内容与表头名不符。此处采样真实数据做特征判定，
   与表头映射相互校验——内容证据强时以内容为准。
   ============================================================ */
import { StdField, looksLikeMpn, looksLikePassiveValue, autoMapColumn } from "./normalizer";
import { parseElectricalValue } from "./electricalValue";

export type ColumnSignals = {
  index: number;
  samples: number;
  mpnRatio: number;        // 像制造商料号
  designatorRatio: number; // 像位号（R1 / C1,C2,C3）
  qtyRatio: number;        // 像数量（小的正整数）
  priceRatio: number;      // 像价格（含小数的金额）
  packageRatio: number;    // 像封装（0603 / SOT-23-5）
  valueRatio: number;      // 像电气参数（10K / 0.1uF）
  emptyRatio: number;
  avgLength: number;
};

const DESIGNATOR_ONE = /^[A-Z]{1,4}\d+[A-Z]?$/i;
/** C0402 / R0603 / L0805 是封装命名，不是位号 */
const PKG_LIKE_REF = /^[CRLDFU](01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)$/i;
const PACKAGE_CODE = /^(\d{4}|SOT-?\d+(-\d+)?|SOIC-?\d+|SOP-?\d+|SSOP-?\d+|TSSOP-?\d+|MSOP-?\d+|QFN-?\d+|DFN-?\d+|LQFP-?\d+|TQFP-?\d+|QFP-?\d+|BGA-?\d+|DIP-?\d+|TO-?\d+[A-Z]?|SOD-?\d+|SMA|SMB|SMC)$/i;

function isDesignatorCell(s: string): boolean {
  const parts = s.split(/[,，、;\s]+/).filter(Boolean);
  if (!parts.length || parts.length > 60) return false;
  const hit = parts.filter((p) => DESIGNATOR_ONE.test(p) && !PKG_LIKE_REF.test(p)).length;
  return hit / parts.length >= 0.8;
}

function isQtyCell(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return n >= 0 && n <= 100000;
}

/** 价格：带小数点的数值，或带货币符号 */
function isPriceCell(s: string): boolean {
  if (/[$¥€£]/.test(s)) return true;
  if (!/^\d+\.\d{1,4}$/.test(s)) return false;
  // 纯小数也可能是电气值（如 4.7），但电气值通常带单位；无单位的小数更像价格
  return !parseElectricalValue(s) || !/[a-zA-Zµμ]/.test(s);
}

export function analyzeColumn(rows: any[][], index: number, maxSamples = 60): ColumnSignals {
  const cells: string[] = [];
  for (const r of rows) {
    if (cells.length >= maxSamples) break;
    cells.push(String(r?.[index] ?? "").trim());
  }
  const nonEmpty = cells.filter((c) => c !== "");
  const n = nonEmpty.length || 1;

  return {
    index,
    samples: nonEmpty.length,
    mpnRatio: nonEmpty.filter((c) => looksLikeMpn(c)).length / n,
    designatorRatio: nonEmpty.filter(isDesignatorCell).length / n,
    qtyRatio: nonEmpty.filter(isQtyCell).length / n,
    priceRatio: nonEmpty.filter(isPriceCell).length / n,
    packageRatio: nonEmpty.filter((c) => PACKAGE_CODE.test(c)).length / n,
    valueRatio: nonEmpty.filter((c) => looksLikePassiveValue(c) && c !== "").length / n,
    emptyRatio: (cells.length - nonEmpty.length) / (cells.length || 1),
    avgLength: nonEmpty.reduce((s, c) => s + c.length, 0) / n,
  };
}

export type MappingFix = {
  index: number;
  from: StdField;
  to: StdField;
  reason: string;
};

/**
 * 用内容证据校正表头映射。
 * 规则保守：只在内容证据很强（≥70% 命中）且与现有映射冲突时才改，
 * 避免把正确的表头映射改坏。
 */
export function reconcileMapping(
  headers: string[], rows: any[][], mapping: Record<number, StdField>
): { mapping: Record<number, StdField>; fixes: MappingFix[] } {
  const next = { ...mapping };
  const fixes: MappingFix[] = [];
  if (!rows.length) return { mapping: next, fixes };

  /* 中文 BOM 的"料号"有歧义：单独出现时是制造商料号；
     与"型号/规格型号/厂家型号/MPN"同时出现时，"料号"通常是公司内部编码。 */
  const isMpnHeader = (h: string) => /型号|mpn|part\s*number|manufacturer\s*part/i.test(h) && !/料号/.test(h);
  const isNeiBu = (h: string) => /^料号$|物料编码|内部编码|公司料号|erp/i.test(h.trim());
  if (headers.some(isMpnHeader) && headers.some(isNeiBu)) {
    headers.forEach((h, i) => {
      if (isNeiBu(h) && next[i] === "mpn") {
        next[i] = "customerPartNumber";
        fixes.push({ index: i, from: "mpn", to: "customerPartNumber", reason: "INTERNAL_PN_WITH_MPN_PRESENT" });
      }
    });
  }

  const signals = headers.map((_, i) => analyzeColumn(rows, i));
  const STRONG = 0.7;

  const assignedTo = (f: StdField) =>
    Object.entries(next).find(([, v]) => v === f)?.[0];

  /* 表头已明确映射为 package / designator / quantity / manufacturer 的列，
     内容推断不得改成别的：Footprint 列里的 "SO14NB" 再像料号也是封装。
     内容推断只能修正 ignore / value / description 这类弱映射。 */
  const PROTECTED: StdField[] = ["package", "designator", "quantity", "manufacturer", "customerPartNumber", "supplierPartNumber", "notes", "mpn"];
  // 只保护"表头本身就能明确映射"的列（Footprint/位号/数量）；
  // 表头无信息量（Item/Col 6）而被猜成位号的，仍允许内容纠正——那正是料号落在位号列的场景
  const headerSays = (i: number) => autoMapColumn(headers[i] || "");
  const setCol = (i: number, to: StdField, reason: string) => {
    const from = next[i] ?? "ignore";
    if (from === to) return;
    if (PROTECTED.includes(from) && headerSays(i) === from) return;   // 表头明确的列一律不动，含降级为 ignore
    next[i] = to;
    fixes.push({ index: i, from, to, reason });
  };

  // ① 料号列：内容强烈像料号的那一列必须是 mpn
  const headerHasMpn = headers.some((h, i) => headerSays(i) === "mpn" && next[i] === "mpn");
  const mpnCand = headerHasMpn ? undefined : signals
    .filter((s) => s.samples >= 3 && s.mpnRatio >= STRONG && s.designatorRatio < 0.5 && s.avgLength <= 28)
    .filter((s) => next[s.index] !== "customerPartNumber" && next[s.index] !== "supplierPartNumber")
    .sort((a, b) => b.mpnRatio - a.mpnRatio)[0];
  if (mpnCand) {
    const cur = assignedTo("mpn");
    if (cur === undefined || Number(cur) !== mpnCand.index) {
      // 现有 mpn 列如果内容并不像料号，让位
      if (cur !== undefined) {
        const curSig = signals[Number(cur)];
        if (curSig && curSig.mpnRatio < 0.4) setCol(Number(cur), "ignore", "MPN_CONTENT_MISMATCH");
      }
      setCol(mpnCand.index, "mpn", "MPN_BY_CONTENT");
    }
  }

  // ② 位号列
  const desCand = signals
    .filter((s) => s.samples >= 3 && s.designatorRatio >= STRONG)
    .sort((a, b) => b.designatorRatio - a.designatorRatio)[0];
  if (desCand && assignedTo("designator") === undefined) {
    // 位号列需要多样性：同一列全是相同的几个值（如 C0402 重复 100 次）不是位号
    const distinct = new Set(rows.slice(0, 60).map((r) => String(r?.[desCand.index] ?? "").trim()).filter(Boolean)).size;
    if (distinct >= 3) setCol(desCand.index, "designator", "DESIGNATOR_BY_CONTENT");
  }

  // ③ 价格列不应被当成参数：内容像价格却映射为 value/mpn 的，改为忽略
  signals.forEach((s) => {
    if (s.samples >= 3 && s.priceRatio >= STRONG && (next[s.index] === "value" || next[s.index] === "mpn")) {
      setCol(s.index, "ignore", "PRICE_NOT_VALUE");
    }
  });

  // ④ 数量列：仅在完全没有数量列时按内容补
  if (assignedTo("quantity") === undefined) {
    const qty = signals
      .filter((s) => s.samples >= 3 && s.qtyRatio >= 0.9 && s.avgLength <= 4)
      .sort((a, b) => b.qtyRatio - a.qtyRatio)[0];
    if (qty) setCol(qty.index, "quantity", "QUANTITY_BY_CONTENT");
  }

  // ⑤ 封装列：仅在没有封装列时按内容补
  if (assignedTo("package") === undefined) {
    const pkg = signals
      .filter((s) => s.samples >= 3 && s.packageRatio >= STRONG)
      .sort((a, b) => b.packageRatio - a.packageRatio)[0];
    if (pkg) setCol(pkg.index, "package", "PACKAGE_BY_CONTENT");
  }

  return { mapping: next, fixes };
}

export const FIX_REASON_TEXT: Record<string, [string, string]> = {
  MPN_BY_CONTENT: ["该列内容为制造商料号", "column contains manufacturer part numbers"],
  INTERNAL_PN_WITH_MPN_PRESENT: ["同时存在型号列，此「料号」按内部编码处理", "a model-number column exists, so this column is treated as an internal part number"],
  MPN_CONTENT_MISMATCH: ["原映射列内容不像料号", "previously mapped column doesn't contain part numbers"],
  DESIGNATOR_BY_CONTENT: ["该列内容为位号", "column contains reference designators"],
  PRICE_NOT_VALUE: ["该列内容为价格，不是元件参数", "column contains prices, not component values"],
  QUANTITY_BY_CONTENT: ["该列内容为数量", "column contains quantities"],
  PACKAGE_BY_CONTENT: ["该列内容为封装", "column contains package codes"],
};

