import crypto from "node:crypto";
import type { GithubConnection } from "./types";

export const CONNECTION_COOKIE = "tindie_project_connections";
export const CONNECTION_STATE_COOKIE = "tindie_project_connection_state";

interface ConnectionCookiePayload {
  version: 1;
  github: GithubConnection[];
}

function secret() {
  return (
    process.env.CONNECTION_SIGNING_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.GITHUB_APP_CLIENT_SECRET ||
    ""
  );
}

function signature(payload: string) {
  const key = secret();
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function encodeConnections(github: GithubConnection[]) {
  const payload: ConnectionCookiePayload = { version: 1, github };
  const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signature(raw);
  // Without a signing secret no connection can be stored (an unsigned cookie would be forgeable).
  return sig ? `${raw}.${sig}` : "";
}

export function decodeConnections(value: string | undefined | null): GithubConnection[] {
  if (!value) return [];
  try {
    const [raw, sig] = value.split(".");
    if (!raw) return [];
    const expected = signature(raw);
    // No signing secret configured: accept nothing (fail closed).
    if (!expected) return [];
    {
      if (!sig) return [];
      const actualBuffer = Buffer.from(sig);
      const expectedBuffer = Buffer.from(expected);
      if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
        return [];
      }
    }
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ConnectionCookiePayload;
    if (parsed.version !== 1 || !Array.isArray(parsed.github)) return [];
    return parsed.github.filter((item) => Number.isFinite(item.installationId));
  } catch {
    return [];
  }
}

export function createConnectionState() {
  return crypto.randomBytes(24).toString("base64url");
}

export function safeReturnPath(input: string | null | undefined) {
  if (!input || !input.startsWith("/") || input.startsWith("//")) return "/seller/import-project";
  return input;
}

