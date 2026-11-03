/** Family rule (same as partdata's KG) and KiCad symbol matching by part number. Offline. */
import assert from "node:assert/strict";
import { familyOf } from "../src/lib/partdata/maker";
import { symbolForMpn } from "../src/lib/partdata/kicad-lib";
import { insideBoard, fitBoard } from "../src/lib/maker/planner-rules";
import { createBoard } from "../src/vendor/protopcb/design-core/document/factory";

// partdata ezplm_pilot/kg.py family_of
assert.equal(familyOf("STM32F103CBT6"), "STM32F103");
assert.equal(familyOf("STM32F103C8T6"), "STM32F103", "variants of one line share a family");
assert.equal(familyOf("LM358DR"), "LM358");
assert.equal(familyOf("SN74HC595N"), "74HC595", "74-series logic drops the vendor prefix");
assert.equal(familyOf("ESP32-S3-WROOM-1"), "ESP32S3");
assert.notEqual(familyOf("STM32F103C8T6_BLUE_PILL"), "STM32F103", "a board name is not the chip's family");

// KiCad's lowercase-x wildcard names; exact names; nothing guessed beyond that
assert.deepEqual(symbolForMpn("STM32F103CBT6"), { library: "MCU_ST_STM32F1", name: "STM32F103CBTx" });
assert.deepEqual(symbolForMpn("STM32F103CBT6TR"), { library: "MCU_ST_STM32F1", name: "STM32F103CBTx" }, "packing suffix");
assert.deepEqual(symbolForMpn("NE555P"), { library: "Timer", name: "NE555P" });
assert.equal(symbolForMpn("LM358DR"), null, "no symbol borrowed across package suffixes");
assert.equal(symbolForMpn("XYZ123"), null);

// Planner: parts must sit inside the real outline
const rounded = fitBoard({ ...createBoard(80, 60), shape: "rounded", cornerRadiusMm: 10, mountingHolesEnabled: true, holeMarginMm: 6, holeDiameterMm: 4 });
assert.equal(rounded.mountingHoles.length, 4);
assert.deepEqual(rounded.mountingHoles[0], { position: { x: 6, y: 6 }, diameterMm: 4 });
assert.equal(insideBoard({ x: 1, y: 1, width: 4, height: 4 }, rounded), false, "not in a rounded corner");
assert.equal(insideBoard({ x: 30, y: 20, width: 10, height: 10 }, rounded), true);
const l = { ...createBoard(80, 60), shape: "lshape" as const };
assert.equal(insideBoard({ x: 70, y: 50, width: 4, height: 4 }, l), false, "not in the L's cut-out");
const circle = fitBoard({ ...createBoard(60, 60), shape: "circle", mountingHolesEnabled: true });
assert.equal(circle.mountingHoles.length, 0, "no corner holes on a circle");
assert.equal(insideBoard({ x: 2, y: 2, width: 5, height: 5 }, circle), false);
console.log("PASS: family rule, KiCad symbol by part number, planner outline containment and fitted holes");
