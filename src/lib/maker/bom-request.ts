import type { BomRow } from "./types";
/** Never send catalogue candidates, offers or original spreadsheet cells back for matching. */
export function matchRequestRows(rows: BomRow[]) {
  return rows.map(
    ({ id, reference, quantity, value, mpn, manufacturer, package: pkg }) => ({
      id,
      reference,
      quantity,
      value,
      mpn,
      manufacturer,
      package: pkg,
      original: {},
      status: "unmatched",
    }),
  );
}
