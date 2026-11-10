/**
 * Why a project with no readable schematic or board could not be opened, named for the file
 * that caused it — a binary EAGLE file, a Fusion 360 mechanical archive, another tool's design —
 * instead of the generic "nothing supported". Undefined when nothing specific is known.
 */
type Asset = { path: string; bytes: Uint8Array };
type Diagnostic = { code: string; sourceRef?: { path?: string } };

const name = (path: string) => path.split("/").pop() || path;
const list = (paths: string[]) => {
  const names = [...new Set(paths.map(name))];
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
};
const head = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes.subarray(0, 64));

/** Other tools' design files, by extension and/or first bytes. */
const OTHER_TOOLS: { tool: string; test: (a: Asset) => boolean }[] = [
  { tool: "gEDA / Lepton (gschem)", test: (a) => /\.(sch|sym)$/i.test(a.path) && /^v \d{8} \d/.test(head(a.bytes)) },
  { tool: "gEDA PCB", test: (a) => /\.pcb$/i.test(a.path) && /^(#|FileVersion|PCB\[)/m.test(head(a.bytes)) },
  { tool: "OrCAD Capture", test: (a) => /\.(dsn|opj)$/i.test(a.path) },
  { tool: "Protel 99 SE", test: (a) => /\.ddb$/i.test(a.path) },
  { tool: "DipTrace", test: (a) => /\.(dch|dip)$/i.test(a.path) },
  { tool: "Proteus", test: (a) => /\.pdsprj$/i.test(a.path) },
  { tool: "PADS", test: (a) => /\.(pcb|sch)$/i.test(a.path) && /^!PADS-/.test(head(a.bytes)) },
  { tool: "Fritzing", test: (a) => /\.fzz?$/i.test(a.path) },
];

export function unsupportedCadReason(assets: Asset[], diagnostics: Diagnostic[] = []): string | undefined {
  const paths = (code: string) => diagnostics.filter((d) => d.code === code).map((d) => d.sourceRef?.path || "").filter(Boolean);
  const binaryEagle = paths("EAGLE_BINARY_UNSUPPORTED");
  if (binaryEagle.length)
    return `${list(binaryEagle)} ${binaryEagle.length > 1 ? "are" : "is"} binary EAGLE (version 5 or older), which cannot be read in the browser. Open ${binaryEagle.length > 1 ? "them" : "it"} in EAGLE 6 or later (or Fusion Electronics) and save again: the design is then stored as XML, which the viewer opens.`;
  const asciiPcb = paths("ALTIUM_ASCII_PCB_UNSUPPORTED");
  if (asciiPcb.length)
    return `${list(asciiPcb)}: an Altium PCB saved as ASCII that could not be read (damaged or an unusual export). Save it in Altium as a binary PcbDoc, or open the project's own EasyEDA / KiCad files if the repository has them.`;
  const fusionEmpty = paths("FUSION_DOCUMENT_EMPTY");
  if (fusionEmpty.length)
    return `${list(fusionEmpty)}: this Fusion Electronics document does not contain its design. Export the schematic and board from Fusion as EAGLE .sch / .brd files.`;
  const mechanical = [...paths("FUSION_MECHANICAL_ONLY"), ...assets.filter((a) => /\.f3d$/i.test(a.path)).map((a) => a.path)];
  if (mechanical.length)
    return `${list(mechanical)} ${mechanical.length > 1 ? "are" : "is"} a Fusion 360 3D design (mechanical model in Autodesk's own format), not a schematic or PCB. Fusion Electronics designs are opened from their .fsch / .fbrd files, or from EAGLE .sch / .brd exports.`;
  for (const { tool, test } of OTHER_TOOLS) {
    const found = assets.filter(test).map((a) => a.path);
    if (found.length) return `${list(found)} ${found.length > 1 ? "are" : /^[AEIOU]/.test(tool) ? "is an" : "is a"} ${tool} design${found.length > 1 ? "s" : ""}, which the viewer does not read.`;
  }
  return undefined;
}
