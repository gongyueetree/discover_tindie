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
const supported = /\.(kicad_pro|kicad_sch|kicad_pcb|sch|brd|SchDoc|PcbDoc)$/i;
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
      supported.test(f.path) &&
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
  for (const [dir, list] of byDir) {
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
          : /\.(brd|sch)$/i.test(f.path)
            ? "Eagle / legacy schematic"
            : "Altium",
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
        a.id.localeCompare(b.id),
    );
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
  return result;
}
