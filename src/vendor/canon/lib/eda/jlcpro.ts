// @ts-nocheck — vendored from canon-eda-ir-agent (REFIR); see ../NOTICE.md. Typed access goes through ../core-api.ts.
import type { KicadParseOutput } from "./kicad";
import type {
  InputAsset,
  NetEndpoint,
  NetIr,
  PartIr,
  PcbIr,
  SchematicIr,
  SourceAsset,
  SourceRef,
} from "./types";
import { basename, decodeUtf8, diagnostic, point, sourceRef, stableId, withoutExtension } from "./util";
import { readJlcProBoard, type JlcProBoardContext } from "./jlcpro-pcb";
import { readRecords, readSymbol, symbolUnit as symbolUnitRecords, type ProSymbol } from "./jlcpro-records";

type JsonObject = Record<string, unknown>;
type RecordLine = unknown[];

const SQLITE_SIGNATURE = "SQLite format 3\u0000";

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function isSqlite(bytes: Uint8Array): boolean {
  return decodeUtf8(bytes.subarray(0, SQLITE_SIGNATURE.length)) === SQLITE_SIGNATURE;
}

function looksLikeRecordStream(bytes: Uint8Array): boolean {
  const firstLine = decodeUtf8(bytes.subarray(0, Math.min(bytes.length, 1024))).split(/\r?\n/, 1)[0]?.trim();
  return Boolean(firstLine && /^\[\s*"DOCTYPE"\s*,/.test(firstLine));
}

export function isJlcProProject(inputs: InputAsset[], inventory: SourceAsset[]): boolean {
  if (inventory.some((asset) => [".epro", ".eprj", ".epru", ".esch", ".epcb", ".esym", ".efoo", ".ecop"].includes(asset.extension))) return true;
  if (inventory.some((asset) => /(^|\/)project\.json$/i.test(asset.relativePath)) && inventory.some((asset) => [".esch", ".epcb"].includes(asset.extension))) return true;
  return inputs.some((input) => looksLikeRecordStream(input.bytes));
}

function parseRecordLines(
  input: InputAsset,
  asset: SourceAsset,
  output: KicadParseOutput,
): { records: RecordLine[]; ref: SourceRef } {
  const ref = sourceRef(asset.id, asset.relativePath);
  const records: RecordLine[] = [];
  let invalidCount = 0;
  let firstInvalidLine = 0;
  const lines = decodeUtf8(input.bytes).split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const value = JSON.parse(line);
      if (Array.isArray(value) && typeof value[0] === "string") records.push(value);
      else {
        invalidCount += 1;
        firstInvalidLine ||= index + 1;
      }
    } catch {
      invalidCount += 1;
      firstInvalidLine ||= index + 1;
    }
  }
  if (invalidCount > 0) {
    output.diagnostics.push(
      diagnostic(
        "JLCEDA_RECORD_PARSE_AGGREGATE",
        `${asset.relativePath} 有 ${invalidCount} 条无效记录（首条位于第 ${firstInvalidLine} 行）；原始文件已保留，仅跳过这些记录。`,
        "warning",
        "syntax",
        { ...ref, line: firstInvalidLine || undefined },
        "preserved",
      ),
    );
    output.opaque += invalidCount;
  }
  output.recognized += records.length;
  return { records, ref };
}

function recordsByType(records: RecordLine[]): Map<string, RecordLine[]> {
  const result = new Map<string, RecordLine[]>();
  for (const record of records) {
    const type = text(record[0]);
    (result.get(type) ?? result.set(type, []).get(type)!).push(record);
  }
  return result;
}

function attributeMap(
  records: RecordLine[],
  shape: "schematic" | "pcb",
): Map<string, Record<string, { value: string; record: RecordLine }>> {
  const result = new Map<string, Record<string, { value: string; record: RecordLine }>>();
  for (const record of records) {
    if (record[0] !== "ATTR") continue;
    const parent = text(record[shape === "schematic" ? 2 : 3]);
    const key = text(record[shape === "schematic" ? 3 : 7]);
    const value = text(record[shape === "schematic" ? 4 : 8]);
    if (!parent || !key) continue;
    const attributes = result.get(parent) ?? {};
    attributes[key] = { value, record };
    result.set(parent, attributes);
  }
  return result;
}

function refForRecord(asset: SourceAsset, record: RecordLine, line?: number): SourceRef {
  return sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: text(record[1]) || undefined, line });
}

function parseSchematicRecords(
  asset: SourceAsset,
  records: RecordLine[],
  ref: SourceRef,
  output: KicadParseOutput,
  projectSheetNames: Map<string, string>,
  partsByReference: Map<string, PartIr>,
  devices: Map<string, Record<string, string>> = new Map(),
  symbolOf: (uuid: string) => ProSymbol | null = () => null,
  footprintTitles: Map<string, string> = new Map(),
): void {
  const byType = recordsByType(records);
  const attributes = attributeMap(records, "schematic");
  const documentToken = withoutExtension(asset.fileName);
  const pathSegments = asset.relativePath.split("/");
  const manifestSheetKey = `${pathSegments.at(-2) ?? ""}/${documentToken}`;
  const sheetName = projectSheetNames.get(manifestSheetKey) ?? projectSheetNames.get(documentToken) ?? documentToken;
  const schematicId = stableId("schematic", asset.sha256, asset.relativePath);
  const documentId = stableId("document", asset.sha256, asset.relativePath);
  const sheetId = stableId("sheet", schematicId, sheetName);
  const pins: SchematicIr["pins"] = [];
  const wires: SchematicIr["wires"] = [];
  const labels: SchematicIr["labels"] = [];
  const symbolInstanceIds: string[] = [];
  const componentPartByNativeId = new Map<string, PartIr>();

  for (const component of byType.get("COMPONENT") ?? []) {
    const nativeId = text(component[1]);
    const attrs = attributes.get(nativeId) ?? {};
    const reference = attrs.Designator?.value;
    if (!reference) continue;
    const existingPart = partsByReference.get(reference);
    const partId = existingPart?.id ?? stableId("part", schematicId, nativeId, reference);
    const unitNumber = (existingPart?.symbolUnits.length ?? 0) + 1;
    const symbolUnitId = stableId("symbol-unit", partId, nativeId, unitNumber);
    // Fields the sheet leaves empty come from the project's device (local change: ../NOTICE.md), `={Other}` resolved.
    const device = devices.get(attrs.Device?.value ?? "") ?? {};
    const lookup = (key: string): string | undefined => attrs[key]?.value || device[key] || undefined;
    const resolved = (key: string, depth = 0): string => {
      const raw = lookup(key) ?? "";
      return raw.startsWith("=") && depth < 4 ? raw.slice(1).replace(/\{([^}]+)\}/g, (_, other: string) => resolved(other, depth + 1)) : raw;
    };
    const fields = Object.fromEntries(
      [...new Set([...Object.keys(device), ...Object.keys(attrs)])]
        .filter((key) => !/^(Symbol|Device|Unique ID|Reuse Block|Group ID|Channel ID|Relevance)$/.test(key))
        .map((key) => [key, resolved(key)])
        .filter(([, value]) => value),
    );
    const footprintUuid = lookup("Footprint") ?? "";
    const symbolUnit: PartIr["symbolUnits"][number] = {
      id: symbolUnitId,
      unit: unitNumber,
      position: point(text(component[3]), text(component[4])),
      rotation: text(component[5]) || "0",
    };
    const part: PartIr = existingPart ?? {
      id: partId,
      logicalPartKey: reference,
      reference,
      value: resolved("Value") || resolved("Name"),
      symbolUnits: [symbolUnit],
      footprint: footprintTitles.get(footprintUuid) || footprintUuid || attrs["Origin Footprint"]?.value || undefined,
      fields,
      manufacturerRaw: resolved("Manufacturer") || undefined,
      mpnRaw: resolved("Manufacturer Part") || resolved("MPN") || undefined,
      variantStatus: /^(yes|true|1)$/i.test(attrs.DNP?.value ?? "") ? "dnp" : "fitted",
      pinPadMap: [],
      sourceRefs: [refForRecord(asset, component)],
    };
    if (existingPart) existingPart.symbolUnits.push(symbolUnit);
    else partsByReference.set(reference, part);
    componentPartByNativeId.set(nativeId, part);
    symbolInstanceIds.push(symbolUnitId);
    output.normalized += 1;
    // Its pins from its symbol (local change: ../NOTICE.md): the symbol's pin ends, mirrored, turned and moved as placed.
    const symbol = symbolOf(lookup("Symbol") ?? "");
    if (symbol) {
      const unit = symbolUnitRecords(symbol, text(component[2]));
      const [cx, cy, angle, mirror] = [Number(component[3]) || 0, Number(component[4]) || 0, ((Number(component[5]) || 0) * Math.PI) / 180, component[6] === 1 || component[6] === true];
      const pinText = new Map<string, Record<string, string>>();
      for (const record of unit) if (record[0] === "ATTR" && text(record[2])) (pinText.get(text(record[2])) ?? pinText.set(text(record[2]), {}).get(text(record[2]))!)[text(record[3])] = text(record[4]);
      for (const record of unit) {
        if (record[0] !== "PIN") continue;
        const [u, v] = [Number(record[4]), Number(record[5])];
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
        const x = mirror ? -u : u;
        const at = [cx + x * Math.cos(angle) - v * Math.sin(angle), cy + x * Math.sin(angle) + v * Math.cos(angle)].map((n) => String(Math.round(n * 1e4) / 1e4));
        const own = pinText.get(text(record[1])) ?? {};
        const number = own.NUMBER || text(record[1]);
        pins.push({
          id: stableId("pin", part.id, nativeId, text(record[1]), number),
          partId: part.id,
          symbolUnitId,
          reference: part.reference,
          number,
          name: own.NAME ?? "",
          position: point(at[0], at[1])!,
          sourceRef: refForRecord(asset, component),
        });
        output.normalized += 1;
      }
    }
  }

  for (const [parentId, attrs] of attributes) {
    const number = attrs.NUMBER?.value;
    if (!number) continue;
    const componentEntry = Array.from(componentPartByNativeId.entries())
      .filter(([nativeId]) => parentId.startsWith(nativeId))
      .sort(([left], [right]) => right.length - left.length)[0];
    if (!componentEntry) continue;
    const [, part] = componentEntry;
    const attrRecord = attrs.NUMBER.record;
    const position = point(text(attrRecord[7]), text(attrRecord[8]));
    if (!position) continue;
    const symbolUnitId = part.symbolUnits[0].id;
    pins.push({
      id: stableId("pin", part.id, parentId, number),
      partId: part.id,
      symbolUnitId,
      reference: part.reference,
      number,
      name: attrs.NAME?.value ?? "",
      position,
      sourceRef: refForRecord(asset, attrRecord),
    });
    output.normalized += 1;
  }

  const wireNetName = new Map<string, string>();
  for (const [parentId, attrs] of attributes) {
    if (attrs.NET?.value) wireNetName.set(parentId, attrs.NET.value);
    if (attrs["Global Net Name"]?.value) {
      const record = attrs["Global Net Name"].record;
      const position = point(text(record[7]), text(record[8]));
      if (!position) continue;
      labels.push({
        id: stableId("label", schematicId, parentId, attrs["Global Net Name"].value),
        name: attrs["Global Net Name"].value,
        kind: "global",
        position,
        sourceRef: refForRecord(asset, record),
      });
      output.normalized += 1;
    }
  }

  const wiresByNet = new Map<string, typeof wires>();
  for (const wire of byType.get("WIRE") ?? []) {
    const nativeId = text(wire[1]);
    const vertices = Array.isArray(wire[2]) ? wire[2] : [];
    const wirePoints = vertices.flatMap((vertex) => {
      if (!Array.isArray(vertex) || vertex.length < 2) return [];
      // Every x, y pair: a wire's polyline holds as many as it bends (local change: ../NOTICE.md).
      return Array.from({ length: Math.floor(vertex.length / 2) }, (_, k) => point(text(vertex[2 * k]), text(vertex[2 * k + 1]))!);
    });
    if (wirePoints.length < 2) continue;
    const wireEntity = { id: stableId("wire", schematicId, nativeId), points: wirePoints, sourceRef: refForRecord(asset, wire) };
    wires.push(wireEntity);
    const netName = wireNetName.get(nativeId) || `UNRESOLVED_${nativeId}`;
    (wiresByNet.get(netName) ?? wiresByNet.set(netName, []).get(netName)!).push(wireEntity);
    output.normalized += 1;
  }

  for (const [name, netWires] of wiresByNet) {
    const id = stableId("logical-net", schematicId, name);
    const matchingLabels = labels.filter((label) => label.name === name);
    const endpoints: NetEndpoint[] = matchingLabels.map((label) => ({
      id: stableId("endpoint", id, label.id),
      type: "label",
      targetId: label.id,
      identifier: { name: label.name },
      position: label.position,
    }));
    const pointKeys = new Set(netWires.flatMap((wire) => wire.points.map((position) => `${position.x},${position.y}`)));
    for (const pinEntity of pins.filter((candidate) => pointKeys.has(`${candidate.position.x},${candidate.position.y}`))) {
      endpoints.push({
        id: stableId("endpoint", id, pinEntity.id),
        type: "symbol_pin",
        targetId: pinEntity.id,
        identifier: { reference: pinEntity.reference, pin: pinEntity.number, partId: pinEntity.partId },
        position: pinEntity.position,
      });
    }
    const resolved = !name.startsWith("UNRESOLVED_");
    output.nets.push({
      id,
      domain: "schematic_logical",
      canonicalName: name,
      displayNames: resolved ? [name] : [],
      endpoints,
      segmentIds: netWires.map((wire) => wire.id),
      resolution: { method: resolved ? "explicit" : "unresolved", confidence: resolved ? 1 : 0.35 },
      sourceRefs: netWires.map((wire) => wire.sourceRef),
    });
  }

  output.schematics.push({
    id: schematicId,
    documentId,
    name: sheetName,
    rootSheetId: sheetId,
    sheets: [{ id: sheetId, name: sheetName, instancePath: "/" }],
    symbolInstanceIds,
    pins,
    wires,
    junctions: [],
    labels,
    noConnects: [],
    connectivityGraphId: stableId("connectivity", schematicId),
    sourceRefs: [ref],
  });
  // Styles and drawing records are drawn by the viewer from the sheet itself (local change: ../NOTICE.md, src/lib/maker/jlcpro-schematic.ts).
  const known = new Set(["DOCTYPE", "HEAD", "OBJ", "COMPONENT", "ATTR", "WIRE", "FONTSTYLE", "LINESTYLE", "TEXT", "RECT", "POLY", "CIRCLE", "ELLIPSE", "ARC", "BUS"]);
  preserveUnknownTypes(asset, byType, known, output);
}

// The board is read by jlcpro-pcb.ts (local change: ../NOTICE.md): footprints placed from the
// project's .efoo with their pads, arcs, fills, pours, outline and silkscreen, in millimetres.
const PCB_RECORDS = new Set([
  "DOCTYPE", "CANVAS", "HEAD", "ACTIVE_LAYER", "LAYER", "LAYER_PHYS", "NET", "COMPONENT", "ATTR", "PAD_NET", "PAD", "LINE", "ARC", "POLY",
  "FILL", "VIA", "POUR", "POURED", "REGION", "STRING", "RULE", "RULE_TEMPLATE", "RULE_SELECTOR", "CONNECT", "PRIMITIVE", "PREFERENCE",
  "SILK_OPTS", "PANELIZE", "PANELIZE_STAMP", "PANELIZE_SIDE", "GROUP", "FONT",
]);

function parsePcbRecords(
  asset: SourceAsset,
  records: RecordLine[],
  ref: SourceRef,
  output: KicadParseOutput,
  pcbNames: Map<string, string>,
  context: JlcProBoardContext,
  panels: Set<string>,
): void {
  const byType = recordsByType(records);
  const token = withoutExtension(asset.fileName);
  const pcbName = pcbNames.get(token) ?? token;
  const board = readJlcProBoard(asset, records, ref, pcbName, context);
  output.normalized += board.normalized;
  if (board.panel) panels.add(board.pcb.id);
  output.constraints.push(
    ...(byType.get("RULE") ?? []).map((record) => ({
      id: stableId("constraint", board.pcb.id, text(record[1])),
      type: "jlceda_rule",
      nativeId: text(record[1]),
      record,
      provenance: "explicit",
    })),
  );
  output.normalized += (byType.get("RULE") ?? []).length;
  output.nets.push(...board.nets);
  output.pcbs.push(board.pcb);
  preserveUnknownTypes(asset, byType, PCB_RECORDS, output);
}

function preserveUnknownTypes(
  asset: SourceAsset,
  byType: Map<string, RecordLine[]>,
  known: Set<string>,
  output: KicadParseOutput,
): void {
  const unknown: Array<{ type: string; count: number }> = [];
  for (const [type, records] of byType) {
    if (known.has(type)) continue;
    unknown.push({ type, count: records.length });
    output.opaqueNodes.push({ recordType: `JLCEDA.Record.${type}`, sourcePath: asset.relativePath, payloadHash: asset.sha256 });
    output.opaque += records.length;
  }
  if (unknown.length) {
    output.diagnostics.push(
      diagnostic(
        "JLCEDA_RECORDS_PARTIAL",
        `${asset.relativePath} 有 ${unknown.reduce((sum, item) => sum + item.count, 0)} 条未映射记录，已按 ${unknown.length} 种类型汇总并原样保留：${unknown.slice(0, 12).map((item) => `${item.type}×${item.count}`).join("、")}${unknown.length > 12 ? "…" : ""}`,
        "warning",
        "unsupported",
        sourceRef(asset.id, asset.relativePath),
        "preserved",
      ),
    );
  }
}

export function parseJlcPro(inputs: InputAsset[], inventory: SourceAsset[]): KicadParseOutput {
  const output: KicadParseOutput = {
    settings: {}, schematics: [], pcbs: [], parts: [], nets: [], constraints: [], libraries: [], sourceMap: [], diagnostics: [], opaqueNodes: [], recognized: 0, normalized: 0, opaque: 0,
  };
  const byPath = new Map(inputs.map((input) => [input.path, input]));
  const projectSheetNames = new Map<string, string>();
  const pcbNames = new Map<string, string>();
  const partsByReference = new Map<string, PartIr>();
  let manifestFound = false;
  // The project's devices and footprints (local change: ../NOTICE.md): boards place footprints from the .efoo files.
  const devices = new Map<string, Record<string, string>>();
  const footprintTitles = new Map<string, string>();
  const footprintFiles = new Map(inputs.filter((input) => /\.efoo$/i.test(input.path)).map((input) => [withoutExtension(basename(input.path)), input]));
  const footprintCache = new Map<string, RecordLine[] | undefined>();
  const boardContext: JlcProBoardContext = {
    devices,
    footprintTitles,
    footprint: (uuid) => {
      if (!footprintCache.has(uuid)) footprintCache.set(uuid, footprintFiles.has(uuid) ? readRecords(footprintFiles.get(uuid)!.bytes) : undefined);
      return footprintCache.get(uuid);
    },
  };
  const panels = new Set<string>();
  const symbolFiles = new Map(inputs.filter((input) => /\.esym$/i.test(input.path)).map((input) => [withoutExtension(basename(input.path)), input]));
  const symbolCache = new Map<string, ProSymbol | null>();
  const symbolOf = (uuid: string) => {
    if (!symbolCache.has(uuid)) symbolCache.set(uuid, symbolFiles.has(uuid) ? readSymbol(symbolFiles.get(uuid)!.bytes) : null);
    return symbolCache.get(uuid) ?? null;
  };

  const easyEdaAssets = inventory
    .filter((item) => item.detectedFormat === "easyeda")
    .sort((left, right) => Number(!/(^|\/)project\.json$/i.test(left.relativePath)) - Number(!/(^|\/)project\.json$/i.test(right.relativePath)));
  for (const asset of easyEdaAssets) {
    const input = byPath.get(asset.relativePath);
    if (!input) continue;
    const ref = sourceRef(asset.id, asset.relativePath);
    output.sourceMap.push(ref);
    if (asset.extension === ".eprj" && isSqlite(input.bytes)) {
      output.projectName ??= withoutExtension(asset.fileName);
      output.opaqueNodes.push({ recordType: "JLCEDA.SQLiteProject", sourcePath: asset.relativePath, payloadHash: asset.sha256 });
      output.opaque += 1;
      output.recognized += 1;
      output.diagnostics.push(
        diagnostic(
          "JLCEDA_SQLITE_STRUCTURE_ONLY",
          `${asset.relativePath} 已识别为 SQLite 工程容器并原样保留；当前浏览器适配器不猜测私有表语义。`,
          "warning",
          "unsupported",
          ref,
          "preserved",
        ),
      );
      continue;
    }
    if (/(^|\/)project\.json$/i.test(asset.relativePath) || asset.extension === ".eprj" && !looksLikeRecordStream(input.bytes)) {
      try {
        const manifest = JSON.parse(decodeUtf8(input.bytes)) as JsonObject;
        const schematics = asObject(manifest.schematics);
        const pcbs = asObject(manifest.pcbs);
        if (schematics || pcbs) {
          manifestFound = true;
          output.settings.projectManifest = manifest;
          // An exported .epro names the project (EasyEDA writes EasyEDAproject_<name>_<date>.epro); its first schematic is often just "Schematic1" (local change: ../NOTICE.md).
          const container = /([^/]+)\.epro\//i.exec(asset.relativePath)?.[1]?.replace(/^EasyEDA(?:Pro)?[_ ]?project_/i, "").replace(/_\d{4}-\d{2}-\d{2}$/, "").replace(/_/g, " ").trim();
          output.projectName ??= text(manifest.name) || container || Object.values(schematics ?? {}).map(asObject).find(Boolean)?.name as string | undefined || withoutExtension(asset.fileName);
          for (const [projectId, project] of Object.entries(schematics ?? {})) {
            const projectObject = asObject(project);
            if (!projectObject || !Array.isArray(projectObject.sheets)) continue;
            for (const sheet of projectObject.sheets) {
              const sheetObject = asObject(sheet);
              if (!sheetObject) continue;
              const name = text(sheetObject.name) || text(sheetObject.uuid) || text(sheetObject.id);
              if (sheetObject.uuid) projectSheetNames.set(text(sheetObject.uuid), name);
              if (sheetObject.id !== undefined) projectSheetNames.set(`${projectId}/${text(sheetObject.id)}`, name);
            }
          }
          for (const [id, name] of Object.entries(pcbs ?? {})) pcbNames.set(id, text(name) || id);
          for (const [id, device] of Object.entries(asObject(manifest.devices) ?? {})) {
            const attributes: Record<string, string> = {};
            for (const [key, value] of Object.entries(asObject(asObject(device)?.attributes) ?? {})) attributes[key] = text(value);
            devices.set(id, attributes);
          }
          for (const [id, footprint] of Object.entries(asObject(manifest.footprints) ?? {})) if (text(asObject(footprint)?.title)) footprintTitles.set(id, text(asObject(footprint)?.title));
          output.recognized += Object.keys(manifest).length;
          output.normalized += Object.keys(manifest).length;
          continue;
        }
      } catch {
        // The aggregate record parser below reports malformed JSONL without flooding diagnostics.
      }
    }
    if (asset.extension === ".esym" || asset.extension === ".efoo") {
      output.libraries.push({
        id: stableId("library", asset.id),
        name: basename(asset.relativePath),
        type: asset.extension === ".esym" ? "symbol" : "footprint",
        resolutionSource: "project_local",
        resolutionStatus: "preserved",
        sourceAssetId: asset.id,
      });
      output.recognized += 1;
      output.normalized += 1;
      continue;
    }
    if (asset.extension === ".esch" || asset.extension === ".epcb" || asset.extension === ".jsonl" || looksLikeRecordStream(input.bytes)) {
      const parsed = parseRecordLines(input, asset, output);
      if (asset.extension === ".epcb" || parsed.records[0]?.[1] === "PCB") parsePcbRecords(asset, parsed.records, parsed.ref, output, pcbNames, boardContext, panels);
      else if (asset.extension === ".esch" || parsed.records[0]?.[1] === "SCH") parseSchematicRecords(asset, parsed.records, parsed.ref, output, projectSheetNames, partsByReference, devices, symbolOf, footprintTitles);
      else {
        const grouped = recordsByType(parsed.records);
        preserveUnknownTypes(asset, grouped, new Set(["DOCTYPE"]), output);
      }
      continue;
    }
    if ([".ecop"].includes(asset.extension)) {
      output.opaqueNodes.push({ recordType: `JLCEDA.Asset${asset.extension}`, sourcePath: asset.relativePath, payloadHash: asset.sha256 });
      output.opaque += 1;
    }
  }

  output.parts = Array.from(partsByReference.values());
  // A real board first, panels last (local change: ../NOTICE.md): the viewer opens the first board.
  output.pcbs.sort((left, right) => Number(panels.has(left.id)) - Number(panels.has(right.id)));
  output.projectName ??= withoutExtension(inventory.find((asset) => asset.detectedFormat === "easyeda")?.fileName ?? "JLCEDA project");
  output.sourceToolVersion = "JLCEDA Pro record stream";
  output.sourceFormatVersion = manifestFound ? "Pro project manifest + JSONL" : "Pro record stream";
  if (!output.schematics.length && !output.pcbs.length && !output.libraries.length && !output.opaqueNodes.length) {
    output.diagnostics.push(diagnostic("PROJECT_ENTRY_NOT_FOUND", "未找到可解析的 JLCEDA Pro SCH/PCB 记录流。", "error", "structure", output.sourceMap[0]));
  }
  return output;
}
