import { previewFootprint, previewSymbol, type FootprintPreview, type SymbolPreview } from "./ecad/preview";
import type { CanonicalIrBundle, InputAsset } from "@/vendor/canon/lib/eda/types";
import type { ExtractedAsset } from "@/vendor/canon/lib/design-assets/types";
import { altiumPage, type AltiumPage } from "./altium-page";
import { drawAltiumSchematic, type AltiumSheet } from "./altium-schematic";
import { legacyProjectSchematics, legacySymbolLibraryText, legacyWireUuid } from "./kicad-legacy";
import { drawEagleSchematic } from "./eagle-schematic";
// Tindie: EasyEDA Standard schematics (eelib has no drawer for them).
import { easyEdaSheets } from "@/lib/maker/easyeda-schematic";
import { drawSchematic, sheetOutline, type SheetChild, type SheetDrawing, type SheetHit, type SheetInstance } from "./kicad-schematic";

/**
 * What the project viewer draws, prepared once when the project is parsed and
 * kept as one of the owner's files beside the IR: the viewer reads this
 * instead of re-deriving drawings from a multi-megabyte IR in the browser.
 *
 * `previews` draws each extracted symbol and footprint, keyed by the
 * candidate's content fingerprint (so forty identical capacitors are drawn
 * once). A file that cannot be drawn is simply absent — the Library says so
 * rather than drawing something else in its place.
 *
 * `schematics` draws each placement of a KiCad sheet in its hierarchy order,
 * root first (kicad-schematic.ts), and each sheet of an EAGLE schematic
 * (eagle-schematic.ts), and each Altium SchDoc in its hierarchy
 * (altium-schematic.ts); other formats have none, and the viewer falls back to
 * drawing from the IR.
 *
 * Version 4: the root is the sheet no other sheet places, not the first file
 * in the package (a ZIP listing a sub-sheet first drew only that sheet), and
 * each sheet carries its hierarchical path.
 *
 * Version 5: one drawing per placement, not per file (a sheet placed twice is
 * two drawings, each with its own references), each with the drawing that
 * places it (`parent`); each sheet box with the drawing it opens (`page`) or
 * why it opens none (`missing` — e.g. a sheet the repository never held).
 *
 * Version 6: Altium sheets are drawn from their SchDoc (altium-schematic.ts,
 * user feedback 2026-10-28: an Altium design showed no schematic), in their
 * hierarchy, each sheet symbol opening its sheet.
 */
export const VIEW_VERSION = 6;

export type ProjectView = {
  version: number;
  previews: Record<string, SymbolPreview | FootprintPreview>;
  schematics: SheetDrawing[];
  /** Altium sheets' pages (altium-page.ts), by the IR schematic's id: the IR has no page for them. */
  pages: Record<string, AltiumPage>;
};

/** Each Altium sheet's page, read from its SchDoc. A sheet whose page cannot be read is drawn without one. */
export function altiumPages(bundle: CanonicalIrBundle, assets: readonly InputAsset[]): Record<string, AltiumPage> {
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  const pages: Record<string, AltiumPage> = {};
  for (const sheet of bundle.schematics) {
    const path = sheet.sourceRefs[0]?.path ?? "";
    if (!/\.schdoc$/i.test(path)) continue;
    const asset = byPath.get(path);
    if (!asset) continue;
    try {
      const page = altiumPage(asset.bytes);
      if (page) pages[sheet.id] = page;
    } catch {
      // Not a readable compound file: no page.
    }
  }
  return pages;
}

const decoder = new TextDecoder();

/** Each wire's net, by the wire's KiCad uuid — what the IR knows about connectivity, for highlighting. */
function wireNets(bundle: CanonicalIrBundle): Map<string, string> {
  const nativeOf = new Map<string, string>();
  for (const sheet of bundle.schematics) for (const wire of sheet.wires) if (wire.sourceRef?.nativeId) nativeOf.set(wire.id, wire.sourceRef.nativeId);
  const nets = new Map<string, string>();
  for (const net of bundle.nets) {
    if (net.domain !== "schematic_logical") continue;
    for (const segment of net.segmentIds) {
      const native = nativeOf.get(segment);
      if (native) nets.set(native, net.canonicalName);
    }
  }
  return nets;
}

const parentDir = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

/** A KiCad 5 project's wires' nets, by the uuid each wire has once its sheet is converted (kicad-legacy.ts legacyWireUuid). */
function legacyWireNets(bundle: CanonicalIrBundle): Map<string, string> {
  const uuidOf = new Map<string, string>();
  for (const sheet of bundle.schematics) {
    for (const wire of sheet.wires) {
      const line = /^wire:(\d+)$/.exec(wire.sourceRef?.nativeId ?? "")?.[1];
      const path = wire.sourceRef?.path ?? sheet.sourceRefs[0]?.path;
      if (line && path) uuidOf.set(wire.id, legacyWireUuid(path, Number(line)));
    }
  }
  const nets = new Map<string, string>();
  for (const net of bundle.nets) {
    if (net.domain !== "schematic_logical") continue;
    for (const segment of net.segmentIds) {
      const uuid = uuidOf.get(segment);
      if (uuid) nets.set(uuid, net.canonicalName);
    }
  }
  return nets;
}

/** The most sheet placements drawn for one project; a box past them opens its sheet's first placement. */
export const MAX_PLACEMENTS = 200;

/** A relative path with `.` and `..` resolved, as KiCad resolves a sheet file against its parent's folder. */
const normalize = (path: string) => {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
};

/**
 * The project's KiCad sheets as KiCad's hierarchy navigator lists them: the
 * root, then down the hierarchy, one drawing per placement — a sheet file
 * placed twice is two drawings, each with its own path and its own references
 * (KiCad 7+ `instances`, a KiCad 6 root's `symbol_instances`), since
 * "repeated hierarchical instances cannot be deduplicated by source file".
 * Each drawing says which drawing places it (`parent`), and each sheet box
 * which drawing it opens (`page`) — or why it opens none (`missing`: a sheet
 * the project's files do not hold, one that cannot be drawn, one that places
 * its own ancestor). A KiCad 5 project's sheets are drawn converted. Sheets
 * the hierarchy does not reach follow, by file name.
 */
export function drawSchematics(bundle: CanonicalIrBundle, inputs: readonly InputAsset[]): SheetDrawing[] {
  const paths = bundle.schematics.map((sheet) => sheet.sourceRefs[0]?.path).filter((path): path is string => !!path);
  if (bundle.project.sourceFormat === "eagle") return eagleSheets([...new Set(paths)], inputs);
  if (bundle.project.sourceFormat === "altium") return altiumSheets(bundle, inputs);
  if (bundle.project.sourceFormat === "easyeda") {
    const sheets = easyEdaSheets(inputs);
    if (sheets.length) return sheets;
  }
  let active = [...new Set(paths.filter((path) => path.endsWith(".kicad_sch")))];
  let assets = inputs;
  let nets: Map<string, string> | undefined;
  if (active.length === 0 && paths.some((path) => /\.sch$/i.test(path))) {
    const legacy = legacyProjectSchematics(inputs);
    const convertedOf = new Map(legacy.map((sheet) => [sheet.from, sheet.path]));
    active = [...new Set(paths.flatMap((path) => (convertedOf.has(path) ? [convertedOf.get(path)!] : [])))];
    assets = [...inputs, ...legacy];
    nets = legacyWireNets(bundle);
  }
  if (active.length === 0) return [];
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  const inPackage = new Set(assets.map((asset) => normalize(asset.path).toLowerCase()));
  nets ??= wireNets(bundle);

  // Every sheet read once for what it places (by path, as the parser resolved it: case aside) — not drawn yet.
  type Outline = { text: string; uuid: string; legacy: Map<string, string>; children: (SheetChild & { path: string })[] };
  const outlines = new Map<string, Outline>();
  for (const path of active) {
    const asset = byPath.get(path);
    if (!asset) continue;
    const text = decoder.decode(asset.bytes);
    try {
      const outline = sheetOutline(text);
      outlines.set(path, { text, uuid: outline.uuid, legacy: outline.legacy, children: outline.children.map((child) => ({ ...child, path: normalize(parentDir(path) + child.file) })) });
    } catch {
      // A sheet this reader cannot read is left to the IR view.
    }
  }
  if (outlines.size === 0) return [];
  const byLower = new Map([...outlines.keys()].map((path) => [path.toLowerCase(), path]));
  const resolve = (path: string) => byLower.get(path.toLowerCase());

  const root = rootSheet([...outlines.keys()], new Set([...outlines.values()].flatMap((sheet) => sheet.children.map((child) => resolve(child.path) ?? child.path))), inputs, bundle);
  const stem = (path: string) => path.split("/").pop()!.replace(/\.kicad_sch$/, "");
  const rootOutline = outlines.get(root)!;
  const draw = (path: string, name: string, placement?: SheetInstance) => {
    try {
      return drawSchematic(outlines.get(path)!.text, path.split("/").pop()!, name, nets!, undefined, placement).drawing;
    } catch {
      return null;
    }
  };

  const ordered: SheetDrawing[] = [];
  const firstOf = new Map<string, number>();
  const drawnFiles = new Set<string>();
  /** Boxes that open a placement still to be drawn (its index known once it is), and boxes past the limit. */
  const pendingBoxes: { box: SheetHit; placement: { index?: number; failed?: boolean } }[] = [];
  const pastLimit: { box: SheetHit; path: string }[] = [];
  type Placement = { path: string; name: string; hierarchy: string; uuids: string[]; parent: number | null; ancestors: ReadonlySet<string>; slot: { index?: number; failed?: boolean } };
  const queue: Placement[] = [{ path: root, name: bundle.project.name || stem(root), hierarchy: "/", uuids: [], parent: null, ancestors: new Set([root]), slot: {} }];
  let placements = 1;
  // Root first, then its sheets, then theirs (breadth first) — each placement drawn with its own references.
  while (queue.length > 0) {
    const item = queue.shift()!;
    const instance: SheetInstance = { path: `/${[rootOutline.uuid, ...item.uuids].filter(Boolean).join("/")}`, legacyPath: item.uuids.map((uuid) => `/${uuid}`).join(""), legacy: rootOutline.legacy };
    const drawing = draw(item.path, item.name, instance);
    if (!drawing) {
      item.slot.failed = true;
      continue;
    }
    const index = ordered.length;
    item.slot.index = index;
    drawnFiles.add(item.path);
    if (!firstOf.has(item.path)) firstOf.set(item.path, index);
    ordered.push({ ...drawing, name: item.name, path: item.hierarchy, ...(item.parent !== null ? { parent: item.parent } : {}) });
    for (const child of outlines.get(item.path)!.children) {
      const box = drawing.sheets[child.box];
      if (!box) continue;
      const target = resolve(child.path);
      if (!target) {
        box.missing = inPackage.has(child.path.toLowerCase()) ? "unreadable" : "absent";
        continue;
      }
      if (item.ancestors.has(target)) {
        box.missing = "recursive";
        continue;
      }
      if (placements >= MAX_PLACEMENTS) {
        pastLimit.push({ box, path: target });
        continue;
      }
      placements += 1;
      const slot = {};
      pendingBoxes.push({ box, placement: slot });
      queue.push({ path: target, name: child.name, hierarchy: `${item.hierarchy}${child.name}/`, uuids: [...item.uuids, child.uuid], parent: index, ancestors: new Set([...item.ancestors, target]), slot });
    }
  }
  for (const { box, placement } of pendingBoxes) {
    if (placement.index !== undefined) box.page = placement.index;
    else box.missing = "unreadable";
  }
  for (const { box, path } of pastLimit) {
    const first = firstOf.get(path);
    if (first !== undefined) box.page = first;
    else box.missing = "limit";
  }
  // A sheet no sheet places (a second root, a file left in the folder) is still shown, after the hierarchy, by its file name.
  for (const path of outlines.keys()) {
    if (drawnFiles.has(path)) continue;
    const drawing = draw(path, stem(path));
    if (drawing) ordered.push({ ...drawing, name: stem(path) });
  }
  return ordered;
}

/**
 * An Altium project's sheets (altium-schematic.ts), the root first — the sheet
 * no sheet symbol places — then down the hierarchy, each named as the sheet
 * symbol that places it names it; sheets nothing places follow in the
 * project's order. Each wire carries the net the reading resolved for it (by
 * its record), and each sheet symbol opens the page it places.
 */
function altiumSheets(bundle: CanonicalIrBundle, inputs: readonly InputAsset[]): SheetDrawing[] {
  const byPath = new Map(inputs.map((asset) => [asset.path, asset]));
  const netByWire = new Map<string, string>();
  for (const net of bundle.nets) if (net.domain === "schematic_logical") for (const segment of net.segmentIds) netByWire.set(segment, net.canonicalName);
  const drawn = new Map<string, AltiumSheet>();
  for (const sheet of bundle.schematics) {
    const path = sheet.sourceRefs[0]?.path ?? "";
    const asset = byPath.get(path);
    if (!asset || drawn.has(path) || !/\.schdoc$/i.test(path)) continue;
    const nets = new Map<number, string>();
    for (const wire of sheet.wires) {
      const net = netByWire.get(wire.id);
      if (net && wire.sourceRef?.nativeId) nets.set(Number(wire.sourceRef.nativeId), net);
    }
    try {
      const drawing = drawAltiumSchematic(asset.bytes, path.split("/").pop()!, (index) => nets.get(index));
      if (drawing) drawn.set(path, drawing);
    } catch {
      // A sheet this reader cannot draw is left to the IR view.
    }
  }
  if (drawn.size === 0) return [];
  const key = (file: string) => file.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
  const byFile = new Map<string, string>();
  for (const path of drawn.keys()) if (!byFile.has(key(path))) byFile.set(key(path), path);
  const placed = new Set([...drawn.values()].flatMap((sheet) => sheet.children.flatMap((child) => byFile.get(key(child.file)) ?? [])));
  const roots = [...drawn.keys()].filter((path) => !placed.has(path));
  const ordered: SheetDrawing[] = [];
  const seen = new Set<string>();
  // The first sheet nothing places is the root, named after the project; a second one is a sheet outside the hierarchy.
  const first = roots[0] ?? [...drawn.keys()][0]!;
  const queue: { path: string; name: string; hierarchy: string }[] = [{ path: first, name: bundle.project.name || drawn.get(first)!.drawing.name, hierarchy: "/" }];
  while (queue.length > 0) {
    const { path, name, hierarchy } = queue.shift()!;
    const sheet = drawn.get(path);
    if (!sheet || seen.has(path)) continue;
    seen.add(path);
    ordered.push({ ...sheet.drawing, name, path: hierarchy });
    for (const child of sheet.children) {
      const target = byFile.get(key(child.file));
      if (target) queue.push({ path: target, name: child.name, hierarchy: `${hierarchy}${child.name}/` });
    }
  }
  for (const [path, sheet] of drawn) if (!seen.has(path)) ordered.push(sheet.drawing);
  // Each sheet symbol opens the page of the sheet it places.
  const pageOf = new Map(ordered.map((sheet, index) => [key(sheet.file), index]));
  return ordered.map((sheet) => ({ ...sheet, sheets: sheet.sheets.map((hit) => (pageOf.has(key(hit.file)) ? { ...hit, page: pageOf.get(key(hit.file))! } : hit)) }));
}

/** An EAGLE project's sheets (eagle-schematic.ts), file by file in the package's order; a file it cannot draw is left to the IR view. */
function eagleSheets(paths: readonly string[], inputs: readonly InputAsset[]): SheetDrawing[] {
  const byPath = new Map(inputs.map((asset) => [asset.path, asset]));
  return paths.flatMap((path) => {
    const asset = byPath.get(path);
    if (!asset) return [];
    try {
      return drawEagleSchematic(decoder.decode(asset.bytes), path.split("/").pop()!);
    } catch {
      return [];
    }
  });
}

/**
 * The root sheet: the one no other sheet places. Where several are (a sheet
 * left in the folder), the one named after the project file, as KiCad opens
 * it; else the first in the package.
 */
export function rootSheet(paths: readonly string[], placed: ReadonlySet<string>, inputs: readonly InputAsset[], bundle: CanonicalIrBundle): string {
  const unplaced = paths.filter((path) => !placed.has(path));
  const candidates = unplaced.length > 0 ? unplaced : paths;
  const named = new Set(
    [...inputs.map((asset) => asset.path), ...bundle.inventory.map((asset) => asset.relativePath)]
      .filter((path) => /\.(kicad_pro|pro)$/i.test(path))
      .map((path) => path.replace(/\.(kicad_pro|pro)$/i, ".kicad_sch")),
  );
  return candidates.find((path) => named.has(path)) ?? candidates[0]!;
}

export function buildView(extracted: readonly ExtractedAsset[], bundle: CanonicalIrBundle, assets: readonly InputAsset[]): ProjectView {
  const previews: ProjectView["previews"] = {};
  for (const asset of extracted) {
    if (!asset.file || previews[asset.fingerprint]) continue;
    const name = asset.file.path.toLowerCase();
    try {
      if (asset.kind === "symbol" && name.endsWith(".kicad_sym")) previews[asset.fingerprint] = previewSymbol(decoder.decode(asset.file.bytes));
      else if (asset.kind === "symbol" && name.endsWith(".lib")) {
        // A KiCad 5 symbol (kicad-legacy.ts), drawn as the KiCad 6 symbol it converts to.
        const converted = legacySymbolLibraryText(decoder.decode(asset.file.bytes));
        if (converted) previews[asset.fingerprint] = previewSymbol(converted);
      }
      else if (asset.kind === "footprint" && name.endsWith(".kicad_mod")) previews[asset.fingerprint] = previewFootprint(decoder.decode(asset.file.bytes));
    } catch {
      // Not drawable (a legacy .lib, a damaged file): left out, and shown as such.
    }
  }
  return { version: VIEW_VERSION, previews, schematics: drawSchematics(bundle, assets), pages: altiumPages(bundle, assets) };
}
