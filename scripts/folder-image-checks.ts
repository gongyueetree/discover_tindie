/** A board kept in a folder of a larger repository gets a picture named after its folder. */
import assert from "node:assert/strict";
import { githubFolderImage } from "../src/lib/maker/github-server";

const tree = [
  { path: "docs/images/operacake-block-diagram.png", type: "blob", size: 50000 },
  { path: "docs/images/operacake.jpeg", type: "blob", size: 90000 },
  { path: "docs/images/HackRF-One-fd0-0009.jpeg", type: "blob", size: 90000 },
  { path: "hardware/operacake/operacake.kicad_pcb", type: "blob", size: 900000 },
];
let calls = 0;
globalThis.fetch = (async () => {
  calls++;
  return Response.json({ tree });
}) as typeof fetch;
void (async () => {
  assert.equal(
    await githubFolderImage("greatscottgadgets/hackrf", "abc123", "hardware/operacake"),
    "https://raw.githubusercontent.com/greatscottgadgets/hackrf/abc123/docs/images/operacake.jpeg",
  );
  assert.equal(await githubFolderImage("greatscottgadgets/hackrf", "abc123", "hardware/jawbreaker"), null, "nothing named for it");
  assert.equal(calls, 2);
  await githubFolderImage("greatscottgadgets/hackrf", "abc123", "hardware/operacake");
  assert.equal(calls, 2, "cached");
  assert.equal(await githubFolderImage("o/r", null, "hw"), null, "folder names under 4 characters are too vague");
  console.log("folder image checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
