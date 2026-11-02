import { makeComponent } from "../src/lib/maker/planner";
import { findOverlaps } from "../src/vendor/protopcb/design-core/collision";
import { csvCell } from "../src/lib/maker/download";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filesToInputAssets } from "../src/vendor/canon/lib/eda/archive";
import { parseEdaProject } from "../src/vendor/canon/lib/eda/parse";
import {
  readCsv,
  normalizeTable,
  autoMapColumn,
  matchRow,
  priceOffer,
  estimate,
} from "../src/lib/maker/bom";
import {
  createDocument,
  createBoard,
  deserializeDocument,
} from "../src/vendor/protopcb/design-core/document/factory";
import { buildKicadPcb } from "../src/vendor/protopcb/modules/board-editor/pcbExport";
import type { Part, BomRow, Offer } from "../src/lib/maker/types";
async function main() {
  for (const name of ["kicad-demo", "eagle-led"]) {
    const { assets, diagnostics } = await filesToInputAssets([
      new File([readFileSync(`public/examples/${name}.zip`)], name + ".zip"),
    ]);
    const b = await parseEdaProject(assets, diagnostics);
    assert.equal(b.schematics.length, 1);
    assert.equal(b.pcbs.length, 1);
    assert.equal(b.parts.length, 2);
    assert.ok(b.pcbs[0].pads.length >= 4);
    assert.ok(b.pcbs[0].boardOutline.length > 0);
    assert.ok(b.schematics[0].wires.length > 0);
    assert.ok(b.nets.some((n) => n.endpoints.length >= 2));
    console.log(
      name,
      b.project.sourceFormat,
      b.parts.map((p) => p.reference),
      b.pcbs[0].tracks.length + " tracks",
    );
  }
  const csv = readCsv(
    "Reference,Quantity,Value,MPN,Manufacturer,Package\nU1,2,DAC,AD9102BCPZ,Analog Devices,LFCSP-32\nR1 R2,2,10k,,,0603",
  );
  const rows = normalizeTable(
    csv.headers,
    csv.rows,
    csv.headers.map(autoMapColumn),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].mpn, "AD9102BCPZ");
  assert.equal(rows[0].quantity, 2);
  const offer: Offer = {
    supplier: "test",
    sku: "test",
    currency: "USD",
    stock: 100,
    moq: 10,
    multiple: 5,
    breaks: [
      { quantity: 1, price: 3 },
      { quantity: 10, price: 2 },
    ],
    retrievedAt: "2026-01-01",
  };
  assert.deepEqual(priceOffer(offer, 11)?.quantity, 15);
  assert.equal(priceOffer(offer, 11)?.total, 30);
  const p: Part = {
    id: "p",
    mpn: "AD9102BCPZ",
    manufacturer: "Analog Devices",
    description: "",
    source: "test",
    cad: [],
    parameters: {},
    offers: [offer],
    package: "LFCSP-32",
  };
  assert.equal(matchRow(rows[0], [p]).status, "exact");
  assert.equal(
    matchRow(rows[0], [{ ...p, mpn: "AD9102BCPZRL7" }]).status,
    "review",
  );
  assert.equal(matchRow(rows[1], [p]).status, "review");
  assert.equal(
    estimate(
      [{ ...rows[0], selected: { ...p, offers: [] }, status: "exact" }],
      1,
    ).unpriced,
    1,
  );
  assert.equal(
    estimate(
      [
        {
          ...rows[0],
          selected: { ...p, offers: [{ ...offer, stock: null }] },
          status: "exact",
        },
      ],
      1,
    ).priced,
    0,
  );
  const doc = createDocument({ board: createBoard(80, 60) });
  assert.equal(deserializeDocument(JSON.stringify(doc)).board.widthMm, 80);
  doc.components = [
    makeComponent("SOIC-8", "U1", 20, 20),
    makeComponent("R_0603_1608Metric", "R1", 20, 20),
  ];
  assert.equal(findOverlaps(doc.components).size, 2);
  doc.components[1].placement = {
    xMm: 40,
    yMm: 30,
    rotation: 90,
    side: "BOTTOM",
    locked: false,
  };
  assert.equal(findOverlaps(doc.components).size, 0);
  assert.ok(csvCell('=HYPERLINK("x")').startsWith("\"'"));
  const pcb = buildKicadPcb(doc);
  const { assets, diagnostics } = await filesToInputAssets([
    new File([pcb], "layout.kicad_pcb"),
  ]);
  const b = await parseEdaProject(assets, diagnostics);
  assert.equal(b.pcbs.length, 1);
  assert.equal(b.pcbs[0].footprints.length, 2);
  assert.equal(b.pcbs[0].pads.length, 10);
  assert.equal(
    b.pcbs[0].footprints.find((p) => p.reference === "R1")?.side,
    "back",
  );
  assert.equal(Number(b.pcbs[0].physicalDimensions?.width), 80);
  console.log(
    "BOM exact identity, ambiguous match, missing prices, MOQ tiers, and KiCad export checks passed",
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
