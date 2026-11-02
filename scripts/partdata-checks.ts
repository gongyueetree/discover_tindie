/**
 * Offline checks for the partdata (ezplm_partdata Partner API) integration.
 *   npm run test:partdata
 *
 * The signing fixtures were produced by partdata's own Python verifier
 * (ezplm_pilot.pub_api.sign / canonical_query), so a pass means this site's requests
 * are byte-for-byte what the platform expects.
 */
import assert from "node:assert/strict";
import { canonicalQuery, signature } from "@/lib/partdata/client";
import { resolveName } from "@/lib/partdata/kicad-lib";
import { categoryEn, manufacturerCanonical, manufacturerEn, lifecycleEn } from "@/lib/partdata/glossary";
import { toPart, githubSource } from "@/lib/partdata/maker";

const SECRET = "s3cr3t-xyz",
  TS = "1793600000",
  NONCE = "abcdef123456";
const FIXTURES = [
  {
    method: "GET",
    path: "/api/pub/v1/parts/lookup",
    query: { mpn: "MAX485ECSA+", manufacturer: "Analog Devices Inc." },
    body: "",
    qs: "manufacturer=Analog%20Devices%20Inc.&mpn=MAX485ECSA%2B",
    sig: "6MrLC0wvY9q-k0NUeJSN4v-kOoCmTPyxLA89VqFKva8",
  },
  {
    method: "GET",
    path: "/api/pub/v1/parts/search",
    query: { q: "10k 0603 *'()!~", limit: "20", offset: "0", empty: "" },
    body: "",
    qs: "limit=20&offset=0&q=10k%200603%20*'()!~",
    sig: "9eEh7ZHDCr4B074HQLhQA0AE1FGUlgaMDJmLRqAtJ3A",
  },
  {
    method: "GET",
    path: "/api/kg/v1/rankings/families",
    query: { q: "意法 ST/32", kind: "ic", limit: "200" },
    body: "",
    qs: "kind=ic&limit=200&q=%E6%84%8F%E6%B3%95%20ST%2F32",
    sig: "2B7wPz8BBwjtDLyBoDtdYvwIUSEXvONwauVxTIXtYZ0",
  },
  {
    method: "POST",
    path: "/api/pub/v1/bom/match",
    query: {},
    body: '{"lines":[{"ref":"U1","mpn":"STM32F103C8T6","manufacturer":"STMicroelectronics"}]}',
    qs: "",
    sig: "7ExLCTgp_6rnuw23ya9Pkq7Uoyd33LLDesfLPtsuMsA",
  },
];

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("ok", name);
};

ok("canonical query + HMAC signature match partdata's Python verifier", () => {
  for (const f of FIXTURES) {
    const qs = canonicalQuery(f.query);
    assert.equal(qs, f.qs, f.path);
    assert.equal(signature(SECRET, f.method, f.path, qs, TS, NONCE, f.body), f.sig, f.path);
  }
});

ok("KiCad name resolution (bare, Lib:Name, case-insensitive, unknown, unsafe)", () => {
  assert.deepEqual(resolveName("symbol", "STM32H503KBUx"), { library: "MCU_ST_STM32H5", name: "STM32H503KBUx" });
  assert.deepEqual(resolveName("footprint", "QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm"), {
    library: "Package_DFN_QFN",
    name: "QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm",
  });
  assert.deepEqual(resolveName("symbol", "Device:R"), { library: "Device", name: "R" });
  assert.equal(resolveName("footprint", "soic-8_3.9x4.9mm_p1.27mm")?.name, "SOIC-8_3.9x4.9mm_P1.27mm");
  assert.equal(resolveName("symbol", "NOT_A_REAL_SYMBOL_123"), null);
  assert.equal(resolveName("footprint", "../../etc/passwd"), null);
  assert.equal(resolveName("symbol", ""), null);
});

ok("display glossary: categories, manufacturers, lifecycle", () => {
  assert.equal(categoryEn("微控制器（MCU）"), "Microcontrollers (MCU)");
  assert.equal(categoryEn("整流器 > 二极管阵列"), "Rectifiers › Diode arrays");
  assert.equal(categoryEn("Unknown"), "Unknown");
  assert.equal(manufacturerEn("意法半导体"), "STMicroelectronics");
  assert.equal(manufacturerEn("南京沁恒微电子股份有限公司"), "WCH");
  assert.equal(manufacturerEn("Texas Instruments"), "Texas Instruments");
  assert.equal(manufacturerCanonical("ST"), "STMicroelectronics");
  assert.equal(manufacturerCanonical("TI"), "Texas Instruments");
  assert.equal(manufacturerCanonical("Some Small Vendor"), "Some Small Vendor");
  assert.equal(lifecycleEn("量产"), "Active");
});

ok("public part → UI part (field sources, withheld, English)", () => {
  const p = toPart({
    id: "p_abcdefghij",
    mpn: "STM32F103C8T6",
    manufacturer: "意法半导体",
    category: "微控制器（MCU）",
    description_en: "Arm Cortex-M3 MCU",
    lifecycle: "量产",
    symbol: { value: "STM32F103C8Tx", source: "ezplm" },
    footprint: null,
    parameters: { Flash: { value: "64 KB", source: "distributor" } },
    datasheet_url: "https://www.st.com/resource/en/datasheet/stm32f103c8.pdf",
    product_url: "javascript:alert(1)",
    used_in_designs: 3,
    withheld: ["footprint"],
  });
  assert.equal(p.manufacturer, "STMicroelectronics");
  assert.equal(p.category, "Microcontrollers (MCU)");
  assert.equal(p.lifecycle, "Active");
  assert.equal(p.symbolName, "STM32F103C8Tx");
  assert.equal(p.footprintName, null);
  assert.deepEqual(p.withheld, ["footprint"]);
  assert.equal(p.fieldSources?.Flash, "distributor");
  assert.equal(p.productUrl, undefined, "non-http links are dropped");
  assert.equal(p.detailed, true);
});

ok("pinned GitHub source URLs", () => {
  assert.deepEqual(githubSource("https://github.com/acme/rs485/tree/abc1234/hw/main"), {
    repo: "acme/rs485",
    commit: "abc1234",
    subdir: "hw/main",
  });
  assert.deepEqual(githubSource("https://github.com/acme/rs485"), { repo: "acme/rs485", commit: null, subdir: "" });
  assert.equal(githubSource("https://www.ti.com/tool/X"), null);
});

console.log(`\n${n} partdata integration checks passed`);
