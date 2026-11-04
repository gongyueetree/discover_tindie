import crypto from "node:crypto";
import type { GithubConnection, RepositorySummary } from "./types";

const GITHUB_API = "https://api.github.com";

function appId() {
  return process.env.GITHUB_APP_ID?.trim() || "";
}

function appSlug() {
  return process.env.GITHUB_APP_SLUG?.trim() || "";
}

function privateKey() {
  return (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
}

export function isGithubAppConfigured() {
  return Boolean(appId() && appSlug() && privateKey());
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function createGithubAppJwt() {
  if (!isGithubAppConfigured()) {
    throw new Error("GitHub App is not configured.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iat: now - 30,
      exp: now + 8 * 60,
      iss: appId(),
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey());
  return `${unsigned}.${base64url(signature)}`;
}

async function appJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${createGithubAppJwt()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tindie-project-import-agent",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub App API ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.json() as Promise<T>;
}

interface InstallationResponse {
  id: number;
  account: {
    login?: string;
    name?: string;
    avatar_url?: string;
    type?: string;
  } | null;
  repository_selection?: "all" | "selected";
  target_type?: string;
}

export async function getGithubInstallationConnection(
  installationId: number,
  connectedAt = new Date().toISOString()
): Promise<GithubConnection> {
  const installation = await appJson<InstallationResponse>(`/app/installations/${installationId}`);
  const login = installation.account?.login || installation.account?.name || `Installation ${installationId}`;
  return {
    id: `github:${installationId}`,
    installationId,
    accountLogin: login,
    accountType: installation.account?.type || installation.target_type || "Account",
    avatarUrl: installation.account?.avatar_url || null,
    repositorySelection: installation.repository_selection || "unknown",
    connectedAt,
  };
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

export async function createGithubInstallationToken(installationId: number) {
  const result = await appJson<InstallationTokenResponse>(
    `/app/installations/${installationId}/access_tokens`,
    { method: "POST" }
  );
  return result.token;
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

export async function listGithubInstallationRepositories(
  installationId: number,
  search = ""
): Promise<RepositorySummary[]> {
  const token = await createGithubInstallationToken(installationId);
  const response = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tindie-project-import-agent",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub repository API ${response.status}: ${body.slice(0, 240)}`);
  }
  const payload = (await response.json()) as { repositories?: GithubRepo[]; total_count?: number };
  const q = search.trim().toLowerCase();
  return (payload.repositories || [])
    .filter((repo) => !q || `${repo.name} ${repo.description || ""}`.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 50)
    .map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner.login,
      description: repo.description || "",
      htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch,
      updatedAt: repo.updated_at,
      language: repo.language,
      stars: repo.stargazers_count,
      private: repo.private,
    }));
}

export function githubInstallUrl(state: string) {
  if (!isGithubAppConfigured()) throw new Error("GitHub App is not configured.");
  const url = new URL(`https://github.com/apps/${appSlug()}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}


/**
 * Whether the GitHub user who just authorised the App can access this installation.
 * GitHub's setup URL carries `installation_id` as a plain query parameter that anyone can change
 * (https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url);
 * the App's own credentials only prove the installation exists. With "Request user authorization
 * (OAuth) during installation" enabled, the callback also gets a `code`: exchanged for a user token,
 * it lists the installations that user can access. Without the OAuth client settings or a code this
 * returns false, so the connection is refused.
 */
export async function userCanAccessInstallation(code: string, installationId: number): Promise<boolean> {
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !code || code.length > 200) return false;
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenRes.ok || !tokenJson.access_token) return false;
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`https://api.github.com/user/installations?per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${tokenJson.access_token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Tindie-Project-Import" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!r.ok) return false;
    const d = (await r.json()) as { installations?: { id: number }[] };
    const list = d.installations || [];
    if (list.some((i) => i.id === installationId)) return true;
    if (list.length < 100) break;
  }
  return false;
}
