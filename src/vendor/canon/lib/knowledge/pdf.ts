// @ts-nocheck — eelib's knowledge/pdf.ts reads PDF text with pdfjs-dist. Tindie's viewer does not use PDF
// evidence, so this stub keeps the parser's contract (a document record, status SKIPPED) without
// shipping pdf.js. Project PDFs are still listed as files.
import type { InputAsset, SourceAsset } from "../eda/types";
import type { PdfEvidenceDocument } from "./types";
export async function extractPdfEvidence(input: InputAsset, asset: SourceAsset): Promise<PdfEvidenceDocument> {
  return {
    assetId: asset.id,
    path: input.path,
    sha256: asset.sha256,
    parserVersion: "tindie-skip/1.0.0",
    status: "FAILED",
    pages: [],
    connectivityStatus: "NOT_RECONSTRUCTED",
    error: "PDF text is not extracted on this site",
  };
}
