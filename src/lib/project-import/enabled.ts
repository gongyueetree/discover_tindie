import { NextResponse } from "next/server";

/**
 * The legacy seller project import is off unless PROJECT_IMPORT_ENABLED=1. The middleware already
 * answers 404; every handler checks again so a middleware change or bypass cannot re-open it.
 * Do not enable it before its private-repository scope and connection revocation are completed
 * (DISCOVER_TABS.md §22, R07).
 */
export function projectImportDisabled(): NextResponse | null {
  return process.env.PROJECT_IMPORT_ENABLED === "1" ? null : NextResponse.json({ error: "Not found" }, { status: 404 });
}
