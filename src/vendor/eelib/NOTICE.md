# eelib schematic drawing source

`kicad-schematic.ts` is adapted from the user-provided repository `gongyueetree/eelib`, path `eelib-bff/src/refir/kicad-schematic.ts`. Its parser/geometry imports point to the local canon adapters. It produces source schematic drawing primitives without AI calls. Existing upstream attribution is retained. This notice does not grant additional rights to upstream code.

`../kicad-legacy.ts`: eelib-bff/src/refir/kicad-legacy.ts @ 77ddf590 — KiCad 5 `.sch` + `-cache.lib` →
KiCad 6+ `.kicad_sch` (KiCad's own conversion), so legacy projects draw with the same schematic engine.
`node:crypto` replaced by `@noble/hashes` for browser use.

`../canon/lib/{eda,bom,knowledge,design-assets}`: replaced by eelib-bff/src/refir/core @ 77ddf590 (parser canon-eda-ir 1.7.2);
`knowledge/pdf.ts` stubbed (no pdf.js). `../canon/lib/models` keeps the browser 3D code, plus eelib files it lacked.
`view.ts`, `altium-schematic.ts`, `altium-page.ts`, `eagle-schematic.ts`, `kicad-schematic.ts` (+ Tindie `netPins`): eelib-bff/src/refir @ 77ddf590.

`../canon/lib/eda/kicad-legacy-board.ts` (local addition): KiCad legacy `.brd` ("PCBNEW-BOARD Version 1/2") → `.kicad_pcb`, following KiCad's legacy_plugin.cpp, so pre-2013 KiCad boards are read by the same board parser.
Also local: `.kicad_pcb` renamed copper layers (KiCad 3–5) mapped to KiCad's names (`kicad.ts`); Fusion Electronics `.fsch`/`.fbrd`/`.f3z` unpacked to their EAGLE XML (`archive.ts`) and Fusion `<spline>` outlines (`eagle.ts`); board outlines that overshoot, repeat a stroke or carry a stray one still form the 3D board (`models/board-mesh.ts`).
