import type { InputAsset } from '../eda/types';
export type AssetKind = 'symbol' | 'footprint' | 'model';
export type Origin = { project: string; bundleId: string; path: string; sourceHash: string; reference: string; nativeId?: string };
export type OfficialMatch = { status: 'match' | 'different' | 'found' | 'missing' | 'unknown' | 'unmapped'; name: string; revision?: string; url?: string; sha256?: string; fingerprint?: string; message?: string };
export type DesignAsset = {
 id: string; kind: AssetKind; name: string; mpn: string; manufacturer: string; identityConfirmed: boolean; identityScope?: string;
 fingerprint: string; fileHash?: string; fileName?: string; size?: number; format: string;
 dependencies?: Array<{path:string;fileHash?:string;offset:number[];scale:number[];rotation:number[]}>;
 origins: Origin[]; warnings: string[]; official?: OfficialMatch;
 /** Local addition (../../NOTICE.md): how the file came to be, and from where. */
 basis?: AssetBasis; provenance?: AssetProvenance;
};
/** Local addition (../../NOTICE.md): `converted` — written from the design's own library (EAGLE); `standard_by_package` — KiCad's standard model for the package, never the part's own. */
export type AssetBasis = 'converted' | 'standard_by_package';
/** Where a converted file or a matched model came from: the format, the design's library and entry, the licence that library declares (null when none), the rule that matched a model. */
export type AssetProvenance = { format: 'eagle'; library: string; entry: string; licence: string | null; rule?: string };
export type ExtractedAsset = DesignAsset & { file?: InputAsset };
export type AssetRecord = DesignAsset & { status: 'CANDIDATE' | 'APPROVED' | 'REJECTED'; revision: number; storage: 'file' | 'official'; sourceUrl: string; license: string; reviewNote: string };
export const identityKey = (manufacturer:string,mpn:string) => JSON.stringify([manufacturer.trim().toUpperCase(),mpn.trim().toUpperCase()]);
export const originKey = (o:Origin) => JSON.stringify([o.bundleId,o.path,o.reference,o.nativeId]);
