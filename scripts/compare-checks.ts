/** Alternate comparison (src/lib/maker/compare.ts): eelib semantics, metrics, grade and pin gate. */
import assert from "node:assert/strict";
import { compareParts, compareParam, canonical, type ComparePart } from "../src/lib/maker/compare";

const P = (mpn: string, pkg: string, params: Record<string, string>, source = "distributor"): ComparePart => ({
  id: mpn, mpn, manufacturer: "Acme", package: pkg,
  parameters: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { value: v, source }])),
});

// canonical keys from DigiKey / Mouser names, never display names
assert.equal(canonical("Voltage - Supply (Vcc/Vdd)")?.key, "vsupply");
assert.equal(canonical("Program Memory Size")?.key, "flash");
assert.equal(canonical("Operating Temperature")?.key, "temp");
assert.equal(canonical("Colour of the box"), null);

// semantics
const rule = (name: string) => canonical(name)!;
assert.equal(compareParam(rule("Program Memory Size"), "64KB (64K x 8)", "128KB (128K x 8)").code, "BETTER_THAN_ORIGINAL");
assert.equal(compareParam(rule("Program Memory Size"), "128KB", "64KB").code, "WORSE_UNACCEPTABLE", "memory: tolerance 0");
assert.equal(compareParam(rule("Speed"), "72MHz", "64MHz").code, "WORSE_AT_TOLERANCE_EDGE");
assert.equal(compareParam(rule("Voltage - Supply (Vcc/Vdd)"), "2V ~ 3.6V", "1.8V ~ 3.6V").code, "RANGE_FULLY_COVERED");
assert.equal(compareParam(rule("Voltage - Supply (Vcc/Vdd)"), "1.8V ~ 5.5V", "2V ~ 3.6V").code, "RANGE_INSUFFICIENT");
assert.equal(compareParam(rule("Operating Temperature"), "-40°C ~ 85°C (TA)", "-40°C ~ 105°C (TA)").code, "RANGE_FULLY_COVERED");
assert.equal(compareParam(rule("Speed"), "72MHz", "fast").code, "NOT_COMPARABLE", "text is not forced into a number");
assert.equal(compareParam(rule("Speed"), "72MHz", "5V").code, "NOT_COMPARABLE", "different dimensions");
assert.equal(compareParam(rule("Package / Case"), "SOIC-8", "SOP-8").code, "COMPATIBLE_FAMILY");
assert.deepEqual(compareParam(rule("Package / Case"), "LQFP-48", "QFN-56"), { code: "INCOMPATIBLE", score: 10, critical: true });
assert.equal(compareParam(rule("Speed"), "72MHz", undefined).score, null, "missing = unknown, not zero");

// whole parts: the same part family, one size up
const f103c8 = P("STM32F103C8T6", "LQFP-48", { "Core Processor": "ARM Cortex-M3", "Program Memory Size": "64KB", "RAM Size": "20K x 8", Speed: "72MHz", "Voltage - Supply (Vcc/Vdd)": "2V ~ 3.6V", "Operating Temperature": "-40°C ~ 85°C" });
const f103cb = P("STM32F103CBT6", "LQFP-48", { "Core Processor": "ARM Cortex-M3", "Program Memory Size": "128KB", "RAM Size": "20K x 8", Speed: "72MHz", "Voltage - Supply (Vcc/Vdd)": "2V ~ 3.6V", "Operating Temperature": "-40°C ~ 85°C" });
const qfn = P("RP2040", "QFN-56", { "Core Processor": "ARM Cortex-M0+", "Program Memory Size": "0B", Speed: "133MHz" });
const thin = P("THIN1", "LQFP-48", {});
const c = compareParts(f103c8, [f103cb, qfn, thin]);
assert.equal(c.columns.length, 4);
const [, cb, rp, th] = c.verdicts;
assert.equal(cb!.scores.technical, 100);
assert.equal(cb!.grade, "B", "pin gate: no verified datasheet pinout → never A");
assert.equal(cb!.pins, "not_verified");
assert.ok(cb!.check[0].startsWith("Pinout"));
assert.ok(rp!.status === "NOT_RECOMMENDED" || rp!.reason === "CRITICAL_IDENTITY_MISMATCH", "different package / core is not the same kind of part");
assert.ok(rp!.scores.confidence <= 55, "critical mismatch caps confidence at 55");
assert.equal(th!.status, "NEEDS_VERIFICATION", "too little published to judge");
assert.equal(th!.grade, null, "no grade while it needs verification");
const flashRow = c.rows.find((r) => r.key === "flash")!;
assert.equal(flashRow.best, 1, "best cell: the larger flash");
assert.equal(flashRow.values[1].code, "BETTER_THAN_ORIGINAL");
console.log("PASS: canonical keys, eelib comparison semantics, separate metrics, pin evidence gate, best-cell marking");
