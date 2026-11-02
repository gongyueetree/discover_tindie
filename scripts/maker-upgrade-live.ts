import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { scanGithub, importGithub } from "../src/lib/maker/github-server";
import { filesToInputAssets } from "../src/vendor/canon/lib/eda/archive";
import { parseEdaProject } from "../src/vendor/canon/lib/eda/parse";
import { search } from "../src/lib/maker/server";
import { GET } from "../src/app/api/maker/[...path]/route";
import { NextRequest } from "next/server";
async function main() {
  const scan = await scanGithub(
    "https://github.com/adafruit/Adafruit_ADXL343_PCB",
  );
  assert.ok(scan.projects.length);
  const zip = await importGithub(scan.token, scan.projects[0].id);
  if (process.env.MAKER_QA_ARCHIVE)
    writeFileSync(process.env.MAKER_QA_ARCHIVE, zip.bytes);
  const assets = await filesToInputAssets([
    new File([zip.bytes], "github.zip"),
  ]);
  assert.ok(!assets.assets.some((f) => /\.(png|jpg)$/i.test(f.path)));
  const bundle = await parseEdaProject(assets.assets, assets.diagnostics);
  assert.ok(bundle.pcbs.length);
  console.log(
    "GitHub snapshot",
    scan.commit.slice(0, 10),
    "projects",
    scan.projects.length,
    "selected files",
    assets.assets.length,
    "board components",
    bundle.pcbs[0].footprints.length,
  );
  const parts = await search(
    "STM32G031C4U6",
    "00000000-0000-0000-0000-000000000001",
  );
  assert.ok(parts.items.length);
  assert.equal(parts.items[0].translation?.status, "complete");
  console.log(
    "English translation",
    parts.items[0].translation,
    parts.items[0].description,
    parts.items[0].parameters,
  );
  for (const path of [
    ["cad", "STM32G031C4U6"],
    ["cad", "STM32G031C4U6", "model"],
  ]) {
    const r = await GET(
      new NextRequest("http://localhost/api/maker/" + path.join("/")),
      { params: { path } },
    );
    if (path.length === 2) {
      const d = await r.json();
      assert.equal(r.status, 200);
      assert.ok(d.symbol.preview.pins.length);
      assert.ok(d.footprint.preview.pads.length);
      console.log(
        "Live CAD pins/pads",
        d.symbol.preview.pins.length,
        d.footprint.preview.pads.length,
      );
    } else {
      if (r.status !== 200) console.log(await r.text());
      assert.equal(r.status, 200);
      console.log("Live STEP model bytes", (await r.arrayBuffer()).byteLength);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
