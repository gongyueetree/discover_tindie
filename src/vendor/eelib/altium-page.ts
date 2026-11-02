import * as CFB from "cfb";

import { altiumBlocks, altiumProperties } from "@/vendor/canon/lib/eda/altium-records";

/**
 * An Altium schematic's page — its sheet size, border margin and reference
 * zones — from the sheet record (RECORD=31) of the SchDoc. The IR keeps a
 * sheet's contents, not its page, so the viewer would otherwise draw an Altium
 * sheet with no border.
 *
 * Sizes are Altium's own (in its 10-mil units), not ISO paper sizes: its A4 is
 * 11.5 × 7.6 in. A custom sheet uses CUSTOMX/CUSTOMY only when USECUSTOMSHEET
 * is set; otherwise those fields hold defaults and mean nothing.
 *
 * Coordinates match the IR's for Altium: millimetres, x right, y down, with
 * the sheet's bottom-left corner at (0, 0) — so the page spans y = −height…0.
 */
export type AltiumPage = { width: number; height: number; margin: number; border: boolean; zones: [number, number] | null; size: string };

/** Altium's standard sheets by SHEETSTYLE, in 10-mil units, with its reference zones (columns × rows). */
const SHEETS: [string, number, number, number, number][] = [
  ["A4", 1150, 760, 4, 4],
  ["A3", 1550, 1110, 6, 4],
  ["A2", 2230, 1560, 8, 6],
  ["A1", 3150, 2230, 12, 8],
  ["A0", 4460, 3150, 16, 12],
  ["A", 950, 750, 4, 4],
  ["B", 1500, 950, 6, 4],
  ["C", 2000, 1500, 8, 6],
  ["D", 3200, 2000, 12, 8],
  ["E", 4200, 3200, 16, 12],
  ["Letter", 1100, 850, 4, 4],
  ["Legal", 1400, 850, 4, 4],
  ["Tabloid", 1700, 1100, 6, 4],
  ["OrCAD A", 990, 790, 4, 4],
  ["OrCAD B", 1540, 990, 6, 4],
  ["OrCAD C", 2060, 1560, 8, 6],
  ["OrCAD D", 3260, 2060, 12, 8],
  ["OrCAD E", 4280, 3280, 16, 12],
];
const MM = 0.254;

const yes = (value: string | undefined) => value === "T" || value === "TRUE";

export function altiumPage(bytes: Uint8Array): AltiumPage | null {
  const container = CFB.read(bytes, { type: "array" });
  const index = container.FullPaths.findIndex((path) => path.toLowerCase().endsWith("/fileheader"));
  if (index < 0) return null;
  const header = new Uint8Array(container.FileIndex[index]!.content as Uint8Array);
  const sheet = altiumBlocks(header)
    .map((block: Uint8Array) => altiumProperties(block) as Record<string, string>)
    .find((props: Record<string, string>) => props.RECORD === "31");
  if (!sheet) return null;
  const margin = Number(sheet.CUSTOMMARGINWIDTH ?? sheet.SHEETMARGINWIDTH ?? 20) * MM;
  let width: number;
  let height: number;
  let zones: [number, number] | null;
  let size: string;
  if (yes(sheet.USECUSTOMSHEET)) {
    width = Number(sheet.CUSTOMX ?? 1500) * MM;
    height = Number(sheet.CUSTOMY ?? 950) * MM;
    zones = [Number(sheet.CUSTOMXZONES ?? 6), Number(sheet.CUSTOMYZONES ?? 4)];
    size = "Custom";
  } else {
    const standard = SHEETS[Number(sheet.SHEETSTYLE ?? 0)] ?? SHEETS[0]!;
    [size, width, height] = [standard[0], standard[1] * MM, standard[2] * MM];
    zones = [standard[3], standard[4]];
  }
  // WORKSPACEORIENTATION 1 is portrait: the long side runs up the page.
  if (sheet.WORKSPACEORIENTATION === "1") [width, height, zones] = [height, width, zones ? [zones[1], zones[0]] : null];
  return {
    width: Math.round(width * 1000) / 1000,
    height: Math.round(height * 1000) / 1000,
    margin: Math.round(margin * 1000) / 1000,
    border: sheet.BORDERON === undefined ? true : yes(sheet.BORDERON),
    zones: sheet.REFERENCEZONESON === undefined || yes(sheet.REFERENCEZONESON) ? zones : null,
    size,
  };
}
