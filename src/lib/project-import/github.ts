import { AsyncLocalStorage } from "node:async_hooks";
import type { ArtifactManifest, RepositorySummary } from "./types";

const GITHUB_API = "https://api.github.com";
const githubTokenContext = new AsyncLocalStorage<string>();

export function withGithubAccessToken<T>(token: string, fn: () => Promise<T>) {
  return githubTokenContext.run(token, fn);
}

function githubHeaders(accept = "application/vnd.github+json", token?: string) {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "tindie-project-import-agent",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const authToken = token || githubTokenContext.getStore() || process.env.GITHUB_TOKEN;
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

async function githubJson<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders("application/vnd.github+json", token),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.json() as Promise<T>;
}

async function githubText(path: string, token?: string): Promise<string> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders("application/vnd.github.raw+json", token),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return "";
  return response.text();
}

interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  default_branch: string;
  updated_at: string;
  language: string | null;
  stargazers_count: number;
  private: boolean;
}

interface TreeResponse {
  tree: Array<{
    path: string;
    type: "blob" | "tree";
    size?: number;
  }>;
  truncated?: boolean;
}

export async function listGithubRepositories(owner: string, search = "", token?: string) {
  const normalizedOwner = owner.trim();
  if (!normalizedOwner) return [] as RepositorySummary[];

  let repos: GithubRepo[];
  const authToken = token || githubTokenContext.getStore() || process.env.GITHUB_TOKEN;
  if (authToken) {
    try {
      const all = await githubJson<GithubRepo[]>(
        "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
        authToken
      );
      repos = all.filter(
        (repo) => repo.owner.login.toLowerCase() === normalizedOwner.toLowerCase()
      );
      if (!repos.length) {
        repos = await githubJson<GithubRepo[]>(
          `/users/${encodeURIComponent(normalizedOwner)}/repos?per_page=100&sort=updated`,
          authToken
        );
      }
    } catch {
      repos = await githubJson<GithubRepo[]>(
        `/users/${encodeURIComponent(normalizedOwner)}/repos?per_page=100&sort=updated`
      );
    }
  } else {
    repos = await githubJson<GithubRepo[]>(
      `/users/${encodeURIComponent(normalizedOwner)}/repos?per_page=100&sort=updated`
    );
  }

  const q = search.trim().toLowerCase();
  return repos
    // Public mode uses the deployment's token: never show a repository only that token can read.
    // (Connected-installation listings use listGithubInstallationRepositories, not this function.)
    .filter((repo) => !repo.private)
    .filter((repo) => {
      if (!q) return true;
      return `${repo.name} ${repo.description ?? ""}`.toLowerCase().includes(q);
    })
    .slice(0, 30)
    .map<RepositorySummary>((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner.login,
      description: repo.description ?? "",
      htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch,
      updatedAt: repo.updated_at,
      language: repo.language,
      stars: repo.stargazers_count,
      private: repo.private,
    }));
}

export async function loadGithubProject(owner: string, repo: string, token?: string) {
  const safeOwner = encodeURIComponent(owner.trim());
  const safeRepo = encodeURIComponent(repo.trim());
  const metadata = await githubJson<GithubRepo>(`/repos/${safeOwner}/${safeRepo}`, token);
  // Only a connected installation's own token (passed in, or set with withGithubAccessToken) may read a
  // private repository. The deployment-wide GITHUB_TOKEN serves public projects only.
  if (metadata.private && !token && !githubTokenContext.getStore())
    throw new Error("GitHub API 404: this repository is not public. Connect the GitHub account that owns it.");
  const readme = await githubText(`/repos/${safeOwner}/${safeRepo}/readme`, token);

  let files: Array<{ path: string; type: "blob" | "tree"; size?: number }> = [];
  try {
    const tree = await githubJson<TreeResponse>(
      `/repos/${safeOwner}/${safeRepo}/git/trees/${encodeURIComponent(metadata.default_branch)}?recursive=1`,
      token
    );
    files = tree.tree ?? [];
  } catch {
    const root = await githubJson<Array<{ path: string; type: "file" | "dir"; size?: number }>>(
      `/repos/${safeOwner}/${safeRepo}/contents`,
      token
    );
    files = root.map((item) => ({
      path: item.path,
      type: item.type === "file" ? "blob" : "tree",
      size: item.size,
    }));
  }

  return {
    metadata: {
      id: metadata.id,
      name: metadata.name,
      fullName: metadata.full_name,
      owner: metadata.owner.login,
      description: metadata.description ?? "",
      htmlUrl: metadata.html_url,
      defaultBranch: metadata.default_branch,
      updatedAt: metadata.updated_at,
      language: metadata.language,
      stars: metadata.stargazers_count,
      private: metadata.private,
    } satisfies RepositorySummary,
    readme,
    files,
  };
}

function countBy(paths: string[], predicate: (path: string) => boolean) {
  return paths.reduce((count, path) => count + (predicate(path) ? 1 : 0), 0);
}

export function buildArtifactManifest(
  files: Array<{ path: string; type: "blob" | "tree"; size?: number }>,
  hasReadme: boolean
): ArtifactManifest {
  const paths = files.filter((file) => file.type === "blob").map((file) => file.path);
  const lower = paths.map((path) => path.toLowerCase());

  const schematic = countBy(lower, (path) => /\.(kicad_sch|sch|dsn)$/.test(path));
  const pcb = countBy(lower, (path) => /\.(kicad_pcb|pcb|brd)$/.test(path));
  const bom = countBy(lower, (path) =>
    /(^|\/)(bom|bill[-_ ]?of[-_ ]?materials?)[^/]*\.(csv|xlsx?|tsv|json|xml)$/i.test(path) ||
    /(^|\/)[^/]*bom[^/]*\.(csv|xlsx?|tsv|json|xml)$/i.test(path)
  );
  const gerber = countBy(lower, (path) =>
    /\.(gbr|ger|gtl|gbl|gto|gbo|gts|gbs|gm1|drl)$/.test(path) || path.includes("gerber")
  );
  const firmware = countBy(lower, (path) =>
    path.startsWith("firmware/") || path.includes("/firmware/") || /\.(ino|uf2|hex|elf)$/.test(path)
  );
  const cad = countBy(lower, (path) => /\.(step|stp|stl|scad|f3d)$/.test(path));
  const images = countBy(lower, (path) =>
    /\.(png|jpe?g|webp|gif)$/.test(path) && !/(badge|logo|icon|avatar|shield)/.test(path)
  );
  const docs = countBy(lower, (path) =>
    (path.startsWith("docs/") || path.includes("/docs/") || path.includes("manual")) &&
    /\.(md|pdf|rst|txt|html?)$/.test(path)
  );
  const examples = countBy(lower, (path) =>
    path.startsWith("examples/") || path.includes("/examples/") || path.startsWith("example/")
  );

  const evidenceFiles = paths
    .filter((path) => {
      const p = path.toLowerCase();
      return (
        /readme/i.test(path) ||
        /\.(kicad_sch|kicad_pcb|sch|pcb|brd)$/.test(p) ||
        /bom/i.test(path) ||
        /\.(step|stp|pdf)$/.test(p)
      );
    })
    .slice(0, 12);

  return {
    totalFiles: paths.length,
    readme: hasReadme,
    schematic,
    pcb,
    bom,
    gerber,
    firmware,
    cad,
    images,
    docs,
    examples,
    evidenceFiles,
  };
}

