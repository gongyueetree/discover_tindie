import "server-only";
import { cookies } from "next/headers";
import { PREVIEW_COOKIE, toolsAllowed, toolsPublic } from "./visibility";

/** Server pages: whether this visitor sees the new tabs (see visibility.ts). */
export async function canSeeTools() {
  if (toolsPublic()) return true;
  let role: string | undefined;
  try {
    const { auth } = await import("@/lib/auth");
    role = ((await auth())?.user as { role?: string } | undefined)?.role;
  } catch {
    role = undefined;
  }
  return toolsAllowed(role, cookies().get(PREVIEW_COOKIE)?.value);
}
