// @ts-nocheck — vendored from canon-eda-ir-agent (REFIR); see ../NOTICE.md. Typed access goes through ../core-api.ts.
import * as CFB from "cfb";
import { Unzlib } from "fflate";
import type { InputAsset, PcbIr } from "./types";
import { altiumBlocks, altiumProperties } from "./altium-records";

type Stream = (name: string) => Uint8Array;
const mm = (s = "0") => Number.parseFloat(s) * (/mm$/i.test(s) ? 1 : .0254);
const truth = (s?: string) => s === "TRUE" || s === "T";
const key = (s: string) => s.trim().toUpperCase();
const pathFor = (id: string) => `altium-embed://${encodeURIComponent(key(id))}.step`;

/** Body coordinates are absolute AD coordinates. Normalize them to the same
 * local KiCad convention used by placeFootprintModel, including bottom faces.
 * Format reference: KiCad Altium ComponentBodies6 importer.
 */
export function attachAltiumModels(stream: Stream, pcb: PcbIr) {
  const catalog = new Map(altiumBlocks(stream("Models/Data")).map(altiumProperties).filter(p=>p.ID).map(p=>[key(p.ID),p]));
  const bytes = stream("ComponentBodies6/Data");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pending: Array<{fp: PcbIr["footprints"][number]; model: NonNullable<PcbIr["footprints"][number]["models"]>[number]}> = [];
  let offset = 0, skipped = 0, extruded = 0;
  while(offset < bytes.length) {
    if(offset+5>bytes.length || bytes[offset++]!==12) throw Error("无效 ComponentBodies6 记录");
    const length=view.getUint32(offset,true)&0xffffff; offset+=4;
    if(length<22 || offset+length>bytes.length) throw Error("截断的 ComponentBodies6 记录");
    const component=view.getUint16(offset+7,true), propsLength=view.getUint32(offset+18,true)&0xffffff;
    if(propsLength>length-22) throw Error("截断的 Body 属性");
    const start=offset;
    const p=altiumProperties(bytes.subarray(offset+22,offset+22+propsLength)); offset+=length;
    const fp=pcb.footprints[component], model=catalog.get(key(p.MODELID||""));
    if(!fp || !model || !truth(p["MODEL.EMBED"]) || !truth(model.EMBED)) {
      // A body with no model of its own — extruded, a cylinder or a sphere — drawn from its outline and heights (local change: ../../NOTICE.md).
      const body=fp?bodyOf(p,view,start+22+propsLength,start+length):null;
      if(body){(fp.bodies3d??=[]).push(body);extruded++;} else skipped++;
      continue;
    }
    let dx=mm(p["MODEL.2D.X"])-Number(fp.position?.x??0);
    let dy=mm(p["MODEL.2D.Y"])+Number(fp.position?.y??0);
    let dz=mm(p["MODEL.3D.DZ"]), rx=Number(p["MODEL.3D.ROTX"]||0), rz=Number(p["MODEL.3D.ROTZ"]||0);
    const ry=Number(p["MODEL.3D.ROTY"]||0), bottom=fp.side==="back";
    const angle=Number(fp.rotation)*(bottom?-1:1), radians=-angle*Math.PI/180;
    if(bottom) dy=-dy;
    if((p.BODYPROJECTION==="1")!==bottom){rx+=180;rz=-rz;dz=-Number(pcb.physicalDimensions?.thickness??1.6)-dz;}
    [dx,dy]=[dx*Math.cos(radians)-dy*Math.sin(radians),dx*Math.sin(radians)+dy*Math.cos(radians)];
    const rotation=[-rx,-ry,-rz+Number(p["MODEL.2D.ROTATION"]||0)+angle];
    if(![dx,dy,dz,...rotation].every(Number.isFinite)) throw Error("无效模型坐标");
    pending.push({fp,model:{path:pathFor(p.MODELID),offset:[dx,dy,dz],rotation,scale:[1,1,1],hidden:false,...(p["MODEL.NAME"]?.trim()?{name:p["MODEL.NAME"].trim()}:{})}});
  }
  for(const {fp,model} of pending) (fp.models??=[]).push(model);
  return {attached:pending.length,skipped,extruded};
}

const BGR = (value?: string) => {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n < 0 || n > 0xffffff) return undefined;
  return `#${[n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff].map(c => c.toString(16).padStart(2, "0")).join("")}`;
};
const MAX_BODY_VERTICES = 2000;

/**
 * A ComponentBodies6 body without an embedded model (local change:
 * ../../NOTICE.md): `MODEL.MODELTYPE` 0 extruded (its outline — a count, then
 * x, y doubles in 1/10000 mil after the properties — between STANDOFFHEIGHT
 * and OVERALLHEIGHT), 2 a cylinder (MODEL.CYLINDER.RADIUS, .HEIGHT, at the
 * model's 2D position), 3 a sphere (MODEL.SPHERE.RADIUS). The face is the
 * body's projection (BODYPROJECTION 1: the board's bottom). Null for anything
 * else (an external STEP model this file does not carry).
 */
export function bodyOf(p: Record<string, string>, view: DataView, at: number, end: number) {
  const kind = Number(p["MODEL.MODELTYPE"] ?? -1);
  if (![0, 2, 3].includes(kind)) return null;
  const side = p.BODYPROJECTION === "1" ? "bottom" : "top";
  const color = BGR(p.BODYCOLOR3D);
  const opacity = p.BODYOPACITY3D === undefined ? undefined : Math.min(1, Math.max(0, Number(p.BODYOPACITY3D) || 0));
  const standoff = Math.max(0, mm(p.STANDOFFHEIGHT));
  const style = { side, ...(color ? { color } : {}), ...(opacity !== undefined && opacity < 1 ? { opacity } : {}) };
  const centre: [number, number] = [mm(p["MODEL.2D.X"]), -mm(p["MODEL.2D.Y"])];
  if (kind === 2 || kind === 3) {
    const radius = mm(kind === 2 ? p["MODEL.CYLINDER.RADIUS"] : p["MODEL.SPHERE.RADIUS"]);
    if (!(radius > 0) || !centre.every(Number.isFinite)) return null;
    if (kind === 3) return { kind: "sphere", outline: [], standoff, height: standoff + radius * 2, center: centre, radius, ...style };
    const height = mm(p["MODEL.CYLINDER.HEIGHT"]);
    if (!(height > 0)) return null;
    const outline = Array.from({ length: 24 }, (_, i) => [centre[0] + radius * Math.cos((i / 24) * Math.PI * 2), centre[1] + radius * Math.sin((i / 24) * Math.PI * 2)]);
    return { kind: "cylinder", outline, standoff, height: standoff + height, ...style };
  }
  if (at + 4 > end) return null;
  const count = view.getUint32(at, true);
  if (count < 3 || count > MAX_BODY_VERTICES || at + 4 + count * 16 > end) return null;
  const outline: [number, number][] = [];
  for (let i = 0; i < count; i++) outline.push([view.getFloat64(at + 4 + i * 16, true) * 0.00000254, -view.getFloat64(at + 12 + i * 16, true) * 0.00000254]);
  const height = mm(p.OVERALLHEIGHT);
  if (!outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) || !(height > standoff)) return null;
  return { kind: "extruded", outline, standoff, height, ...style };
}

export function unpackAltiumModel(packed: Uint8Array, limit=32*1024*1024): Uint8Array {
  let size=0; const chunks: Uint8Array[]=[];
  const unzip=new Unzlib(chunk=>{size+=chunk.length;if(size>limit)throw Error("AD 模型展开体积超限");chunks.push(chunk);});
  for(let i=0;i<packed.length;i+=1024) unzip.push(packed.subarray(i,i+1024),i+1024>=packed.length);
  if(!size)throw Error("空 AD 模型");
  const result=new Uint8Array(size);let cursor=0;for(const chunk of chunks){result.set(chunk,cursor);cursor+=chunk.length;}
  if(!new TextDecoder().decode(result.subarray(0,512)).includes("ISO-10303-21"))throw Error("AD 嵌入模型不是受支持的 STEP 文件");
  return result;
}

export function altiumEmbeddedModels(source: InputAsset): InputAsset[] {
  if(source.bytes.length>64*1024*1024)throw Error("AD 容器超过 64 MiB");
  const c=CFB.read(source.bytes,{type:"array"});
  const stream:Stream=name=>{const i=c.FullPaths.findIndex(p=>p.toLowerCase().endsWith("/"+name.toLowerCase()));return i<0?new Uint8Array():new Uint8Array(c.FileIndex[i].content as Uint8Array);};
  let total=0;
  const seen=new Set<string>();
  return altiumBlocks(stream("Models/Data")).map(altiumProperties).flatMap((p,index)=>{
    // A model listed twice (Altium keeps one entry per rotation it was placed with) is the same file: read once.
    if(!p.ID || !truth(p.EMBED) || seen.has(key(p.ID)))return [];
    seen.add(key(p.ID));
    const packed=stream("Models/"+index);if(!packed.length)return [];
    // One model that is not STEP (a Parasolid body), or past the limits, is left out — not every model of the board
    // with it (local change: ../../NOTICE.md).
    let bytes: Uint8Array;
    try { bytes=unpackAltiumModel(packed,Math.min(32*1024*1024,150*1024*1024-total)); } catch { return []; }
    total+=bytes.length;
    return [{path:pathFor(p.ID),bytes}];
  });
}
