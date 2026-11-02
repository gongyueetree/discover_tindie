import { strToU8, zipSync } from "fflate";
import type {
  CanonicalIrBundle,
  InputAsset,
} from "@/vendor/canon/lib/eda/types";
import { csvCell } from "./download";

export type ProjectOrigin = "local" | "github" | "catalogue" | "example";
export const canDownloadProject = (origin: ProjectOrigin) => origin !== "local";

/** Source files are preserved byte-for-byte; enriched identities are sidecars. */
export function projectPackage(
  bundle: CanonicalIrBundle,
  assets: InputAsset[],
  origin: ProjectOrigin,
) {
  if (!canDownloadProject(origin))
    throw Error("Local uploads do not need a project download.");
  if (!assets.length)
    throw Error(
      "Original project files are unavailable. No archive was created.",
    );
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const a of assets) {
    const path = a.path.replace(/\\/g, "/");
    if (
      !path ||
      path.startsWith("/") ||
      /^[a-z]:/i.test(path) ||
      path.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw Error("Invalid project file path.");
    const key = `original/${path}`;
    if (files[key]) throw Error("Duplicate project file path.");
    files[key] = a.bytes;
  }
  const parts = bundle.parts
    .filter((p) => !p.reference.startsWith("#"))
    .map((p) => ({
      id: p.id,
      reference: p.reference,
      value: p.value,
      quantity: 1,
      mpn: p.mpnRaw || "",
      manufacturer: p.manufacturerRaw || "",
      footprint: p.footprint || "",
      assembly: p.variantStatus,
      matchSource: p.fields.TindieMatchedSource || "",
      identityStatus: p.fields.TindieMatchStatus || "source",
      fields: p.fields,
      sourceRefs: p.sourceRefs,
    }));
  const columns = [
    "id",
    "reference",
    "value",
    "quantity",
    "mpn",
    "manufacturer",
    "footprint",
    "assembly",
    "matchSource",
    "identityStatus",
  ] as const;
  files["enrichment/bom.csv"] = strToU8(
    "\uFEFF" +
      [
        columns.map(csvCell).join(","),
        ...parts.map((p) => columns.map((c) => csvCell(p[c])).join(",")),
      ].join("\r\n"),
  );
  files["enrichment/bom.json"] = strToU8(
    JSON.stringify(
      { schemaVersion: 1, project: bundle.project.name, parts },
      null,
      2,
    ),
  );
  files["manifest.json"] = strToU8(
    JSON.stringify(
      {
        schemaVersion: 1,
        project: bundle.project.name,
        origin,
        exportedAt: new Date().toISOString(),
        sourceFiles: assets.map((a) => a.path),
        enrichedComponents: parts.filter((p) => p.matchSource).length,
        sourceFilesModified: false,
      },
      null,
      2,
    ),
  );
  files["README.txt"] = strToU8(
    "Tindie Maker Tools project package\n\noriginal/: original engineering files, dependencies and supplied licenses.\nenrichment/bom.csv and bom.json: current component identities, including applied exact or manually confirmed matches. Unconfirmed search candidates are excluded. Source identities are retained where no match was applied.\n\nMPN/manufacturer enrichment is stored in the BOM sidecars, not written into native CAD files. Use component IDs, references and sourceRefs to associate records with the design.\n",
  );
  return zipSync(files);
}
