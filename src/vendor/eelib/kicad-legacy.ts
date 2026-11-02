import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

type InputAsset = { path: string; bytes: Uint8Array };

/**
 * KiCad 5 projects read as KiCad 6+ ones: a legacy schematic (`.sch`,
 * "EESchema Schematic File Version …") written again as the S-expression
 * sheet the rest of this code reads (`.kicad_sch`), with the symbols it uses
 * embedded as `lib_symbols`, converted from the project's legacy symbol
 * libraries (`.lib`, "EESchema-LIBRARY": the `-cache.lib` KiCad 5 keeps
 * beside every project, and a `-rescue.lib`).
 *
 * The conversion is KiCad's own, as Eeschema 6 does it when it opens a KiCad 5
 * project: mils to millimetres, a symbol's orientation matrix to an angle and
 * a mirror, timestamps to uuids, `AR` lines to per-instance references,
 * labels' orientations to angles, sheets' pins to `(pin …)`. Anything this
 * reader does not know is left out — never guessed: a symbol whose
 * definition the package does not have is placed without one, an item of an
 * unknown kind is skipped.
 */

const MIL = 0.0254;
/** Where a sheet's instance paths start: KiCad 5 sheets have no uuid of their own, so every converted sheet of a project shares this one. */
export const LEGACY_ROOT_UUID = "00000000-0000-4000-8000-00000000c1ca";
const MAX_LINES = 400_000;

const round = (value: number) => {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
};
const mm = (mils: number | string | undefined) => round(Number(mils ?? 0) * MIL);
const num = (value: string | undefined, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
/** Text as a KiCad string (as `serialize` writes one). */
const str = (text: string) => JSON.stringify(text);

/** A KiCad 5 timestamp as the uuid KiCad 6 gives it. */
export const timestampUuid = (stamp: string) => `00000000-0000-0000-0000-0000${stamp.toLowerCase().replace(/[^0-9a-f]/g, "0").slice(-8).padStart(8, "0")}`;

/** The uuid a converted wire gets: from its file and line, so the IR's wire (`wire:<line>`) can be found on it. */
export function legacyWireUuid(path: string, line: number): string {
  const file = bytesToHex(sha256(utf8ToBytes(path))).slice(0, 8);
  return `${file}-0000-4000-8000-${line.toString(16).padStart(12, "0")}`;
}

/** A line's words, a quoted one as its text: `F 0 "R 1" H 10 20` → F, 0, R 1, H, 10, 20. */
function words(line: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = [];
  for (const match of line.matchAll(/"((?:\\.|[^"\\])*)"|(\S+)/g)) {
    out.push(match[1] !== undefined ? { text: match[1].replace(/\\(.)/g, "$1"), quoted: true } : { text: match[2]!, quoted: false });
  }
  return out;
}

type Justify = { h?: string; v?: string; italic?: boolean; bold?: boolean; hidden?: boolean };
/** `(effects …)`: KiCad 5's justification letters (L/R/C, T/B/C) as words. */
function effects(sizeMils: number | string | undefined, justify: Justify = {}): string {
  const size = mm(num(String(sizeMils ?? 50), 50) || 50);
  const font = `(font (size ${size} ${size})${justify.italic ? " italic" : ""}${justify.bold ? " bold" : ""})`;
  const h = justify.h === "L" ? "left" : justify.h === "R" ? "right" : justify.h === "left" || justify.h === "right" ? justify.h : "";
  const v = justify.v === "T" ? "top" : justify.v === "B" ? "bottom" : justify.v === "top" || justify.v === "bottom" ? justify.v : "";
  const both = [h, v].filter(Boolean).join(" ");
  return `(effects ${font}${both ? ` (justify ${both})` : ""}${justify.hidden ? " hide" : ""})`;
}

/* ---------------------------------------------------------------------------
 * Symbol libraries
 * ------------------------------------------------------------------------- */

type LegacyDefinition = {
  name: string;
  reference: string;
  nameOffset: number;
  showNumbers: boolean;
  showNames: boolean;
  power: boolean;
  aliases: string[];
  /** F0…: `[number, words]`. */
  fields: { index: number; parts: { text: string; quoted: boolean }[] }[];
  /** Graphics and pins, each with the unit and body style it belongs to (0: all). */
  items: { unit: number; convert: number; text: string }[];
};

const PIN_TYPES: Record<string, string> = {
  I: "input", O: "output", B: "bidirectional", T: "tri_state", P: "passive", U: "unspecified",
  W: "power_in", w: "power_out", C: "open_collector", E: "open_emitter", N: "no_connect", F: "free",
};
const PIN_SHAPES: Record<string, string> = {
  "": "line", I: "inverted", C: "clock", IC: "inverted_clock", CI: "inverted_clock", L: "input_low", CL: "clock_low", LC: "clock_low", V: "output_low", F: "edge_clock_high", X: "non_logic",
};
const PIN_ANGLES: Record<string, number> = { R: 0, U: 90, L: 180, D: 270 };
const FILLS: Record<string, string> = { F: "outline", f: "background", N: "none" };

const stroke = (thickness: string | undefined) => `(stroke (width ${mm(num(thickness))}) (type default))`;
const fill = (letter: string | undefined) => `(fill (type ${FILLS[letter ?? "N"] ?? "none"}))`;

/** One `DRAW` line as a KiCad 6 graphic or pin; null for a kind this reader does not know. */
function drawItem(line: string): { unit: number; convert: number; text: string } | null {
  const t = words(line);
  const w = (index: number) => t[index]?.text;
  const n = (index: number) => num(w(index));
  switch (w(0)) {
    case "S":
      return { unit: n(5), convert: n(6), text: `(rectangle (start ${mm(w(1))} ${mm(w(2))}) (end ${mm(w(3))} ${mm(w(4))}) ${stroke(w(7))} ${fill(w(8))})` };
    case "C":
      return { unit: n(4), convert: n(5), text: `(circle (center ${mm(w(1))} ${mm(w(2))}) (radius ${mm(w(3))}) ${stroke(w(6))} ${fill(w(7))})` };
    case "P":
    case "B": {
      const count = n(1);
      if (count < 2 || t.length < 5 + count * 2) return null;
      const pts = Array.from({ length: count }, (_, i) => `(xy ${mm(w(5 + i * 2))} ${mm(w(6 + i * 2))})`).join(" ");
      if (w(0) === "B" && count !== 4) return null;
      return { unit: n(2), convert: n(3), text: `(${w(0) === "P" ? "polyline" : "bezier"} (pts ${pts}) ${stroke(w(4))} ${fill(w(5 + count * 2))})` };
    }
    case "A": {
      // KiCad 5 draws the shorter way round between the arc's ends (TRANSFORM::MapAngles).
      const [cx, cy, r] = [n(1), n(2), n(3)];
      const ends = t.length >= 14 ? [n(10), n(11), n(12), n(13)] : [cx + r * Math.cos((n(4) * Math.PI) / 1800), cy + r * Math.sin((n(4) * Math.PI) / 1800), cx + r * Math.cos((n(5) * Math.PI) / 1800), cy + r * Math.sin((n(5) * Math.PI) / 1800)];
      const [sx, sy, ex, ey] = ends as [number, number, number, number];
      const a1 = Math.atan2(sy - cy, sx - cx);
      let sweep = Math.atan2(ey - cy, ex - cx) - a1;
      while (sweep <= -Math.PI) sweep += 2 * Math.PI;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      const mid = a1 + sweep / 2;
      return { unit: n(6), convert: n(7), text: `(arc (start ${mm(sx)} ${mm(sy)}) (mid ${mm(cx + r * Math.cos(mid))} ${mm(cy + r * Math.sin(mid))}) (end ${mm(ex)} ${mm(ey)}) ${stroke(w(8))} ${fill(w(9))})` };
    }
    case "T": {
      // T angle x y size hidden unit convert text [italic bold hjust vjust]; unquoted text writes spaces as ~.
      const text = t[8]?.quoted ? t[8].text : (w(8) ?? "").replace(/~/g, " ");
      if (!text) return null;
      const justify: Justify = { h: w(11), v: w(12), italic: w(9) === "Italic", bold: w(10) === "1", hidden: w(5) === "1" };
      return { unit: n(6), convert: n(7), text: `(text ${str(text)} (at ${mm(w(2))} ${mm(w(3))} ${round(n(1) / 10)}) ${effects(w(4), justify)})` };
    }
    case "X": {
      // X name number x y length orientation number-size name-size unit convert type [shape]
      if (t.length < 12) return null;
      const shape = (w(12) ?? "").replace(/N/g, "");
      const hidden = (w(12) ?? "").includes("N");
      const type = PIN_TYPES[w(11) ?? ""] ?? "unspecified";
      return {
        unit: n(9),
        convert: n(10),
        text: `(pin ${type} ${PIN_SHAPES[shape] ?? "line"} (at ${mm(w(3))} ${mm(w(4))} ${PIN_ANGLES[w(6) ?? ""] ?? 0}) (length ${mm(w(5))})${hidden ? " hide" : ""} (name ${str(w(1) ?? "")} ${effects(w(8))}) (number ${str(w(2) ?? "")} ${effects(w(7))}))`,
      };
    }
    default:
      return null;
  }
}

/** The definitions of a legacy symbol library, by name; aliases separately. */
export function readLegacyLibrary(text: string): { definitions: Map<string, LegacyDefinition>; aliases: Map<string, LegacyDefinition> } {
  const definitions = new Map<string, LegacyDefinition>();
  const aliases = new Map<string, LegacyDefinition>();
  let current: LegacyDefinition | null = null;
  let inFootprints = false;
  for (const raw of text.split(/\r?\n/, MAX_LINES)) {
    const line = raw.trim();
    if (line.startsWith("DEF ")) {
      // DEF name reference 0 name-offset show-numbers show-names units locked power
      const t = words(line).map((word) => word.text);
      current = {
        name: (t[1] ?? "").replace(/^~/, ""),
        reference: t[2] ?? "",
        nameOffset: num(t[4]),
        showNumbers: t[5] !== "N",
        showNames: t[6] !== "N",
        power: t[9] === "P",
        aliases: [],
        fields: [],
        items: [],
      };
      if (current.name) definitions.set(current.name, current);
      continue;
    }
    if (!current) continue;
    if (line === "ENDDEF") {
      current = null;
      continue;
    }
    if (line === "$FPLIST") inFootprints = true;
    if (line === "$ENDFPLIST") {
      inFootprints = false;
      continue;
    }
    if (inFootprints) continue;
    if (line.startsWith("ALIAS ")) {
      for (const alias of line.split(/\s+/).slice(1)) {
        current.aliases.push(alias);
        aliases.set(alias, current);
      }
      continue;
    }
    const field = /^F(\d+)\s/.exec(line);
    if (field) {
      current.fields.push({ index: Number(field[1]), parts: words(line).slice(1) });
      continue;
    }
    const item = /^[SCPBATX] /.test(line) ? drawItem(line) : null;
    if (item) current.items.push(item);
  }
  return { definitions, aliases };
}

const FIELD_NAMES = ["Reference", "Value", "Footprint", "Datasheet"];

/** A legacy definition as a KiCad 6 symbol named `libId`, its units `<name>_<unit>_<body style>` (0: shared). */
function symbolText(definition: LegacyDefinition, libId: string, value: string): string {
  const base = libId.split(":").pop() ?? libId;
  const head = [
    `(symbol ${str(libId)}`,
    definition.power ? "(power)" : "",
    definition.showNumbers ? "" : "(pin_numbers hide)",
    `(pin_names (offset ${mm(definition.nameOffset)})${definition.showNames ? "" : " hide"})`,
    "(in_bom yes) (on_board yes)",
  ].filter(Boolean);
  const properties = definition.fields.flatMap(({ index, parts }) => {
    // "text" x y size H|V V|I hjust vjust+italic+bold ["name"]
    const name = FIELD_NAMES[index] ?? (parts[8]?.quoted && parts[8].text ? parts[8].text : `Field${index}`);
    const style = parts[7]?.text ?? "CNN";
    const text = index === 1 ? value : index === 0 ? definition.reference : (parts[0]?.text ?? "");
    return [`(property ${str(name)} ${str(text)} (at ${mm(parts[1]?.text)} ${mm(parts[2]?.text)} ${parts[4]?.text === "V" ? 90 : 0}) ${effects(parts[3]?.text, { h: parts[6]?.text, v: style[0], italic: style[1] === "I", bold: style[2] === "B", hidden: parts[5]?.text === "I" })})`];
  });
  const groups = new Map<string, string[]>();
  for (const item of definition.items) {
    const key = `${base}_${item.unit}_${item.convert}`;
    groups.set(key, [...(groups.get(key) ?? []), item.text]);
  }
  const units = [...groups].map(([key, items]) => `(symbol ${str(key)} ${items.join(" ")})`);
  return `${head.join(" ")} ${[...properties, ...units].join(" ")})`;
}

/**
 * A legacy library's first symbol as a KiCad 6 symbol library, so it can be
 * drawn like any `.kicad_sym` (the project viewer's library previews). Null
 * when the text holds no definition.
 */
export function legacySymbolLibraryText(text: string): string | null {
  if (!text.startsWith("EESchema-LIBRARY")) return null;
  const [definition] = readLegacyLibrary(text).definitions.values();
  if (!definition) return null;
  return `(kicad_symbol_lib (version 20211014) (generator eelib) ${symbolText(definition, definition.name, definition.name)})`;
}

/** The project's legacy libraries: the caches first (KiCad 5 draws every symbol from them), then each library by its file's name. */
export type LegacyLibraries = { caches: ReturnType<typeof readLegacyLibrary>[]; byName: Map<string, ReturnType<typeof readLegacyLibrary>> };

const decoder = new TextDecoder();
const baseName = (path: string) => path.replace(/\\/g, "/").split("/").pop() ?? path;

export function legacyLibraries(assets: readonly InputAsset[]): LegacyLibraries {
  const caches: LegacyLibraries["caches"] = [];
  const byName: LegacyLibraries["byName"] = new Map();
  for (const asset of assets) {
    if (!/\.lib$/i.test(asset.path)) continue;
    const text = decoder.decode(asset.bytes);
    if (!text.startsWith("EESchema-LIBRARY")) continue;
    const library = readLegacyLibrary(text);
    const stem = baseName(asset.path).replace(/\.lib$/i, "");
    if (/-cache$/i.test(stem)) caches.push(library);
    byName.set(stem.toLowerCase(), library);
  }
  return { caches, byName };
}

/**
 * The definition a component's `lib:name` is drawn with, and the Value it
 * gives an alias: the cache's `lib_name` first (what KiCad 5 itself draws), an
 * alias of the cache's under that library, else the library of that name in
 * the package (a rescue library). Null when none has it.
 */
function resolveDefinition(libraries: LegacyLibraries, libId: string): { definition: LegacyDefinition; value: string } | null {
  const [nickname, name] = libId.includes(":") ? [libId.slice(0, libId.indexOf(":")), libId.slice(libId.indexOf(":") + 1)] : ["", libId];
  const flat = libId.replace(/:/g, "_");
  for (const cache of libraries.caches) {
    const definition = cache.definitions.get(flat) ?? (nickname ? undefined : cache.definitions.get(name));
    if (definition) return { definition, value: definition.name === flat ? name : definition.name };
    const alias = cache.aliases.get(flat) ?? cache.aliases.get(name);
    if (alias && (!nickname || alias.name.startsWith(`${nickname}_`))) return { definition: alias, value: name };
  }
  const library = nickname ? libraries.byName.get(nickname.toLowerCase()) : undefined;
  if (library) {
    const definition = library.definitions.get(name);
    if (definition) return { definition, value: name };
    const alias = library.aliases.get(name);
    if (alias) return { definition: alias, value: name };
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Schematics
 * ------------------------------------------------------------------------- */

/** True for a KiCad 5 (or earlier) schematic. */
export const isLegacySchematic = (bytes: Uint8Array) => decoder.decode(bytes.subarray(0, 64)).startsWith("EESchema Schematic File Version");

type M = [number, number, number, number];
const turn = (degrees: number): M => {
  const r = (degrees * Math.PI) / 180;
  const [c, s] = [Math.round(Math.cos(r)), Math.round(Math.sin(r))];
  return [c, s, -s, c];
};
const times = (p: M, q: M): M => [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3]];
const MIRRORS: [undefined | "x" | "y", M][] = [[undefined, [1, 0, 0, 1]], ["x", [1, 0, 0, -1]], ["y", [-1, 0, 0, 1]]];

/**
 * A component's orientation matrix as KiCad 6's angle and mirror. KiCad 5
 * maps a library point (x, y up) by [[a, b], [c, d]]; KiCad 6 turns, then
 * mirrors, the point (x, −y) — so the angle and mirror are those whose
 * matrix is [[a, −b], [c, −d]]. Null for a matrix that is neither.
 */
export function legacyPose([a, b, c, d]: M): { angle: number; mirror?: "x" | "y" } | null {
  const target: M = [a, -b, c, -d];
  // The smallest angle first: a symbol mirrored left to right is (0, mirror y), not (180, mirror x).
  for (const angle of [0, 90, 180, 270]) {
    for (const [mirror, flip] of MIRRORS) {
      const m = times(flip, turn(angle));
      if (m.every((value, index) => value === target[index])) return { angle, ...(mirror ? { mirror } : {}) };
    }
  }
  return null;
}

const PAPER_NAMES = new Set(["A5", "A4", "A3", "A2", "A1", "A0", "A", "B", "C", "D", "E", "USLetter", "USLegal", "USLedger"]);
const LABEL_SHAPES: Record<string, string> = { Input: "input", Output: "output", BiDi: "bidirectional", "3State": "tri_state", UnSpc: "passive" };
const SHEET_PIN_SHAPES: Record<string, string> = { I: "input", O: "output", B: "bidirectional", T: "tri_state", U: "passive" };
const SHEET_PIN_ANGLES: Record<string, number> = { R: 0, T: 90, L: 180, B: 270 };

/** A `$Comp` block as a KiCad 6+ symbol instance; null without a library id or a place. */
function component(block: string[], libraries: LegacyLibraries, used: Map<string, string | null>): string | null {
  const find = (prefix: string) => block.find((line) => line.startsWith(prefix));
  const library = words(find("L ") ?? "")[1]?.text;
  const place = words(find("P ") ?? "");
  if (!library || place.length < 3) return null;
  const [unit, convert, stamp] = words(find("U ") ?? "").slice(1).map((word) => word.text);
  const matrix = block.map((line) => /^\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/.exec(line)).find(Boolean);
  const transform: M = matrix ? (matrix.slice(1, 5).map(Number) as M) : [1, 0, 0, -1];
  const pose = legacyPose(transform);
  if (!pose) return null;
  const [ox, oy] = [num(place[1]!.text), num(place[2]!.text)];
  const [x, y] = [mm(ox), mm(oy)];
  // KiCad 5 keeps a field where it would be on the symbol unturned; KiCad 6 keeps where it is drawn — through the matrix.
  const fieldAt = (fx: number, fy: number) => [mm(ox + transform[0] * (fx - ox) + transform[1] * (fy - oy)), mm(oy + transform[2] * (fx - ox) + transform[3] * (fy - oy))].join(" ");

  if (!used.has(library)) {
    const found = resolveDefinition(libraries, library);
    used.set(library, found ? symbolText(found.definition, library, found.value) : null);
  }

  // Each instance's own reference (a sheet used twice): `AR Path="/<sheet>/…/<component>" Ref="R5" Part="1"`.
  const references = new Set<string>();
  const instances = block.flatMap((line) => {
    if (!line.startsWith("AR ")) return [];
    const attributes = Object.fromEntries([...line.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!]));
    const path = (attributes.Path ?? "").split("/").filter(Boolean);
    if (path.length === 0 || !attributes.Ref) return [];
    const sheetPath = [LEGACY_ROOT_UUID, ...path.slice(0, -1).map(timestampUuid)].map((id) => `/${id}`).join("");
    references.add(attributes.Ref);
    return [`(path ${str(sheetPath)} (reference ${str(attributes.Ref)}) (unit ${num(attributes.Part, num(unit, 1))}))`];
  });

  // The Reference shown: an unannotated one ("R?") is the one annotation its instances have, when they have only one.
  const annotated = [...references].filter((reference) => !reference.endsWith("?"));
  const properties: string[] = [];
  for (const line of block.filter((entry) => /^F\s+\d+\s/.test(entry))) {
    // F n "text" H|V x y size flags hjust vjust+italic+bold ["name"]
    const t = words(line);
    const index = num(t[1]?.text);
    const name = FIELD_NAMES[index] ?? (t[10]?.quoted && t[10].text ? t[10].text : `Field${index}`);
    if (properties.some((entry) => entry.startsWith(`(property ${str(name)} `))) continue;
    const style = t[9]?.text ?? "CNN";
    const flags = t[7]?.text ?? "0000";
    const text = index === 0 && (t[2]?.text ?? "").endsWith("?") && annotated.length === 1 ? annotated[0]! : (t[2]?.text ?? "");
    properties.push(
      `(property ${str(name)} ${str(text)} (at ${fieldAt(num(t[4]?.text, ox), num(t[5]?.text, oy))} ${t[3]?.text === "V" ? 90 : 0}) ${effects(t[6]?.text, { h: t[8]?.text, v: style[0], italic: style[1] === "I", bold: style[2] === "B", hidden: flags.endsWith("1") })})`,
    );
  }

  return [
    `(symbol (lib_id ${str(library)}) (at ${x} ${y} ${pose.angle})${pose.mirror ? ` (mirror ${pose.mirror})` : ""} (unit ${num(unit, 1) || 1})${num(convert, 1) > 1 ? ` (convert ${num(convert)})` : ""} (in_bom yes) (on_board yes)`,
    stamp ? `(uuid ${str(timestampUuid(stamp))})` : "",
    ...properties,
    instances.length ? `(instances (project "" ${instances.join(" ")}))` : "",
    ")",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/ \)$/, ")");
}

/** A `$Sheet` block as a KiCad 6+ sheet: its box, name and file (`.sch` read as `.kicad_sch`), and its pins. */
function sheet(block: string[]): string | null {
  const box = words(block.find((line) => line.startsWith("S ")) ?? "").map((word) => word.text);
  if (box.length < 5) return null;
  const [x, y, w, h] = [mm(box[1]), mm(box[2]), mm(box[3]), mm(box[4])];
  const stamp = words(block.find((line) => line.startsWith("U ")) ?? "")[1]?.text;
  let name = "";
  let file = "";
  const parts: string[] = [];
  for (const line of block) {
    const field = /^F(\d+)\s/.exec(line);
    if (!field) continue;
    const t = words(line);
    if (field[1] === "0") {
      name = t[1]?.text ?? "";
      parts.push(`(property "Sheetname" ${str(name)} (at ${x} ${round(y - 0.7)} 0) ${effects(t[2]?.text, { h: "left", v: "bottom" })})`);
    } else if (field[1] === "1") {
      file = (t[1]?.text ?? "").replace(/\.sch$/i, ".kicad_sch");
      parts.push(`(property "Sheetfile" ${str(file)} (at ${x} ${round(y + h + 0.6)} 0) ${effects(t[2]?.text, { h: "left", v: "top" })})`);
    } else {
      // F2… "NAME" shape side x y size
      const side = t[3]?.text ?? "";
      const angle = SHEET_PIN_ANGLES[side];
      if (angle === undefined || !t[1]?.text) continue;
      parts.push(`(pin ${str(t[1].text)} ${SHEET_PIN_SHAPES[t[2]?.text ?? ""] ?? "passive"} (at ${mm(t[4]?.text)} ${mm(t[5]?.text)} ${angle}) ${effects(t[6]?.text, { h: angle === 0 ? "right" : "left" })})`);
    }
  }
  if (!file) return null;
  return `(sheet (at ${x} ${y}) (size ${w} ${h}) (stroke (width 0) (type solid)) (fill (color 0 0 0 0))${stamp ? ` (uuid ${str(timestampUuid(stamp))})` : ""} ${parts.join(" ")})`;
}

/**
 * One KiCad 5 schematic as a KiCad 6+ sheet: its page, title block, the
 * symbols it uses (from `libraries`), its components, wires, buses, junctions,
 * no-connects, labels, notes and sheets. `path` names the file, for its wires'
 * uuids (legacyWireUuid).
 */
export function convertLegacySchematic(text: string, libraries: LegacyLibraries, path = ""): string {
  const lines = text.split(/\r?\n/, MAX_LINES);
  if (!lines[0]?.startsWith("EESchema Schematic File Version")) throw new Error("not_a_legacy_schematic");
  const used = new Map<string, string | null>();
  const body: string[] = [];
  let paper = `(paper "A4")`;
  const title: string[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const t = words(line);
    const next = () => lines[index + 1] ?? "";
    const coordinates = () => next().trim().split(/\s+/).map(Number);
    switch (t[0]?.text) {
      case "$Descr": {
        const [name, width, height] = [t[1]?.text ?? "A4", num(t[2]?.text), num(t[3]?.text)];
        const portrait = t.some((word) => word.text === "portrait");
        paper = name === "User" ? `(paper "User" ${mm(width)} ${mm(height)})` : PAPER_NAMES.has(name) ? `(paper ${str(name)}${portrait ? " portrait" : ""})` : paper;
        break;
      }
      case "Title":
      case "Date":
      case "Rev":
      case "Comp": {
        const value = t[1]?.text ?? "";
        if (value) title.push(`(${({ Title: "title", Date: "date", Rev: "rev", Comp: "company" } as Record<string, string>)[t[0].text]} ${str(value)})`);
        break;
      }
      case "$Comp":
      case "$Sheet":
      case "$Bitmap": {
        const end = { $Comp: "$EndComp", $Sheet: "$EndSheet", $Bitmap: "$EndBitmap" }[t[0].text]!;
        const block: string[] = [];
        while (index + 1 < lines.length && lines[index + 1]!.trim() !== end) block.push(lines[(index += 1)]!.trim());
        index += 1;
        const item = t[0].text === "$Comp" ? component(block, libraries, used) : t[0].text === "$Sheet" ? sheet(block) : null;
        if (item) body.push(item);
        break;
      }
      case "Wire":
      case "Entry": {
        const [x1, y1, x2, y2] = coordinates();
        if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) break;
        const [a, b] = [`(xy ${mm(x1)} ${mm(y1)})`, `(xy ${mm(x2)} ${mm(y2)})`];
        const kind = `${t[0].text} ${t[1]?.text ?? ""}`;
        if (kind === "Wire Wire") body.push(`(wire (pts ${a} ${b}) (stroke (width 0) (type default)) (uuid ${str(legacyWireUuid(path, index + 1))}))`);
        else if (kind === "Wire Bus") body.push(`(bus (pts ${a} ${b}) (stroke (width 0) (type default)))`);
        else if (kind === "Wire Notes") body.push(`(polyline (pts ${a} ${b}) (stroke (width 0) (type dash)))`);
        else if (t[0].text === "Entry") body.push(`(bus_entry (at ${mm(x1)} ${mm(y1)}) (size ${round(mm(x2!) - mm(x1!))} ${round(mm(y2!) - mm(y1!))}) (stroke (width 0) (type default)))`);
        index += 1;
        break;
      }
      case "Connection":
        if (t.length >= 4) body.push(`(junction (at ${mm(t[2]!.text)} ${mm(t[3]!.text)}) (diameter 0) (color 0 0 0 0))`);
        break;
      case "NoConn":
        if (t.length >= 4) body.push(`(no_connect (at ${mm(t[2]!.text)} ${mm(t[3]!.text)}))`);
        break;
      case "Text": {
        // Text Label|GLabel|HLabel|Notes x y orientation size [shape] italic thickness, then the text on the next line.
        const kind = t[1]?.text ?? "";
        const content = next().replace(/\s+$/, "");
        index += 1;
        const [x, y, orientation, size] = [mm(t[2]?.text), mm(t[3]?.text), num(t[4]?.text) & 3, t[5]?.text];
        const shaped = kind === "GLabel" || kind === "HLabel";
        const italic = (shaped ? t[7]?.text : t[6]?.text) === "Italic";
        if (!content) break;
        if (kind === "Label") {
          const angle = [0, 90, 180, 270][orientation]!;
          body.push(`(label ${str(content)} (at ${x} ${y} ${angle}) ${effects(size, { h: angle >= 180 ? "right" : "left", v: "bottom", italic })})`);
        } else if (shaped) {
          // Global and hierarchical labels number their orientations the other way round (Eeschema 6's import).
          const angle = [180, 90, 0, 270][orientation]!;
          const shape = LABEL_SHAPES[t[6]?.text ?? ""] ?? "passive";
          body.push(`(${kind === "GLabel" ? "global_label" : "hierarchical_label"} ${str(content)} (shape ${shape}) (at ${x} ${y} ${angle}) ${effects(size, { h: angle === 0 || angle === 90 ? "left" : "right", italic })})`);
        } else if (kind === "Notes") {
          const note = content.replace(/\\n/g, "\n");
          body.push(`(text ${str(note)} (at ${x} ${y} ${orientation % 2 ? 90 : 0}) ${effects(size, { h: orientation >= 2 ? "right" : "left", v: "bottom", italic })})`);
        }
        break;
      }
      default:
        break;
    }
  }

  // The root uuid (each instance path starts with it), the page, and the symbols used, as KiCad embeds them.
  const symbols = [...used.values()].filter((entry): entry is string => !!entry);
  const comments = lines
    .map((line) => /^Comment(\d)\s+"((?:\\.|[^"\\])*)"/.exec(line))
    .filter((match): match is RegExpExecArray => !!match && !!match[2])
    .map((match) => `(comment ${match[1]} ${str(match[2]!.replace(/\\(.)/g, "$1"))})`);
  return [
    `(kicad_sch (version 20230121) (generator "eelib-legacy")`,
    `  (uuid ${str(LEGACY_ROOT_UUID)})`,
    `  ${paper}`,
    title.length || comments.length ? `  (title_block ${[...title, ...comments].join(" ")})` : "",
    `  (lib_symbols${symbols.map((symbol) => `\n    ${symbol}`).join("")})`,
    ...body.map((item) => `  ${item}`),
    `  (sheet_instances (path "/" (page "1")))`,
    `)`,
    "",
  ]
    .filter((entry) => entry !== "")
    .join("\n");
}

/** A converted sheet: its new path (`.kicad_sch` beside the original) and the original's. */
export type LegacySheet = InputAsset & { from: string };

/**
 * The package's KiCad 5 schematics as KiCad 6+ sheets — each `.sch` that is
 * one (not a backup: `.bak` and `.sch-bak` are other names; not an autosave),
 * written as `.kicad_sch` beside it. Empty when there are none. A sheet that
 * cannot be converted is left out.
 */
export function legacyProjectSchematics(assets: readonly InputAsset[]): LegacySheet[] {
  const sources = assets.filter((asset) => /\.sch$/i.test(asset.path) && !/^_autosave-/i.test(baseName(asset.path)) && isLegacySchematic(asset.bytes));
  if (sources.length === 0) return [];
  const libraries = legacyLibraries(assets);
  const encoder = new TextEncoder();
  return sources.flatMap((asset) => {
    try {
      const text = convertLegacySchematic(decoder.decode(asset.bytes), libraries, asset.path);
      return [{ path: asset.path.replace(/\.sch$/i, ".kicad_sch"), bytes: encoder.encode(text), from: asset.path }];
    } catch {
      return [];
    }
  });
}
