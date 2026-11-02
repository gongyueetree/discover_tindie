/* ============================================================
   位号解析与展开
   BOM 里位号写法极其多样：R1,R2,R3 / R1 R2 / R1-R10 / R1~R10 /
   C1,C3,C5-C9 / R1;R2。必须展开成单个位号才能做数量校验，
   但**原始字符串必须保留**——导出给客户时要用他们写的形式。
   ============================================================ */

export type ParsedReferences = {
  /** 展开后的单个位号 */
  refs: string[];
  /** 原始字符串，导出时用 */
  original: string;
  /** 展开过程中识别到的区间，如 "R1-R10" */
  expandedRanges: string[];
  /** 无法解析的片段 */
  unparsed: string[];
};

const SEP = /[,，、;；\s]+/;
/** 区间写法：R1-R10 / R1~R10 / R1…R10 */
const RANGE = /^([A-Za-z_]+)(\d+)\s*[-~–—…]\s*([A-Za-z_]*)(\d+)$/;
const SINGLE = /^([A-Za-z_]+)(\d+)([A-Za-z]?)$/;

/** 区间展开上限：防止 R1-R99999 这类脏数据撑爆内存 */
const MAX_RANGE_SPAN = 500;

export function parseReferences(raw: string): ParsedReferences {
  const original = String(raw || "").trim();
  const refs: string[] = [];
  const expandedRanges: string[] = [];
  const unparsed: string[] = [];
  if (!original) return { refs, original, expandedRanges, unparsed };

  for (const token of original.split(SEP).filter(Boolean)) {
    const r = token.match(RANGE);
    if (r) {
      const [, prefix, fromStr, prefix2, toStr] = r;
      // 前缀不一致时（如 R1-C10）不展开，视为无法解析
      if (prefix2 && prefix2.toUpperCase() !== prefix.toUpperCase()) {
        unparsed.push(token);
        continue;
      }
      const from = Number(fromStr), to = Number(toStr);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
        unparsed.push(token);
        continue;
      }
      if (to - from + 1 > MAX_RANGE_SPAN) {
        // 区间过大不展开，保留原样并标记，避免脏数据放大
        unparsed.push(token);
        continue;
      }
      for (let i = from; i <= to; i++) refs.push(`${prefix}${i}`);
      expandedRanges.push(token);
      continue;
    }

    if (SINGLE.test(token)) { refs.push(token); continue; }
    // 非常规位号（如 !PCB700、SH-J700）原样保留，不当成错误
    if (token.length <= 24) refs.push(token);
    else unparsed.push(token);
  }

  // 去重但保持顺序
  const seen = new Set<string>();
  const unique = refs.filter((r) => {
    const k = r.toUpperCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { refs: unique, original, expandedRanges, unparsed };
}

/** 位号数量（用于与 Qty 交叉校验） */
export function referenceCount(raw: string): number {
  return parseReferences(raw).refs.length;
}

/** 把展开后的位号压回紧凑写法，便于导出与展示 */
export function compactReferences(refs: string[]): string {
  if (!refs.length) return "";
  const groups = new Map<string, number[]>();
  const others: string[] = [];

  for (const r of refs) {
    const m = r.match(SINGLE);
    if (!m || m[3]) { others.push(r); continue; }
    const prefix = m[1];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(Number(m[2]));
  }

  const parts: string[] = [];
  for (const [prefix, nums] of groups) {
    nums.sort((a, b) => a - b);
    let start = nums[0], prev = nums[0];
    const emit = () => {
      if (start === prev) parts.push(`${prefix}${start}`);
      else if (prev - start === 1) parts.push(`${prefix}${start}`, `${prefix}${prev}`);
      else parts.push(`${prefix}${start}-${prefix}${prev}`);
    };
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === prev + 1) { prev = nums[i]; continue; }
      emit();
      start = prev = nums[i];
    }
    emit();
  }
  return [...parts, ...others].join(", ");
}

/* ============================================================
   厂商名归一
   "TI" / "Texas Instrument" / "德州仪器" 应视为同一家，
   否则同一颗料会因厂商写法不同而匹配失败或重复统计。
   ============================================================ */

/** 别名 → 规范名。键为归一化后的小写无空格形式 */
const MANUFACTURER_ALIASES: Record<string, string> = {};

function regAlias(canonical: string, aliases: string[]) {
  const key = (s: string) => s.toLowerCase().replace(/[\s.,\-_&]/g, "");
  MANUFACTURER_ALIASES[key(canonical)] = canonical;
  for (const a of aliases) MANUFACTURER_ALIASES[key(a)] = canonical;
}

regAlias("Texas Instruments", ["TI", "Texas Instrument", "德州仪器", "TEXAS INSTRUMENTS INC", "Texas Instruments Incorporated"]);
regAlias("STMicroelectronics", ["ST", "ST Micro", "STMicro", "意法半导体", "ST Microelectronics"]);
regAlias("Analog Devices", ["ADI", "Analog Device", "亚德诺", "Analog Devices Inc", "Linear Technology", "LTC", "Maxim Integrated", "Maxim"]);
regAlias("Microchip Technology", ["Microchip", "微芯", "Atmel", "MICROCHIP TECH"]);
regAlias("NXP Semiconductors", ["NXP", "恩智浦", "Freescale"]);
regAlias("Infineon Technologies", ["Infineon", "英飞凌", "Cypress", "International Rectifier", "IR"]);
regAlias("ON Semiconductor", ["ONSEMI", "on semi", "安森美", "Fairchild"]);
regAlias("Murata", ["Murata Electronics", "MuRata", "村田", "Murata Manufacturing"]);
regAlias("TDK", ["TDK Corporation", "东电化", "EPCOS"]);
regAlias("Samsung Electro-Mechanics", ["Samsung", "SEMCO", "三星电机"]);
regAlias("Yageo", ["国巨", "YAGEO CORPORATION", "Phycomp"]);
regAlias("KEMET", ["基美"]);
regAlias("Vishay", ["Vishay Dale", "Vishay Intertechnology", "威世", "Vishay-Dale"]);
regAlias("Panasonic", ["松下", "Panasonic Electronic Components"]);
regAlias("Nichicon", ["尼吉康"]);
regAlias("Wurth Elektronik", ["Wurth", "Würth", "伍尔特", "WE"]);
regAlias("TE Connectivity", ["TE", "泰科", "Tyco Electronics", "AMP"]);
regAlias("Molex", ["莫仕"]);
regAlias("JST", ["日本压着端子"]);
regAlias("Amphenol", ["安费诺"]);
regAlias("Hirose", ["广濑", "HRS"]);
regAlias("Samtec", []);
regAlias("Littelfuse", ["力特"]);
regAlias("Bourns", ["伯恩斯"]);
regAlias("KOA Speer", ["KOA", "KOA Speer Electronics"]);
regAlias("Rohm", ["ROHM Semiconductor", "罗姆"]);
regAlias("Toshiba", ["东芝"]);
regAlias("Renesas", ["瑞萨", "Intersil", "IDT"]);
regAlias("Nexperia", ["安世"]);
regAlias("Diodes Incorporated", ["Diodes Inc", "Diodes", "达尔"]);
regAlias("Skyworks", ["天钺"]);
regAlias("Qualcomm", ["高通"]);
regAlias("Espressif Systems", ["Espressif", "乐鑫", "ESP"]);
regAlias("WCH", ["南京沁恒", "沁恒", "Nanjing Qinheng", "Jiangsu Qinheng"]);
regAlias("GigaDevice", ["兆易创新", "GD"]);
regAlias("Allwinner", ["全志"]);
regAlias("Rockchip", ["瑞芯微"]);
regAlias("Lattice Semiconductor", ["Lattice", "莱迪思"]);
regAlias("Xilinx", ["赛灵思", "AMD Xilinx"]);
regAlias("Abracon", []);
regAlias("Epson", ["爱普生", "Seiko Epson"]);
regAlias("NDK", ["日本电波"]);
regAlias("Taiyo Yuden", ["太阳诱电"]);
regAlias("AVX", ["KYOCERA AVX", "Kyocera"]);
regAlias("Sullins", ["Sullins Connector Solutions"]);
regAlias("Keystone", ["Keystone Electronics"]);
regAlias("Harwin", []);
regAlias("Cyntec", ["乾坤", "CYNTEC"]);
regAlias("Stackpole Electronics", ["Stackpole", "Stackpole Electronics Inc"]);
regAlias("Susumu", []);
regAlias("Panduit", []);
regAlias("B&F Fastener Supply", ["B&F Fastener"]);

/* ---------- 官网域名 → 规范厂商名 ----------
   域名具有唯一性，比名称字符串匹配可靠。收录常见厂商；
   未收录的返回 undefined，交给别名表处理。 */
const MANUFACTURER_DOMAINS: Record<string, string> = {
  "ti.com": "Texas Instruments", "st.com": "STMicroelectronics", "analog.com": "Analog Devices",
  "maximintegrated.com": "Analog Devices", "linear.com": "Analog Devices",
  "microchip.com": "Microchip Technology", "nxp.com": "NXP Semiconductors",
  "infineon.com": "Infineon Technologies", "onsemi.com": "ON Semiconductor",
  "murata.com": "Murata", "tdk.com": "TDK", "samsungsem.com": "Samsung Electro-Mechanics",
  "yageo.com": "Yageo", "kemet.com": "KEMET", "vishay.com": "Vishay",
  "panasonic.com": "Panasonic", "industrial.panasonic.com": "Panasonic", "nichicon.co.jp": "Nichicon",
  "we-online.com": "Wurth Elektronik", "te.com": "TE Connectivity", "molex.com": "Molex",
  "jst.com": "JST", "amphenol.com": "Amphenol", "hirose.com": "Hirose", "samtec.com": "Samtec",
  "littelfuse.com": "Littelfuse", "bourns.com": "Bourns", "koaspeer.com": "KOA Speer",
  "rohm.com": "Rohm", "toshiba.semicon-storage.com": "Toshiba", "renesas.com": "Renesas",
  "nexperia.com": "Nexperia", "diodes.com": "Diodes Incorporated", "skyworksinc.com": "Skyworks",
  "espressif.com": "Espressif Systems", "wch.cn": "WCH", "wch-ic.com": "WCH",
  "gigadevice.com": "GigaDevice", "latticesemi.com": "Lattice Semiconductor", "xilinx.com": "Xilinx",
  "abracon.com": "Abracon", "epson.com": "Epson", "ndk.com": "NDK", "yuden.co.jp": "Taiyo Yuden",
  "kyocera-avx.com": "AVX", "avx.com": "AVX", "sullinscorp.com": "Sullins", "keyelco.com": "Keystone",
  "harwin.com": "Harwin", "cyntec.com": "Cyntec", "seielect.com": "Stackpole Electronics", "susumu.co.jp": "Susumu",
};

/** 由官网 URL 反查规范厂商名。取主域名（去 www 与子域）逐级匹配。 */
export function manufacturerByDomain(url?: string): string | undefined {
  if (!url) return undefined;
  let host = "";
  try { host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase(); }
  catch { return undefined; }
  host = host.replace(/^www\./, "");
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const cand = parts.slice(i).join(".");
    if (MANUFACTURER_DOMAINS[cand]) return MANUFACTURER_DOMAINS[cand];
  }
  return undefined;
}

export type ManufacturerResult = {
  raw: string;
  normalized: string;
  /** 是否命中别名表；未命中时 normalized 为规范化大小写后的原值 */
  matched: boolean;
};

/** 归一厂商名。未收录的厂商不臆造，只做基本清洗。 */
export function normalizeManufacturer(raw?: string): ManufacturerResult {
  const original = String(raw || "").trim();
  if (!original) return { raw: "", normalized: "", matched: false };

  // 去掉常见公司后缀再匹配，提高命中率
  const stripped = original
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|gmbh|llc|plc|s\.?a\.?|pte|holdings?)\b\.?/gi, "")
    .trim();

  const key = (s: string) => s.toLowerCase().replace(/[\s.,\-_&]/g, "");
  const hit = MANUFACTURER_ALIASES[key(original)] || MANUFACTURER_ALIASES[key(stripped)];
  if (hit) return { raw: original, normalized: hit, matched: true };

  // 未收录：保留原值，只压缩空白，不做猜测
  return { raw: original, normalized: stripped.replace(/\s+/g, " ") || original, matched: false };
}

/** 两个厂商名是否指同一家 */
export function sameManufacturer(a?: string, b?: string): boolean {
  const na = normalizeManufacturer(a).normalized.toLowerCase();
  const nb = normalizeManufacturer(b).normalized.toLowerCase();
  return !!na && na === nb;
}

export function knownManufacturerCount(): number {
  return new Set(Object.values(MANUFACTURER_ALIASES)).size;
}

