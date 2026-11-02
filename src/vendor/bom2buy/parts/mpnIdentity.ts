/* ============================================================
   MPN 身份判定（全系统唯一实现）
   ------------------------------------------------------------
   EXACT 只允许两种差异：前后空白、大小写。
   其余一律不是"同一颗料"：

     AB-12        vs AB12          → SIMILAR（分隔符不同，可能是不同料）
     MAX3232ESE+  vs MAX3232ESE    → SIMILAR（+ 常表示无铅/RoHS 版本）
     TPS7A20PDBVR vs TPS7A20PDBV   → SIMILAR（R 是卷带包装后缀）

   为什么这么严：过去用 replace(/[\s\-_]/g,"") 判等，
   结果比价单与 BOM Matrix 会把两种不同料合成一行下单。
   SIMILAR 不是错误——它表示"很可能相关，但必须人看一眼"。
   ============================================================ */

export type MpnRelationship = "EXACT" | "SIMILAR" | "PARAMETRIC" | "OTHER";

/** 仅做 trim + 大写。用作 Map 键时，保证不同料不会被合并。 */
export function mpnKey(s: unknown): string {
  return String(s ?? "").trim().toUpperCase();
}

export function exactMpn(a: unknown, b: unknown): boolean {
  const x = mpnKey(a), y = mpnKey(b);
  return !!x && x === y;
}

/** 去掉分隔符后的形态。只用于判断 SIMILAR，绝不用于判等或做合并键。 */
function loose(s: unknown): string {
  return mpnKey(s).replace(/[\s\-_./]/g, "");
}

/** 常见的订货/包装/环保后缀：差异只在这些尾巴时，视为同系列不同订货号 */
const ORDERING_SUFFIX = /^(?:[+#]|R|T|TR|\/TR|-TR|REEL|-REEL|R7|R13|RL|RL7|-RL7|PBF|#PBF|G4|E4|ND|-ND|CT|TA|\/NOPB|NOPB)$/;

export function similarMpn(a: unknown, b: unknown): boolean {
  const x = mpnKey(a), y = mpnKey(b);
  if (!x || !y || x === y) return false;
  // ① 只差分隔符
  if (loose(x) === loose(y)) return true;
  // ② 一个是另一个的前缀，且多出的部分是订货/包装后缀或很短
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 5 && long.startsWith(short)) {
    const tail = long.slice(short.length);
    if (tail.length <= 4 || ORDERING_SUFFIX.test(tail)) return true;
  }
  const [ls, ll] = loose(x).length <= loose(y).length ? [loose(x), loose(y)] : [loose(y), loose(x)];
  if (ls.length >= 5 && ll.startsWith(ls) && ll.length - ls.length <= 4) return true;
  return false;
}

/**
 * 候选与原始料号的关系。
 * PARAMETRIC 不由料号决定——只有调用方确认参数匹配时才给出。
 */
export function candidateRelationship(
  original: unknown, candidate: unknown, opts: { parametricMatch?: boolean } = {},
): MpnRelationship {
  if (exactMpn(original, candidate)) return "EXACT";
  if (similarMpn(original, candidate)) return "SIMILAR";
  if (opts.parametricMatch) return "PARAMETRIC";
  return "OTHER";
}

/** 从一组报价里挑出与目标料号 EXACT 的 */
export function filterExact<T extends { mpn?: string }>(items: T[], mpn: unknown): T[] {
  return items.filter((o) => exactMpn(o.mpn, mpn));
}
export function filterSimilar<T extends { mpn?: string }>(items: T[], mpn: unknown): T[] {
  return items.filter((o) => similarMpn(o.mpn, mpn));
}

