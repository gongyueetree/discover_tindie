export type RepoFile = {
  path: string;
  sha: string;
  size: number;
  type: string;
  mode?: string;
};
export type GithubProject = {
  id: string;
  name: string;
  directory: string;
  format: string;
  roots: string[];
  fileCount: number;
  version?: number[];
  recommended?: boolean;
};
const supported = /\.(kicad_pro|kicad_sch|kicad_pcb|sch|brd|SchDoc|PcbDoc|PrjPcb|epro|eprj|epru|esch|epcb)$/i;
/** EasyEDA (standard) exports: Schematic_*.json / PCB_*.json, or JSON kept in an easyeda / lceda / jlc folder. */
const easyedaJson = (path: string) =>
  /\.json$/i.test(path) &&
  !/(^|\/)(package(-lock)?|tsconfig|composer|manifest|settings|launch|tasks)\.json$/i.test(path) &&
  (/(^|\/)(schematic|sch|pcb|sheet)[_ -][^/]*\.json$/i.test(path) || /(^|\/)(easyeda|lceda|jlceda|jlc)[^/]*\//i.test(path));
const designFile = (path: string) => supported.test(path) || easyedaJson(path);
/** Folder-based formats: a design's sheets and board sit in one folder under different names. */
const folderFormat = (path: string) =>
  /\.(PrjPcb|SchDoc|PcbDoc)$/i.test(path) ? "Altium" : /\.(eprj|epru|esch|epcb)$/i.test(path) ? "JLCEDA Pro" : easyedaJson(path) ? "EasyEDA" : "";
export function ignoredPath(path: string) {
  return (
    /(^|\/)(\.git|node_modules|__MACOSX|backups?|archive[sd]?|old|obsolete|deprecated|history|gerbers?|fabrication|outputs?|firmware|software)(\/|$)/i.test(
      path,
    ) ||
    /(?:-backups\/|\.(?:bak|bck|tmp)$|~$|\.kicad_prl$|fp-info-cache|sym-lib-table\.bak)/i.test(
      path,
    )
  );
}
const stem = (p: string) => p.replace(/\.[^.]+$/, "");
export function discoverProjects(
  files: RepoFile[],
  prefix = "",
): GithubProject[] {
  const design = files.filter(
    (f) =>
      f.type === "blob" &&
      f.mode !== "120000" &&
      designFile(f.path) &&
      !ignoredPath(f.path) &&
      (!prefix ||
        f.path === prefix ||
        f.path.startsWith(prefix.replace(/\/$/, "") + "/")),
  );
  const byDir = new Map<string, RepoFile[]>();
  for (const f of design) {
    const dir = f.path.includes("/")
      ? f.path.slice(0, f.path.lastIndexOf("/"))
      : "";
    const list = byDir.get(dir) || [];
    list.push(f);
    byDir.set(dir, list);
  }
  const result: GithubProject[] = [];
  for (const [dir, all] of byDir) {
    // A JLCEDA Pro .epro is a complete project archive on its own.
    for (const f of all.filter((v) => /\.epro$/i.test(v.path)))
      result.push({ id: f.path, name: stem(f.path).split("/").pop()!, directory: dir, format: "JLCEDA Pro", roots: [f.path], fileCount: 1, version: [] });
    const folder = all.filter((v) => !/\.epro$/i.test(v.path) && folderFormat(v.path));
    if (folder.length) {
      const format = folderFormat(folder.find((v) => /\.(PrjPcb|PcbDoc|epcb)$/i.test(v.path))?.path || folder[0].path);
      const named = folder.find((v) => /\.(PrjPcb|eprj)$/i.test(v.path)) || folder.find((v) => /\.(PcbDoc|epcb)$/i.test(v.path)) || folder[0];
      const name = /\.json$/i.test(named.path) ? (dir.split("/").pop() || stem(named.path).split("/").pop()!) : stem(named.path).split("/").pop()!;
      result.push({ id: dir + "/#" + format, name, directory: dir, format, roots: folder.map((v) => v.path), fileCount: folder.length, version: [] });
    }
    const list = all.filter((v) => !folderFormat(v.path) && !/\.epro$/i.test(v.path));
    if (!list.length) continue;
    const board = list.filter((f) => /\.(kicad_pcb|brd|PcbDoc)$/i.test(f.path));
    const projects = list.filter((f) => /\.kicad_pro$/i.test(f.path));
    const anchors = board.length
      ? board
      : projects.length
        ? projects
        : list.filter((f) => /\.(kicad_sch|sch|SchDoc)$/i.test(f.path));
    for (const f of anchors) {
      const base = stem(f.path),
        roots = list.filter((v) => stem(v.path) === base).map((v) => v.path);
      const siblings = list.filter((v) =>
        /\.(kicad_sch|sch|SchDoc)$/i.test(v.path),
      );
      if (
        !roots.some((v) => /\.(kicad_sch|sch|SchDoc)$/i.test(v)) &&
        anchors.length === 1 &&
        siblings.length === 1
      )
        roots.push(siblings[0].path);
      const name = base.split("/").pop()!;
      const version = (
        base.match(/(?:^|[/ _-])(?:v|rev[ _-]?)(\d+(?:[._-]\d+)*)/i)?.[1] || ""
      )
        .split(/[._-]/)
        .filter(Boolean)
        .map(Number);
      result.push({
        id: f.path,
        name,
        directory: dir,
        format: /\.kicad_/i.test(f.path)
          ? "KiCad"
          : /\.brd$/i.test(f.path)
            ? "Eagle"
            : "Eagle / KiCad 5",
        roots,
        fileCount: roots.length,
        version,
      });
    }
  }
  const groups = new Map<string, GithubProject[]>();
  for (const p of result) {
    const key = (p.directory + "/" + p.name)
      .replace(/(?:v|rev[ _-]?)\d+(?:[._-]\d+)*/gi, "{revision}")
      .toLowerCase();
    const a = groups.get(key) || [];
    a.push(p);
    groups.set(key, a);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      for (
        let i = 0;
        i < Math.max(a.version?.length || 0, b.version?.length || 0);
        i++
      ) {
        const d = (b.version?.[i] || 0) - (a.version?.[i] || 0);
        if (d) return d;
      }
      return 0;
    });
    if (group[0].version?.length) group[0].recommended = true;
  }
  const older = new Set(
    [...groups.values()].flatMap((g) =>
      g[0].recommended ? g.slice(1).map((p) => p.id) : [],
    ),
  );
  return result
    .filter((p) => !older.has(p.id))
    .sort(
      (a, b) =>
        Number(!!b.recommended) - Number(!!a.recommended) ||
        designRank(b) - designRank(a) ||
        // The main design usually sits higher than sub-boards or overviews kept beside it.
        a.directory.split("/").length - b.directory.split("/").length ||
        a.id.localeCompare(b.id),
    );
}

/** Folders that hold documentation or manufacturing output, not the design itself. */
const OUTPUT_DIR = /(^|\/)(docs?|gen|generated|outputs?|exports?|fab|fabrication|production|manufactur\w*|gerbers?|cam|plots?|backups?|old|archive|obsolete)(\/|$)/i;
/**
 * Which project to offer first when a repository holds several: the design (schematic and board,
 * KiCad project first) over a stray board file in a documentation or output folder (a `.brd` there
 * is often another tool's export, not an EAGLE board).
 */
export function designRank(p: GithubProject) {
  let score = 0;
  if (p.roots.some((r) => /\.kicad_pro$/i.test(r))) score += 4;
  if (p.roots.some((r) => /\.(kicad_sch|sch|SchDoc|esch)$/i.test(r))) score += 2;
  if (p.roots.some((r) => /\.(kicad_pcb|brd|PcbDoc|epcb)$/i.test(r))) score += 2;
  if (/^eagle$/i.test(p.format) && p.roots.every((r) => /\.brd$/i.test(r))) score -= 2;
  if (OUTPUT_DIR.test(p.directory)) score -= 6;
  return score;
}
export function resolveRepoPath(parent: string, relative: string) {
  if (/^(?:[a-z]+:|\/|\\)/i.test(relative)) return null;
  const out = parent.split("/").filter(Boolean);
  for (const p of relative.replace(/\\/g, "/").split("/")) {
    if (p === "..") {
      if (!out.length) return null;
      out.pop();
    } else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}
export function referencedFiles(path: string, text: string) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const result: string[] = [];
  const re =
    /(?:\(property\s+"Sheet\s*file"\s+"([^"]+)"|\(model\s+"([^"]+)"|\(uri\s+"([^"]+)")/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[1] || m[2] || m[3];
    if (!raw || /\$\{(?!KIPRJMOD)/.test(raw)) continue;
    const resolved = resolveRepoPath(dir, raw.replace(/^\$\{KIPRJMOD\}\//, ""));
    if (resolved) result.push(resolved);
  }
  // Altium .PrjPcb: DocumentPath=Sheets\Power.SchDoc
  if (/\.PrjPcb$/i.test(path))
    for (const m of text.matchAll(/^DocumentPath\d*=(.+?)\s*$/gim)) {
      const resolved = resolveRepoPath(dir, m[1].replace(/\\/g, "/"));
      if (resolved) result.push(resolved);
    }
  // KiCad 5 hierarchical sheets: `F1 "sub.sch" 60` inside a $Sheet block.
  if (/\.sch$/i.test(path) && text.startsWith("EESchema Schematic"))
    for (const m of text.matchAll(/^F1\s+"([^"]+\.sch)"/gm)) {
      const resolved = resolveRepoPath(dir, m[1]);
      if (resolved) result.push(resolved);
    }
  return result;
}
