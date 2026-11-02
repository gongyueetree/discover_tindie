// @ts-nocheck — vendored from canon-eda-ir-agent (REFIR); see ../NOTICE.md. Typed access goes through ../core-api.ts.
type Props = Record<string, string>;
const decoder = new TextDecoder("windows-1252");
export function altiumProperties(data: Uint8Array): Props {
  const result: Props = Object.create(null);
  for (const entry of decoder.decode(data).replace(/\0+$/, "").split("|")) {
    const i = entry.indexOf("=");
    if (i > 0) result[entry.slice(0, i).toUpperCase()] = entry.slice(i + 1);
  }
  // UTF-8 properties override their legacy code-page equivalents.
  for (const entry of new TextDecoder().decode(data).replace(/\0+$/, "").split("|")) {
    const i = entry.indexOf("=");
    if (entry.startsWith("%UTF8%") && i > 6) result[entry.slice(6, i).toUpperCase()] = entry.slice(i + 1);
  }
  // A PcbDoc writes a field's Unicode text as its UTF-16 code units, `UNICODE__PATTERN=88,84,…`, beside the
  // code-page bytes (local change: ../../NOTICE.md): a footprint named in Chinese reads as written, not as mojibake.
  for (const key of Object.keys(result)) {
    if (!key.startsWith("UNICODE__") || key.length <= 9 || !/^\s*\d/.test(result[key])) continue;
    const units = result[key].split(",").map((unit) => Number(unit.trim()));
    if (units.length && units.length <= 65536 && units.every((unit) => Number.isInteger(unit) && unit >= 0 && unit <= 0xffff)) {
      let text = "";
      for (let at = 0; at < units.length; at += 8192) text += String.fromCharCode(...units.slice(at, at + 8192));
      result[key.slice(9)] = text.replace(/\0+$/, "");
    }
  }
  return result;
}
/**
 * A schematic's records, read as far as they go (local change: ../../NOTICE.md):
 * an empty record keeps its place (owner indices count it), a binary record
 * (the length word's top byte set, as a library's pins are written) is marked
 * and kept in place, and a record cut short ends the list there instead of
 * losing the whole sheet — `truncated` says so.
 */
export function altiumRecordList(data: Uint8Array): { records: { bytes: Uint8Array; binary: boolean }[]; truncated: boolean } {
  const records: { bytes: Uint8Array; binary: boolean }[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset < data.length;) {
    if (records.length >= 200000) throw new Error("Invalid or excessive AD records");
    if (offset + 4 > data.length) return { records, truncated: data.subarray(offset).some((byte) => byte !== 0) };
    const word = view.getUint32(offset, true);
    const size = word & 0xffffff;
    offset += 4;
    if (offset + size > data.length) return { records, truncated: true };
    records.push({ bytes: data.subarray(offset, offset + size), binary: word >>> 24 !== 0 });
    offset += size;
  }
  return { records, truncated: false };
}

export function altiumBlocks(data: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset < data.length;) {
    if (offset + 4 > data.length || out.length >= 100000) throw new Error("Invalid or excessive AD records");
    const size = view.getUint32(offset, true) & 0xffffff;
    offset += 4;
    if (!size || offset + size > data.length) throw new Error("Truncated AD record");
    out.push(data.subarray(offset, offset + size)); offset += size;
  }
  return out;
}

