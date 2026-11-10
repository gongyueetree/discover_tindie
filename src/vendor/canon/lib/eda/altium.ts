// @ts-nocheck — vendored from canon-eda-ir-agent (REFIR); see ../NOTICE.md. Typed access goes through ../core-api.ts.
import { joinSheetNets, type KicadParseOutput } from "./kicad";
import { isAltiumAsciiPcb, isAltiumAsciiSchematic, parseAltiumAsciiPcb, parseAltiumAsciiSchematic, parseAltiumNative } from "./altium-native";
import type { InputAsset, SourceAsset } from "./types";
import { decodeUtf8, diagnostic, sourceRef, stableId, withoutExtension } from "./util";

function parseProjectText(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let section = "root";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      result[section] ??= {};
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (section === "root") result[key] = value;
    else (result[section] as Record<string, unknown>)[key] = value;
  }
  return result;
}

function isCfb(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value);
}

const normalizePath = (path: string) => {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
};

/**
 * The documents the package's Altium project(s) list (local change:
 * ../../NOTICE.md): each `[DocumentN] DocumentPath=`, from the project's own
 * folder (`..` and `\` followed; an absolute path, or one from another
 * machine, by its file name when that is one file in the package). Only these
 * are read as the design — a copy beside them (a backup, an older version
 * unpacked from History/) is not read twice over it. `null`: no project, or
 * none of its documents is in the package — then every document is read, as before.
 */
function projectDocuments(inputs: InputAsset[], inventory: SourceAsset[], diagnostics: KicadParseOutput["diagnostics"]): Set<string> | null {
  const projects = inventory.filter(asset => asset.extension === ".prjpcb");
  if (!projects.length) return null;
  const byPath = new Map(inputs.map(input => [input.path.toLowerCase(), input.path]));
  const byName = new Map<string, string[]>();
  for (const input of inputs) {
    const name = input.path.split("/").pop()!.toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), input.path]);
  }
  const listed = new Set<string>();
  for (const project of projects) {
    const input = inputs.find(item => item.path === project.relativePath);
    if (!input) continue;
    const metadata = parseProjectText(decodeUtf8(input.bytes));
    const directory = project.relativePath.split("/").slice(0, -1).join("/");
    for (const [section, value] of Object.entries(metadata)) {
      if (!/^Document\d+$/i.test(section) || !value || typeof value !== "object") continue;
      const path = Object.entries(value).find(([key]) => /^DocumentPath$/i.test(key))?.[1];
      if (typeof path !== "string" || !/\.(schdoc|pcbdoc)$/i.test(path.trim())) continue;
      const wanted = path.trim();
      const relative = /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(wanted) ? undefined : normalizePath(`${directory ? directory + "/" : ""}${wanted}`);
      const named = byName.get(wanted.replace(/\\/g, "/").split("/").pop()!.toLowerCase()) ?? [];
      const found = (relative && byPath.get(relative.toLowerCase())) ?? (named.length === 1 ? named[0] : undefined);
      if (found) listed.add(found);
      else diagnostics.push(diagnostic("PROJECT_DOCUMENT_MISSING", `${project.relativePath} 引用的 ${path} 未上传，请提供完整工程 ZIP。`, "error", "structure", sourceRef(project.id, project.relativePath)));
    }
  }
  if (!listed.size) {
    diagnostics.push(diagnostic("ALTIUM_PROJECT_DOCUMENTS_UNRESOLVED", "工程文件列出的原理图与 PCB 均不在包内；已读取包内全部 SchDoc/PcbDoc。", "warning", "structure"));
    return null;
  }
  // None of the sheets (or boards) the project lists is in the package, but others are — a package renamed or
  // re-foldered on its way here (local change: ../../NOTICE.md): those are read rather than none.
  for (const extension of [".schdoc", ".pcbdoc"]) {
    if ([...listed].some(path => path.toLowerCase().endsWith(extension))) continue;
    const present = inputs.filter(input => input.path.toLowerCase().endsWith(extension));
    if (!present.length) continue;
    for (const input of present) listed.add(input.path);
    diagnostics.push(diagnostic("ALTIUM_PROJECT_DOCUMENTS_FALLBACK", `工程文件列出的 ${extension === ".schdoc" ? "原理图" : "PCB"} 均不在包内；已读取包内的 ${present.map(input => input.path).join(", ")}。`, "warning", "structure"));
  }
  return listed;
}

/**
 * The project's net identifier scope (Project Options → Net Identifier Scope, `[Design] HierarchyMode`): 1 flat
 * (ports global), 2 and 4 hierarchical (sheet entries meet ports; 4 strict), 3 global (ports and net labels
 * global); 0 or none is Altium's automatic choice — hierarchical when a sheet places another, flat when sheets
 * have ports, else global. Power ports are global in every scope but strict hierarchical. Read from the project
 * text; the numbering is Altium's dialog order (local change: ../../NOTICE.md).
 */
export type NetScope = "flat" | "hierarchical" | "strict" | "global";
export function netScope(settings: Record<string, unknown>, schematics: KicadParseOutput["schematics"]): NetScope {
  const design = (settings.Design ?? {}) as Record<string, unknown>;
  const mode = String(Object.entries(design).find(([key]) => /^HierarchyMode$/i.test(key))?.[1] ?? "0").trim();
  if (mode === "1") return "flat";
  if (mode === "2") return "hierarchical";
  if (mode === "3") return "global";
  if (mode === "4") return "strict";
  if (schematics.some(sheet => (sheet.sheetBoxes ?? []).length > 0)) return "hierarchical";
  if (schematics.some(sheet => sheet.labels.some(label => label.kind === "hierarchical"))) return "flat";
  return "global";
}

function applyNetScope(output: KicadParseOutput, scope: NetScope) {
  const changed = new Map<string, "global" | "local">();
  for (const sheet of output.schematics) {
    for (const label of sheet.labels) {
      const kind = label.kind === "hierarchical" && (scope === "flat" || scope === "global") ? "global" : label.kind === "local" && scope === "global" ? "global" : label.kind === "power" && scope === "strict" ? "local" : null;
      if (!kind || !label.sourceRef?.path?.toLowerCase().endsWith(".schdoc")) continue;
      label.kind = kind;
      changed.set(label.id, kind);
    }
  }
  if (!changed.size) return;
  for (const net of output.nets) for (const endpoint of net.endpoints) if (endpoint.type === "label" && changed.has(endpoint.targetId)) endpoint.identifier = { ...endpoint.identifier, kind: changed.get(endpoint.targetId) };
}

export function parseAltium(inputs: InputAsset[], inventory: SourceAsset[]): KicadParseOutput {
  const output: KicadParseOutput = {
    settings: {}, schematics: [], pcbs: [], parts: [], nets: [], constraints: [], libraries: [], sourceMap: [], diagnostics: [], opaqueNodes: [], recognized: 0, normalized: 0, opaque: 0,
  };
  const byPath = new Map(inputs.map((input) => [input.path, input]));
  const live = projectDocuments(inputs, inventory, output.diagnostics);
  for (const asset of inventory.filter((item) => item.detectedFormat === "altium")) {
    const input = byPath.get(asset.relativePath);
    if (!input) continue;
    const ref = sourceRef(asset.id, asset.relativePath);
    output.sourceMap.push(ref);
    if (live && [".schdoc", ".pcbdoc"].includes(asset.extension) && !live.has(asset.relativePath)) {
      output.opaqueNodes.push({ recordType: `Altium.Unlisted${asset.extension}`, sourcePath: asset.relativePath, payloadHash: asset.sha256 });
      output.recognized += 1; output.opaque += 1;
      output.diagnostics.push(diagnostic("ALTIUM_DOCUMENT_NOT_IN_PROJECT", `${asset.relativePath} 不在工程文件的文档列表中（副本、旧版本或其他工程的文档）；已原样保留，未作为当前设计读取。`, "information", "structure", ref, "preserved"));
      continue;
    }
    if (asset.extension === ".bomdoc") {
      output.opaqueNodes.push({ recordType: "Altium.BomDoc", sourcePath: asset.relativePath, payloadHash: asset.sha256 });
      output.recognized += 1; output.opaque += 1;
      output.diagnostics.push(diagnostic("ALTIUM_BOMDOC_STRUCTURE_ONLY", `${asset.relativePath} 为 AD ActiveBOM，原文件已保留；尚未解释其中的采购数据，请附上导出的 BOM CSV。`, "warning", "unsupported", ref, "preserved"));
      continue;
    }
    if (asset.extension === ".prjpcb" || asset.extension === ".dsnwrk") {
      const metadata = parseProjectText(decodeUtf8(input.bytes));
      output.projectName ??= withoutExtension(asset.fileName);
      output.settings = { ...output.settings, ...metadata };
      output.recognized += Object.keys(metadata).length;
      output.normalized += Object.keys(metadata).length;
      continue;
    }
    if (asset.extension === ".outjob") {
      const configuration = decodeUtf8(input.bytes);
      output.settings = {
        ...output.settings,
        outJobs: [
          ...((output.settings.outJobs as Array<Record<string, unknown>> | undefined) ?? []),
          { path: asset.relativePath, text: configuration },
        ],
      };
      output.recognized += 1;
      output.normalized += 1;
      output.diagnostics.push(
        diagnostic(
          "ALTIUM_OUTJOB_PRESERVED",
          `${asset.relativePath} 已作为 Altium 输出任务配置保留；它不是 CFB 设计文档。`,
          "information",
          "structure",
          ref,
          "preserved",
        ),
      );
      continue;
    }
    if (asset.extension === ".schdoc" && !isCfb(input.bytes) && isAltiumAsciiSchematic(input.bytes)) {
      const native: KicadParseOutput = { settings: {}, schematics: [], pcbs: [], parts: [], nets: [], constraints: [], libraries: [], sourceMap: [], diagnostics: [], opaqueNodes: [], recognized: 0, normalized: 0, opaque: 0 };
      try {
        parseAltiumAsciiSchematic(input.bytes, asset, native);
        output.schematics.push(...native.schematics); output.parts.push(...native.parts); output.nets.push(...native.nets);
        output.diagnostics.push(...native.diagnostics);
        output.normalized += native.normalized; output.recognized += native.recognized;
        continue;
      } catch (error) {
        output.diagnostics.push(diagnostic("ALTIUM_NATIVE_UNSUPPORTED", `${asset.relativePath}: ${error instanceof Error ? error.message : "解析失败"}；保留原文件，未输出该文档的部分错误实体。`, "warning", "unsupported", ref, "preserved"));
      }
    }
    if (asset.extension === ".pcbdoc" && !isCfb(input.bytes) && isAltiumAsciiPcb(input.bytes)) {
      const native: KicadParseOutput = { settings: {}, schematics: [], pcbs: [], parts: [], nets: [], constraints: [], libraries: [], sourceMap: [], diagnostics: [], opaqueNodes: [], recognized: 0, normalized: 0, opaque: 0 };
      try {
        parseAltiumAsciiPcb(input.bytes, asset, native);
        output.pcbs.push(...native.pcbs); output.nets.push(...native.nets);
        output.diagnostics.push(...native.diagnostics);
        output.normalized += native.normalized; output.recognized += native.recognized;
        continue;
      } catch (error) {
        output.opaqueNodes.push({ recordType: "Altium.AsciiPcbDoc", sourcePath: asset.relativePath, payloadHash: asset.sha256 });
        output.recognized += 1; output.opaque += 1;
        output.diagnostics.push(diagnostic("ALTIUM_ASCII_PCB_UNSUPPORTED", `${asset.relativePath} 以 PCB ASCII 格式保存，读取失败：${error instanceof Error ? error.message : String(error)}。原文件已保留。`, "warning", "unsupported", ref, "preserved"));
        continue;
      }
    }
    if (isCfb(input.bytes)) {
      if ([".schdoc", ".pcbdoc"].includes(asset.extension)) {
        const native: KicadParseOutput = { settings: {}, schematics: [], pcbs: [], parts: [], nets: [], constraints: [], libraries: [], sourceMap: [], diagnostics: [], opaqueNodes: [], recognized: 0, normalized: 0, opaque: 0 };
        try {
          parseAltiumNative(input.bytes, asset, native);
          output.schematics.push(...native.schematics); output.pcbs.push(...native.pcbs);
          output.parts.push(...native.parts); output.nets.push(...native.nets);
          output.diagnostics.push(...native.diagnostics);
          output.normalized += native.normalized; output.recognized += native.recognized;
          output.opaqueNodes.push({ recordType: `Altium.Partial${asset.extension}`, sourcePath: asset.relativePath, payloadHash: asset.sha256 });
          output.opaque += 1;
          continue;
        } catch (error) {
          output.diagnostics.push(diagnostic("ALTIUM_NATIVE_UNSUPPORTED", `${asset.relativePath}: ${error instanceof Error ? error.message : "解析失败"}；保留原文件，未输出该文档的部分错误实体。`, "warning", "unsupported", ref, "preserved"));
        }
      }
      output.opaqueNodes.push({ recordType: `Altium.CFB${asset.extension}`, sourcePath: asset.relativePath, payloadHash: asset.sha256 });
      output.opaque += 1;
      output.recognized += 1;
      output.diagnostics.push(
        diagnostic(
          "ALTIUM_CFB_STRUCTURE_ONLY",
          `${asset.relativePath} 已通过 CFB/OLE 签名检查并按原始 Hash 保留。当前 Web MVP 不解释专有 Record，避免产生错误器件或连通关系。`,
          "warning",
          "unsupported",
          ref,
          "preserved",
        ),
      );
    } else {
      output.opaqueNodes.push({ recordType: `Altium.Asset${asset.extension}`, sourcePath: asset.relativePath, payloadHash: asset.sha256 });
      output.opaque += 1;
      output.diagnostics.push(
        diagnostic(
          "ALTIUM_CONTAINER_UNRECOGNIZED",
          `${asset.relativePath} 不是可识别的 CFB 容器；文件已按 Hash 原样保留，未据此生成语义实体。`,
          "warning",
          "unsupported",
          ref,
          "preserved",
        ),
      );
    }
  }
  output.projectName ??= inventory.find((asset) => asset.detectedFormat === "altium") ? withoutExtension(inventory.find((asset) => asset.detectedFormat === "altium")!.fileName) : "Altium project";
  for (const part of output.parts) {
    const matches = output.pcbs.flatMap(p => p.footprints).filter(f => f.reference === part.reference);
    if (matches.length === 1) {
      part.footprint = matches[0].libraryIdentifier;
      part.footprintInstanceId = matches[0].id;
    }
  }
  // Nets across sheets (local change: ../../NOTICE.md): the project's net identifier scope decides which names
  // reach other sheets; then sheet entries meet their sheet's ports, and power ports and global names join by name.
  applyNetScope(output, netScope(output.settings, output.schematics));
  output.nets = joinSheetNets(output.schematics, output.nets, output.diagnostics);
  output.sourceToolVersion = "Altium (version unresolved)";
  if (!output.normalized && !output.recognized) {
    output.diagnostics.push(diagnostic("UNSUPPORTED_FORMAT", "Altium 专有 SchDoc/PcbDoc 当前为结构级安全摄取；完整 Record Adapter 已在能力矩阵中标记为后续阶段。", "warning", "unsupported", output.sourceMap[0], "preserved"));
  }
  output.libraries = output.opaqueNodes.filter((node) => /lib/i.test(node.sourcePath)).map((node) => ({ id: stableId("library", node.sourcePath), name: node.sourcePath, type: "altium_container", resolutionStatus: "opaque_preserved" }));
  return output;
}
