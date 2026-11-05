export type SourceFormat = "kicad" | "altium" | "allegro" | "easyeda" | "eagle" | "unknown";

/** How a standard model was matched to a package (package-models.ts): the rules, the rule, what chose it, how well it fits. Local addition (../NOTICE.md). */
export type StandardModelMatch = { rules: string; rule: string; from: "name" | "pads"; footprint: string; pads: number; pitch: number | null; fit: number; pin1: boolean };
/** An Altium 3D body without a model (local addition): extruded from its outline, a cylinder (its outline a circle), or a sphere. */
export type AltiumBody3d = { kind: "extruded" | "cylinder" | "sphere"; outline: [number, number][]; standoff: number; height: number; side: "top" | "bottom"; color?: string; opacity?: number; center?: [number, number]; radius?: number };

export type DiagnosticSeverity =
  | "fatal"
  | "error"
  | "warning"
  | "information";

export type SourceRef = {
  assetId: string;
  path: string;
  nativeId?: string;
  line?: number;
  column?: number;
  jsonPath?: string;
  resolutionMethod:
    | "explicit"
    | "embedded"
    | "connectivity_resolved"
    | "cross_document_matched"
    | "derived"
    | "unknown";
};

export type SourceAsset = {
  irParticipation?: "included" | "excluded";
  id: string;
  relativePath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  detectedFormat: SourceFormat;
  entryRole:
    | "project"
    | "schematic"
    | "pcb"
    | "symbol_library"
    | "footprint_library"
    | "rules"
    | "attachment"
    | "unknown";
  securityStatus: "accepted" | "blocked";
};

export type ParseDiagnostic = {
  id: string;
  severity: DiagnosticSeverity;
  category:
    | "format"
    | "version"
    | "encoding"
    | "syntax"
    | "structure"
    | "library"
    | "connectivity"
    | "geometry"
    | "mapping"
    | "consistency"
    | "unsupported"
    | "security"
    | "resource";
  code: string;
  message: string;
  sourceRef?: SourceRef;
  preservationStatus?: "preserved" | "normalized" | "not_applicable";
};

export type IrPoint = {
  x: string;
  y: string;
  unit: "mm";
  raw?: [string, string];
};

export type PartIr = {
  id: string;
  logicalPartKey: string;
  reference: string;
  value: string;
  symbolUnits: Array<{
    id: string;
    unit: number;
    position?: IrPoint;
    rotation?: string;
  }>;
  footprintInstanceId?: string;
  footprint?: string;
  fields: Record<string, string>;
  manufacturerRaw?: string;
  mpnRaw?: string;
  variantStatus: "fitted" | "dnp" | "optional" | "variant_excluded" | "unknown";
  pinPadMap: Array<{
    pin: string;
    pad: string;
    status: "explicit" | "verified" | "missing";
  }>;
  sourceRefs: SourceRef[];
};

export type NetEndpoint = {
  id: string;
  type: "symbol_pin" | "label" | "footprint_pad" | "track" | "via" | "zone";
  targetId?: string;
  identifier: Record<string, string>;
  position?: IrPoint;
};

export type NetIr = {
  id: string;
  domain: "schematic_logical" | "pcb_physical";
  canonicalName: string;
  displayNames: string[];
  endpoints: NetEndpoint[];
  segmentIds: string[];
  resolution: {
    method: "explicit" | "connectivity_resolved" | "unresolved" | "unknown";
    confidence: number;
  };
  sourceRefs: SourceRef[];
};

export type SchematicIr = {
  id: string;
  documentId: string;
  name: string;
  rootSheetId: string;
  sheets: Array<{ id: string; name: string; instancePath: string }>;
  texts?: Array<{ id: string; symbolUnitId?: string; text: string; kind: string; position: IrPoint; rotation: string; size: string; align: "start" | "middle" | "end" }>;
  sheetBoxes?: Array<{ id: string; name: string; file: string; position: IrPoint; size: { x: string; y: string }; pins: Array<{ name: string; position: IrPoint }> }>;
  page?: { width: number; height: number; title?: string };
  graphics?: Array<{ id: string; symbolUnitId: string; points: IrPoint[]; closed: boolean }>;
  symbolInstanceIds: string[];
  pins: Array<{
    id: string;
    partId: string;
    symbolUnitId: string;
    reference: string;
    number: string;
    name: string;
    electricalType?: string;
    bodyPosition?: IrPoint;
    hidden?: boolean;
    position: IrPoint;
    sourceRef: SourceRef;
  }>;
  wires: Array<{ id: string; points: IrPoint[]; sourceRef: SourceRef }>;
  junctions: Array<{ id: string; position: IrPoint; sourceRef: SourceRef }>;
  labels: Array<{
    id: string;
    name: string;
    kind: "local" | "global" | "hierarchical" | "power";
    shape?: string;
    textPosition?: IrPoint;
    rotation?: string;
    size?: string;
    position: IrPoint;
    sourceRef: SourceRef;
  }>;
  noConnects: IrPoint[];
  connectivityGraphId: string;
  sourceRefs: SourceRef[];
};

export type PcbIr = {
  id: string;
  documentId: string;
  name: string;
  units: "mm";
  coordinateSystem: {
    sourceUnits: string;
    canonicalUnits: "mm";
    rotationConvention: "degrees_ccw";
    precision: "source_token_preserved";
  };
  layers: Array<{
    id: string;
    sourceId: string;
    name: string;
    role: string;
    side: "front" | "back" | "inner" | "both" | "unknown";
    copper: boolean;
  }>;
  stackup: Array<Record<string, string | null>>;
  boardOutline: Array<{
    id: string;
    kind: "line" | "arc" | "circle" | "rectangle";
    geometry: Record<string, unknown>;
  }>;
  physicalDimensions?: {
    width: string;
    height: string;
    thickness?: string;
    unit: "mm";
    boundingBox: {
      minX: string;
      minY: string;
      maxX: string;
      maxY: string;
    };
    outlineClosed: boolean;
  };
  footprints: Array<{
    id: string;
    reference: string;
    value: string;
    libraryIdentifier: string;
    /** The footprint's own fields as the board writes them (KiCad 6+ `property`, KiCad 5 `fp_text`): Reference, Value, MPN… */
    fields?: Record<string, string>;
    /**
     * `standard`: not the design's own model — a standard KiCad model matched by the package (an EAGLE board embeds
     * none; package-models.ts), with how it was matched. Local addition (../NOTICE.md).
     */
    models?: Array<{ path: string; offset: number[]; scale: number[]; rotation: number[]; hidden: boolean; standard?: StandardModelMatch; name?: string }>;
    /**
     * Bodies the design draws without a model (Altium's extruded, cylinder and sphere 3D bodies): an outline in board
     * millimetres (the IR's frame, as pads), raised from `standoff` to `height` above the face it is on; a sphere by
     * its centre and radius. Local addition (../NOTICE.md).
     */
    bodies3d?: AltiumBody3d[];
    /** `width`: the stroke width (mm), when the reader reads it. Local addition (../NOTICE.md). */
    graphics?: Array<{ id: string; layer: string; kind: "line" | "arc" | "circle" | "rectangle"; geometry: Record<string, unknown>; width?: string }>;
    /** Its texts on the silkscreen layers (reference designator and others), in its own frame like `graphics`. Local addition (../NOTICE.md). */
    texts?: PcbText[];
    /** Its polygons on the silkscreen layers (logos, pin-1 marks), in its own frame. Local addition (../NOTICE.md). */
    polygons?: PcbPolygon[];
    position?: IrPoint;
    rotation: string;
    side: "front" | "back" | "unknown";
    locked: boolean;
    padIds: string[];
    sourceRef: SourceRef;
  }>;
  pads: Array<{
    id: string;
    footprintId?: string;
    number: string;
    padType: string;
    shape: string;
    rotation?: string;
    drill?: { x: string; y: string };
    position?: IrPoint;
    size?: { x: string; y: string; unit: "mm" };
    layers: string[];
    netId?: string;
    sourceNativeNetId?: string;
    netName?: string;
    sourceRef: SourceRef;
  }>;
  tracks: Array<{
    id: string;
    kind: "segment" | "arc";
    start?: IrPoint;
    end?: IrPoint;
    mid?: IrPoint;
    width?: string;
    layer?: string;
    netId?: string;
    sourceNativeNetId?: string;
    sourceRef: SourceRef;
  }>;
  vias: Array<{
    id: string;
    position?: IrPoint;
    size?: string;
    drill?: string;
    layers: string[];
    netId?: string;
    sourceNativeNetId?: string;
    sourceRef: SourceRef;
  }>;
  zones: Array<{
    id: string;
    netId?: string;
    sourceNativeNetId?: string;
    layers: string[];
    sourceRef: SourceRef;
    /** The zone as drawn (mm, the reader's frame), when the reader reads it: a rule area or copper, its outline and, layer by layer, its fill. Local addition (../NOTICE.md). */
    shape?: { keepout: boolean; outline: [number, number][]; fills: { layer: string | null; points: [number, number][] }[] };
  }>;
  /** What the board itself draws on its silkscreen layers (not a footprint's), in board coordinates, when the reader reads it. Local addition (../NOTICE.md). */
  silkscreen?: {
    graphics: Array<{ id: string; layer: string; kind: "line" | "arc" | "circle" | "rectangle"; geometry: Record<string, unknown>; width?: string }>;
    polygons: PcbPolygon[];
    texts: PcbText[];
  };
  sourceRefs: SourceRef[];
};

/**
 * A text as the board file writes it: where (a footprint's own frame for a
 * footprint's text, the board's for the board's), its angle on the board
 * (degrees, counter-clockwise, as KiCad stores it), the character height and
 * width and stroke (mm), how it is anchored, and whether it is mirrored (read
 * from the back). Local addition (../NOTICE.md).
 */
export type PcbText = {
  id: string;
  layer: string;
  kind: "reference" | "value" | "field" | "user";
  text: string;
  position: IrPoint;
  angle: string;
  size: { height: string; width: string };
  thickness?: string;
  justify: { horizontal: "left" | "center" | "right"; vertical: "top" | "center" | "bottom" };
  mirrored: boolean;
  /**
   * EasyEDA Pro's drawn extent of the text along its baseline (mm), when the reader knows it, and whether it is
   * knocked out of a filled box `margin` (mm) wider all round (its "inverse" text). Local addition (../NOTICE.md).
   */
  length?: string;
  inverse?: { margin: string };
};

/** A drawn polygon (mm): its corners, stroke width, and whether it is filled. Local addition (../NOTICE.md). */
export type PcbPolygon = { id: string; layer: string; points: IrPoint[]; width?: string; filled: boolean };

export type FidelityDimension = {
  status: "complete" | "substantially_complete" | "partial" | "structure_only" | "unknown";
  recognized: number;
  normalized: number;
  opaque: number;
  note: string;
};

export type CanonicalIrBundle = {
  bomMappings?: Record<string, import("../bom/types").BomMapping>;
  pdfEvidence?: import("../knowledge/types").PdfEvidenceDocument[];
  bundleId: string;
  generatedAt: string;
  parser: {
    agent: "eda-canonical-ir-agent";
    agentVersion: "1.6.0";
    adapterId: string;
    adapterVersion: "1.6.0";
    deterministic: true;
    llmUsedForParsing: false;
    roundTripReadiness: "read_only";
  };
  project: {
    projectIrVersion: "1.0.0";
    id: string;
    name: string;
    sourceFormat: SourceFormat;
    sourceFormatVersion?: string;
    sourceToolVersion?: string;
    documentGraph: Array<{
      id: string;
      type: string;
      name: string;
      relation: "contains" | "references";
    }>;
    settings: Record<string, unknown>;
    opaqueExtensions: Array<{
      sourceFormat: SourceFormat;
      recordType: string;
      sourcePath: string;
      preservationStatus: "preserved";
      payloadHash: string;
    }>;
  };
  inventory: SourceAsset[];
  schematics: SchematicIr[];
  pcbs: PcbIr[];
  parts: PartIr[];
  nets: NetIr[];
  constraints: Array<Record<string, unknown>>;
  variants: Array<Record<string, unknown>>;
  libraries: Array<Record<string, unknown>>;
  crossDocumentLinks: Array<{
    id: string;
    type: "part_to_footprint" | "pin_to_pad" | "schematic_net_to_pcb_net";
    sourceEntityId: string;
    targetEntityId: string;
    status: "explicit" | "verified" | "probable" | "ambiguous" | "missing" | "conflicting";
    confidence: number;
    evidence: string[];
  }>;
  sourceMap: SourceRef[];
  diagnostics: ParseDiagnostic[];
  fidelity: {
    overallStatus: FidelityDimension["status"];
    dimensions: Record<string, FidelityDimension>;
    recognizedObjectCount: number;
    normalizedObjectCount: number;
    opaqueObjectCount: number;
    droppedObjectCount: 0;
    criticalGapCount: number;
  };
  summary: {
    documents: number;
    sheets: number;
    partInstances: number;
    footprints: number;
    logicalNets: number;
    pcbNets: number;
    warnings: number;
    errors: number;
  };
};

export type InputAsset = {
  path: string;
  bytes: Uint8Array;
};
