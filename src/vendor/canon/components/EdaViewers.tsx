"use client";

import {
  Box,
  CircuitBoard,
  Download,
  Eye,
  EyeOff,
  Layers3,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useMemo, useState } from "react";
import type { CanonicalIrBundle, IrPoint, PartIr, PcbIr } from "../lib/eda/types";

import { hierarchicalPort, globalPort } from "../lib/eda/port-geometry";
import { arcPoints } from "../lib/eda/view-geometry";
import { AssemblyScene } from "./AssemblyScene";
import { easyEdaBodies, isEasyEdaStandard, pcbInMm } from "@/lib/maker/easyeda-3d";
import { modelAssets,boardAssembly } from "../lib/models/assets";
import type {InputAsset} from "../lib/eda/types";
import { BoardScene } from "./BoardScene";
import { ComponentInspector } from "./ComponentInspector";

type NumericPoint = { x: number; y: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 720;
const VIEW_PADDING = 52;

function numericPoint(value?: IrPoint): NumericPoint | undefined {
  if (!value) return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function boundsOf(points: Array<NumericPoint | undefined>): Bounds | undefined {
  const valid = points.filter((value): value is NumericPoint => Boolean(value));
  if (!valid.length) return undefined;
  const xs = valid.map((value) => value.x);
  const ys = valid.map((value) => value.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  return { minX: minX - width * 0.04, minY: minY - height * 0.04, maxX: maxX + width * 0.04, maxY: maxY + height * 0.04 };
}

function projector(bounds: Bounds, zoom: number, maxScale = Infinity, viewportWidth = VIEW_WIDTH) {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min((viewportWidth - VIEW_PADDING * 2) / width, (VIEW_HEIGHT - VIEW_PADDING * 2) / height, maxScale) * zoom;
  const contentWidth = width * scale;
  const contentHeight = height * scale;
  const offsetX = (viewportWidth - contentWidth) / 2;
  const offsetY = (VIEW_HEIGHT - contentHeight) / 2;
  return (value: NumericPoint) => ({
    x: offsetX + (value.x - bounds.minX) * scale,
    y: offsetY + (value.y - bounds.minY) * scale,
  });
}

function zoomLabel(zoom: number) {
  return `${Math.round(zoom * 100)}%`;
}

function EmptyViewer({ kind, format }: { kind: string; format: string }) {
  const altium = format === "altium";
  return (
    <div className="eda-viewer-empty">
      <CircuitBoard size={42} />
      <h3>No renderable {kind} geometry</h3>
      <p>{altium ? "No viewable geometry was produced for this Altium document. Check compatibility notes for unsupported records. PDF, BOM, netlist and STEP files can be opened for reference." : "This project has no corresponding document or supported geometry. Source files and compatibility notes remain available."}</p>
    </div>
  );
}

function ViewerToolbar({
  label,
  zoom,
  onZoom,
  children,
}: {
  label: string;
  zoom: number;
  onZoom: (next: number) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="viewer-toolbar">
      <div><Eye size={15} /><strong>{label}</strong></div>
      <div className="viewer-tools">
        {children}
        <button type="button" aria-label="Zoom out" onClick={() => onZoom(Math.max(0.2, zoom / 1.2))}><ZoomOut size={14} /></button>
        <span>{zoomLabel(zoom)}</span>
        <button type="button" aria-label="Zoom in" onClick={() => onZoom(Math.min(20, zoom * 1.2))}><ZoomIn size={14} /></button>
        <button type="button" onClick={() => onZoom(1)}><RotateCcw size={13} /> Fit view</button>
      </div>
    </div>
  );
}

export function SchematicViewer({ bundle, library = false, assets = [] }: { bundle: CanonicalIrBundle; library?: boolean; assets?:InputAsset[] }) {
  const viewWidth = library ? VIEW_HEIGHT : VIEW_WIDTH;
  const [documentIndex, setDocumentIndex] = useState(0);
  const [showPinNumbers,setShowPinNumbers] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan,setPan] = useState({x:0,y:0});
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{id:number;x:number;y:number} | null>(null);
  const resetView = () => {setZoom(1);setPan({x:0,y:0});};
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const scale = Math.min(rect.width/viewWidth,rect.height/VIEW_HEIGHT);
      if (!scale) return;
      const x = (event.clientX-rect.left-rect.width/2)/scale;
      const y = (event.clientY-rect.top-rect.height/2)/scale;
      const next = Math.max(.2,Math.min(20,zoom*Math.exp(-event.deltaY*(event.deltaMode===1?.04:.0015))));
      const ratio = next/zoom;
      setPan(p=>({x:x-(x-p.x)*ratio,y:y-(y-p.y)*ratio}));setZoom(next);
    };
    svg.addEventListener("wheel",wheel,{passive:false});
    return () => svg.removeEventListener("wheel",wheel);
  },[zoom,bundle,documentIndex,viewWidth]);
  const [selectedNetId, setSelectedNetId] = useState<string | null>(null);
  const [selectedReference,setSelectedReference]=useState<string|null>(null);
  const schematic = bundle.schematics[Math.min(documentIndex, Math.max(bundle.schematics.length - 1, 0))];
  const partsById = useMemo(() => new Map(bundle.parts.map((part) => [part.id, part])), [bundle.parts]);

  const geometry = useMemo(() => {
    if (!schematic) return undefined;
    const points = [
      ...(schematic.texts ?? []).map(t=>numericPoint(t.position)),
      ...(schematic.graphics ?? []).flatMap(g => g.points.map(numericPoint)),
      ...(schematic.sheetBoxes ?? []).flatMap(sheet => [numericPoint(sheet.position), {x: Number(sheet.position.x)+Number(sheet.size.x), y: Number(sheet.position.y)+Number(sheet.size.y)}]),
      ...schematic.wires.flatMap((wire) => wire.points.map(numericPoint)),
      ...schematic.pins.map((pin) => numericPoint(pin.position)),
      ...schematic.labels.map((label) => numericPoint(label.position)),
      ...schematic.junctions.map((junction) => numericPoint(junction.position)),
    ];
    const bounds = !library && schematic.page ? {minX:0,minY:0,maxX:schematic.page.width,maxY:schematic.page.height} : boundsOf(points);
    if (!bounds) return undefined;
    const project = projector(bounds, zoom, library ? 32 : Infinity, viewWidth);
    const wireNet = new Map<string, string>();
    for (const net of bundle.nets.filter((net) => net.domain === "schematic_logical")) {
      for (const segmentId of net.segmentIds) wireNet.set(segmentId, net.id);
    }
    return { bounds, project, wireNet };
  }, [bundle.nets, schematic, zoom, library, viewWidth]);

  if (!schematic || !geometry) return <EmptyViewer kind="schematic" format={bundle.project.sourceFormat} />;
  const documentNets = bundle.nets.filter((net) => net.domain === "schematic_logical" && net.sourceRefs.some((ref) => schematic.sourceRefs.some((source) => source.path === ref.path)));

  return (
    <article className={`panel eda-viewer-panel ${library ? "library-viewer" : ""}`}>
      <ViewerToolbar label={library ? "Symbol library preview" : `Schematic · ${schematic.name}`} zoom={zoom} onZoom={next=>{if(next===1) resetView(); else {setPan(p=>({x:p.x*next/zoom,y:p.y*next/zoom}));setZoom(next);}}}>
        <button type="button" aria-pressed={showPinNumbers} onClick={()=>setShowPinNumbers(v=>!v)}>Pin numbers {showPinNumbers?"On":"Off"}</button>
        {bundle.schematics.length > 1 && (
          <select aria-label="Choose schematic" value={documentIndex} onChange={(event) => { setDocumentIndex(Number(event.target.value)); resetView(); setSelectedNetId(null); }}>
            {bundle.schematics.map((item, index) => <option value={index} key={item.id}>{item.name}</option>)}
          </select>
        )}
      </ViewerToolbar>
      <div className={`viewer-body ${selectedReference?'has-component':''}`}>
        <div className="viewer-canvas schematic-canvas">
          <svg ref={svgRef} tabIndex={0} onPointerDown={event=>{if(event.button!==0 && event.button!==1)return;const target=event.target;if((target as Element).closest?.('.schematic-component-hit'))return;event.preventDefault();event.currentTarget.setPointerCapture?.(event.pointerId);drag.current={id:event.pointerId,x:event.clientX,y:event.clientY};}} onPointerMove={event=>{const d=drag.current;if(!d || d.id!==event.pointerId)return;const r=event.currentTarget.getBoundingClientRect();const scale=Math.min(r.width/viewWidth,r.height/VIEW_HEIGHT);if(scale) setPan(p=>({x:p.x+(event.clientX-d.x)/scale,y:p.y+(event.clientY-d.y)/scale}));drag.current={id:d.id,x:event.clientX,y:event.clientY};}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={event=>{const delta:Record<string,[number,number]>={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};if(delta[event.key]){event.preventDefault();const [x,y]=delta[event.key];setPan(p=>({x:p.x+x,y:p.y+y}));}if(event.key==="0")resetView();}} role="img" aria-label={`${schematic.name} schematic — drag to pan, scroll to zoom`} viewBox={`0 0 ${viewWidth} ${VIEW_HEIGHT}`}>
            <defs>
              <pattern id={`schematic-grid-${documentIndex}`} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dce6df" strokeWidth="1" /></pattern>
            </defs>
            {!library && <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#schematic-grid-${documentIndex})`} />}
            <g transform={`translate(${pan.x} ${pan.y})`}>
            {!library && schematic.page && (()=>{const a=geometry.project({x:10,y:10}),b=geometry.project({x:schematic.page.width-10,y:schematic.page.height-10});return <g className="schematic-page-frame" fill="none" stroke="#88734a" strokeWidth="1"><rect x={a.x} y={a.y} width={b.x-a.x} height={b.y-a.y}/><text x={b.x-8} y={b.y-8} textAnchor="end" fill="#69786e" stroke="none" fontSize="11">{schematic.page.title || schematic.name}</text></g>;})()}
            {(schematic.sheetBoxes ?? []).map(sheet => {
              const a = geometry.project(numericPoint(sheet.position)!);
              const b = geometry.project({x:Number(sheet.position.x)+Number(sheet.size.x), y:Number(sheet.position.y)+Number(sheet.size.y)});
              const sourcePath = schematic.sourceRefs[0]?.path ?? "";
              const targetPath = sourcePath.slice(0,sourcePath.lastIndexOf("/")+1)+sheet.file;
              const target = bundle.schematics.findIndex(item => item.sourceRefs.some(ref => ref.path === targetPath));
              return <g key={sheet.id} className="schematic-sheet" role={target>=0?"button":undefined} tabIndex={target>=0?0:undefined} aria-label={target>=0?`Open ${sheet.name}`:undefined} onDoubleClick={()=>{if(target>=0){setDocumentIndex(target);resetView();setSelectedNetId(null);}}} onKeyDown={event=>{if(target>=0 && event.key==="Enter"){setDocumentIndex(target);resetView();setSelectedNetId(null);}}}>
                <rect x={a.x} y={a.y} width={b.x-a.x} height={b.y-a.y} fill="#f5faf4" stroke="#88734a" strokeWidth="2" />
                <text x={a.x+8} y={a.y+18} fontSize="13">{sheet.name}</text>
                <text x={a.x+8} y={a.y+34} fontSize="10">{sheet.file}</text>
                {sheet.pins.map((pin,i) => {const p=geometry.project(numericPoint(pin.position)!); const right=p.x>(a.x+b.x)/2;return <g key={i}><circle cx={p.x} cy={p.y} r="3" fill="#247849"/><text x={p.x+(right?-7:7)} y={p.y-4} textAnchor={right?"end":"start"} fontSize="10">{pin.name}</text></g>;})}
              </g>;
            })}
            {(schematic.graphics ?? []).map(g => <polyline key={g.id} points={g.points.map(p => geometry.project(numericPoint(p)!)).map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={library ? (schematic.pins.some(pin=>g.points.length===2 && pin.position.x===g.points[0].x && pin.position.y===g.points[0].y) ? "#488aff" : "#aaaeb3") : "#9c3d35"} strokeWidth={library ? 2 : 1.5} />)}
            {schematic.wires.map((wire) => {
              const points = wire.points.map(numericPoint).filter((value): value is NumericPoint => Boolean(value)).map(geometry.project);
              const netId = geometry.wireNet.get(wire.id);
              const dimmed = selectedNetId && netId !== selectedNetId;
              return points.length >= 2 ? <polyline className={`schematic-wire ${dimmed ? "dimmed" : ""} ${netId === selectedNetId ? "selected" : ""}`} points={points.map((point) => `${point.x},${point.y}`).join(" ")} key={wire.id} /> : null;
            })}
            {Array.from(new Set(schematic.pins.map((pin) => pin.symbolUnitId))).map((unitId) => {
              if(schematic.texts?.some(t=>t.symbolUnitId===unitId))return null;
              const pins = schematic.pins.filter((pin) => pin.symbolUnitId === unitId);
              const positions = pins.map((pin) => numericPoint(pin.position)).filter((value): value is NumericPoint => Boolean(value));
              if (!positions.length) return null;
              const xs = positions.map((point) => geometry.project(point).x);
              const ys = positions.map((point) => geometry.project(point).y);
              const minX = Math.min(...xs) - 20;
              const minY = Math.min(...ys) - 15;
              const width = Math.max(Math.max(...xs) - Math.min(...xs) + 40, 54);
              const height = Math.max(Math.max(...ys) - Math.min(...ys) + 30, 34);
              const part = partsById.get(pins[0].partId);
              return <g className="schematic-symbol" key={unitId}>{!(schematic.graphics ?? []).some(g => g.symbolUnitId === unitId) && <rect x={minX} y={minY} width={width} height={height} rx="3" />}<text x={minX + 7} y={minY + 14}>{part?.reference ?? pins[0].reference}</text><text className="symbol-value" x={minX + 7} y={minY + 27}>{part?.value ?? ""}</text></g>;
            })}
            {(schematic.texts ?? []).filter(t=>showPinNumbers || t.kind!=="PinNumber").map(t=>{const p=geometry.project(numericPoint(t.position)!);const scale=geometry.project({x:1,y:0}).x-geometry.project({x:0,y:0}).x;return <text key={t.id} className="schematic-source-text" x={p.x} y={p.y} textAnchor={t.align} dominantBaseline="central" transform={`rotate(${-Number(t.rotation)} ${p.x} ${p.y})`} style={{fontSize:Number(t.size)*scale,fill:t.kind==="Reference"||t.kind==="reference"?"#254238":"#69786e"}}>{t.text}</text>;})}
            {bundle.parts.flatMap(part=>part.symbolUnits.filter(unit=>schematic.symbolInstanceIds.includes(unit.id)).flatMap(unit=>{
              const fields=(schematic.texts??[]).filter(t=>t.symbolUnitId===unit.id);
              // KiCad 10 projects commonly hide the instance Value property. The
              // IR keeps that visibility, while the online viewer shows its value.
              if(!fields.length || !part.value || fields.some(t=>t.kind.toLowerCase()==='value'))return [];
              const reference=fields.find(t=>t.kind.toLowerCase()==='reference');
              const anchor=numericPoint(reference?.position??unit.position);
              if(!anchor)return [];
              const p=geometry.project(anchor),size=Math.max(9,Number(reference?.size??1.27)*(geometry.project({x:1,y:0}).x-geometry.project({x:0,y:0}).x));
              return [<text key={`${unit.id}:fallback-value`} className="schematic-source-text symbol-value" x={p.x} y={p.y+size*1.25} textAnchor={reference?.align??'start'} dominantBaseline="central" style={{fontSize:size,fill:'#69786e'}}>{part.value}</text>];
            }))}
            {!library && bundle.parts.flatMap(part=>part.symbolUnits.filter(unit=>schematic.symbolInstanceIds.includes(unit.id)).map(unit=>{
              const points=[...(schematic.graphics??[]).filter(g=>g.symbolUnitId===unit.id).flatMap(g=>g.points),...schematic.pins.filter(p=>p.symbolUnitId===unit.id).map(p=>p.bodyPosition??p.position)];
              const projected=points.map(numericPoint).filter((p):p is NumericPoint=>!!p).map(geometry.project);
              const center=numericPoint(unit.position);if(!projected.length&&center)projected.push(geometry.project(center));if(!projected.length)return null;
              const xs=projected.map(p=>p.x),ys=projected.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(22,Math.max(...xs)-x),h=Math.max(22,Math.max(...ys)-y);
              return <rect key={unit.id} className="schematic-component-hit" data-reference={part.reference} role="button" tabIndex={0} aria-label={`View ${part.reference} details`} x={x-7} y={y-7} width={w+14} height={h+14} fill="transparent" stroke={selectedReference===part.reference?'#17a66b':'transparent'} strokeWidth="2" onPointerDown={e=>{if(e.button===0){e.stopPropagation();setSelectedReference(part.reference);}}} onClick={()=>setSelectedReference(part.reference)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelectedReference(part.reference);}}}/>;
            }))}
            {showPinNumbers && schematic.pins.filter(pin=>!pin.hidden).map(pin => { const p=geometry.project(numericPoint(pin.position)!); const texts=(schematic.texts??[]).filter(t=>t.symbolUnitId===pin.symbolUnitId); return <g className="schematic-pin" key={pin.id}>{!texts.some(t=>t.kind==="PinNumber") && <text x={p.x+4} y={p.y-5} style={{fontSize:10,fill:"#9c3d35"}}>{pin.number}</text>}{pin.name && pin.name!=="~" && !texts.some(t=>t.kind==="PinName") && <text x={p.x+4} y={p.y+11} style={{fontSize:10,fill:"#247849"}}>{pin.name}</text>}</g>; })}
            {schematic.junctions.map((junction) => { const p = geometry.project(numericPoint(junction.position)!); return <circle className="schematic-junction" cx={p.x} cy={p.y} r="4.5" key={junction.id} />; })}
            {schematic.labels.filter((label,i,all)=>all.findIndex(other=>other.name===label.name && other.position.x===label.position.x && other.position.y===label.position.y)===i).map(label=>{const p=geometry.project(numericPoint(label.textPosition??label.position)!);const scale=geometry.project({x:1,y:0}).x-geometry.project({x:0,y:0}).x;const angle=((Number(label.rotation??0)%360)+360)%360;const left=angle===180;
              if(label.kind==="global") {
                const anchor=geometry.project(numericPoint(label.position)!);const size=Number(label.size??1.27)*scale;
                const port=globalPort(label.shape,size,angle,label.name.length),r=angle*Math.PI/180;
                const tx=anchor.x+Math.cos(r)*port.textOffset,ty=anchor.y-Math.sin(r)*port.textOffset;
                return <g key={label.id} className="schematic-global-port"><polygon points={port.points.map(q=>`${anchor.x+q.x},${anchor.y+q.y}`).join(" ")} fill="#f2f4f0" stroke="#a83e54" strokeWidth={Math.max(.5,size*.08)}/><text x={tx} y={ty} textAnchor="middle" dominantBaseline="central" transform={`rotate(${angle===90||angle===270?-90:0} ${tx} ${ty})`} style={{fontSize:size,fill:"#a83e54"}}>{label.name}</text></g>;
              }
              if(label.kind==="hierarchical") {
                const anchor=geometry.project(numericPoint(label.position)!);const size=Number(label.size??1.27)*scale;
                const outline=hierarchicalPort(label.shape,size,angle);
                const textAngle=angle===90?-90:angle===270?90:0;
                const distance=size*1.4;
                const tx=anchor.x+Math.cos(angle*Math.PI/180)*distance,ty=anchor.y-Math.sin(angle*Math.PI/180)*distance;
                return <g key={label.id} className="schematic-hierarchical-port" data-shape={label.shape??"passive"}><polyline points={outline.map(q=>`${anchor.x+q.x},${anchor.y+q.y}`).join(" ")} fill="none" stroke="#88734a" strokeWidth={Math.max(.5,size*.08)}/><text className="schematic-source-text" x={tx} y={ty} transform={`rotate(${textAngle} ${tx} ${ty})`} textAnchor={left?"end":"start"} dominantBaseline="central" style={{fontSize:size,fill:"#88734a"}}>{label.name}</text></g>;
              }
              const size=Number(label.size??1.27)*scale;
              if(label.kind==="power"){
                // KiCad already provides the power symbol's native geometry and
                // Value placement. Drawing another port here doubles the glyph.
                if(label.shape==='native')return <g key={label.id} className="schematic-power-port" data-shape="native"><text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fill="#a83e54" fontSize={size}>{label.name}</text></g>;
                const anchor=geometry.project(numericPoint(label.position)!),length=Math.max(7,size*.85),ground=label.shape==='ground';
                const vertical=angle===90||angle===270;
                const distance=length+size*(ground?.8:.55),direction=-angle*Math.PI/180;
                const labelX=anchor.x+Math.cos(direction)*distance,labelY=anchor.y+Math.sin(direction)*distance+(vertical?0:-size*.85);
                return <g key={label.id} className="schematic-power-port" data-shape={label.shape??'bar'}>
                  <g transform={`translate(${anchor.x} ${anchor.y}) rotate(${-angle})`} stroke="#a83e54" strokeWidth={Math.max(1,size*.09)} fill="none">
                    <path d={`M 0 0 H ${length}`} />
                    {ground?<path d={`M ${length} ${-size*.8} V ${size*.8} M ${length+size*.38} ${-size*.55} V ${size*.55} M ${length+size*.76} ${-size*.25} V ${size*.25}`} />:label.shape==='arrow'?<path d={`M ${length-size*.6} ${-size*.6} L ${length} 0 L ${length-size*.6} ${size*.6}`}/>:label.shape==='circle'?<circle cx={length} cy="0" r={size*.48}/>:<path d={`M ${length} ${-size*.65} V ${size*.65}`}/>}
                  </g>
                  <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="central" fill="#a83e54" fontSize={size}>{label.name}</text>
                </g>;
              }
              const vertical=angle===90||angle===270;
              return <g key={label.id} className="schematic-local-label" transform={`translate(${p.x} ${p.y}) rotate(${vertical?-90:0})`}><text className="schematic-source-text" x="0" y={-size*.2} textAnchor={angle===180||angle===270?"end":"start"} style={{fontSize:size,fill:"#325c9a"}}>{label.name}</text></g>;})}
            </g>
          </svg>
        </div>
        {!library && (selectedReference?<ComponentInspector key={`${bundle.bundleId}:${selectedReference}`} bundle={bundle} inputs={assets} reference={selectedReference} onClose={()=>setSelectedReference(null)}/>:<aside className="viewer-inspector">
          <div className="inspector-title"><Layers3 size={15} /><strong>Nets</strong><span>{documentNets.length}</span></div>
          <button type="button" className={!selectedNetId ? "active" : ""} onClick={() => setSelectedNetId(null)}>Show all nets</button>
          {documentNets.slice(0, 160).map((net) => <button type="button" className={selectedNetId === net.id ? "active" : ""} title={net.canonicalName} onClick={() => setSelectedNetId(net.id)} key={net.id}><i /><span>{net.canonicalName}</span><b>{net.endpoints.length}</b></button>)}
        </aside>)}
      </div>
      <div className="viewer-status"><span>{schematic.symbolInstanceIds.length} symbols</span><span>{schematic.wires.length} wires</span><span>{schematic.labels.length} labels</span><span>{schematic.junctions.length} junctions</span><strong>Source geometry · original coordinates</strong></div>
    </article>
  );
}

function pcbBounds(pcb: PcbIr): Bounds | undefined {
  if (pcb.physicalDimensions) {
    const box = pcb.physicalDimensions.boundingBox;
    return { minX: Number(box.minX), minY: Number(box.minY), maxX: Number(box.maxX), maxY: Number(box.maxY) };
  }
  const geometryPoints = pcb.boardOutline.flatMap((item) => ["start", "mid", "end", "center"].map((key) => numericPoint(item.geometry[key] as IrPoint | undefined)));
  return boundsOf([
    ...geometryPoints,
    ...pcb.footprints.map((item) => numericPoint(item.position)),
    ...pcb.pads.flatMap(item => {
      const p=numericPoint(item.position);if(!p)return [];
      const r=Number(item.rotation??0)*Math.PI/180,c=Math.abs(Math.cos(r)),s=Math.abs(Math.sin(r));
      const x=(Number(item.size?.x??0)*c+Number(item.size?.y??0)*s)/2;
      const y=(Number(item.size?.x??0)*s+Number(item.size?.y??0)*c)/2;
      return [{x:p.x-x,y:p.y-y},{x:p.x+x,y:p.y+y}];
    }),
    ...pcb.footprints.flatMap(fp=>(fp.graphics??[]).flatMap(g=>{
      const p=numericPoint(fp.position);if(!p)return [];
      const r=-Number(fp.rotation??0)*Math.PI/180;
      return ['start','mid','end','center'].flatMap(k=>{const q=numericPoint(g.geometry[k] as IrPoint|undefined);return q?[{x:p.x+q.x*Math.cos(r)-q.y*Math.sin(r),y:p.y+q.x*Math.sin(r)+q.y*Math.cos(r)}]:[];});
    })),
    ...pcb.tracks.flatMap((item) => [numericPoint(item.start), numericPoint(item.mid), numericPoint(item.end)]),
    ...pcb.vias.map((item) => numericPoint(item.position)),
  ]);
}

function layerColor(layer = "") {
  if (/^F\.|top/i.test(layer)) return "#d94d45";
  if (/^B\.|bottom/i.test(layer)) return "#3978c7";
  if (/inner|in\d+\.cu/i.test(layer)) return "#c69a32";
  return "#7d8d84";
}

function outlineElement(item: PcbIr["boardOutline"][number], project: (point: NumericPoint) => NumericPoint) {
  const start = numericPoint(item.geometry.start as IrPoint | undefined);
  const end = numericPoint(item.geometry.end as IrPoint | undefined);
  if (item.kind === "line" && start && end) {
    const a = project(start); const b = project(end);
    return <line className="pcb-outline" x1={a.x} y1={a.y} x2={b.x} y2={b.y} key={item.id} />;
  }
  if (item.kind === "rectangle" && start && end) {
    const a = project(start); const b = project(end);
    return <rect className="pcb-outline" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} key={item.id} />;
  }
  if (item.kind === "circle") {
    const center = numericPoint(item.geometry.center as IrPoint | undefined) ?? start;
    if (center && end) {
      const c = project(center); const e = project(end);
      return <circle className="pcb-outline" cx={c.x} cy={c.y} r={Math.hypot(e.x - c.x, e.y - c.y)} key={item.id} />;
    }
  }
  if (item.kind === "arc" && start && end) {
    const a = project(start); const b = project(end);
    const mid = numericPoint(item.geometry.mid as IrPoint | undefined);
    if (mid) return <polyline className="pcb-outline" points={arcPoints(start, mid, end).map(project).map(p => `${p.x},${p.y}`).join(" ")} key={item.id} />;
    return <path className="pcb-outline" d={`M ${a.x} ${a.y} A ${Math.max(Math.abs(b.x - a.x), 12)} ${Math.max(Math.abs(b.y - a.y), 12)} 0 0 1 ${b.x} ${b.y}`} key={item.id} />;
  }
  return null;
}

export function PcbViewer({ bundle, library = false, assets = [] }: { bundle: CanonicalIrBundle; library?: boolean; assets?:InputAsset[] }) {
  const viewWidth = library ? VIEW_HEIGHT : VIEW_WIDTH;
  const [documentIndex, setDocumentIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan,setPan]=useState({x:0,y:0});
  const svgRef=useRef<SVGSVGElement>(null),drag=useRef<{id:number;x:number;y:number}|null>(null);
  const resetView=()=>{setZoom(1);setPan({x:0,y:0});};
  useEffect(()=>{const svg=svgRef.current;if(!svg)return;
   const wheel=(event:WheelEvent)=>{event.preventDefault();const rect=svg.getBoundingClientRect(),scale=Math.min(rect.width/viewWidth,rect.height/VIEW_HEIGHT);if(!scale)return;
    const x=(event.clientX-rect.left-rect.width/2)/scale,y=(event.clientY-rect.top-rect.height/2)/scale,next=Math.max(.2,Math.min(20,zoom*Math.exp(-event.deltaY*(event.deltaMode===1?.04:.0015)))),ratio=next/zoom;
    setPan(p=>({x:x-(x-p.x)*ratio,y:y-(y-p.y)*ratio}));setZoom(next);
   };svg.addEventListener('wheel',wheel,{passive:false});return()=>svg.removeEventListener('wheel',wheel);
  },[zoom,viewWidth,documentIndex]);
  const [showLabels, setShowLabels] = useState(library);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [selectedNetId, setSelectedNetId] = useState<string | null>(null);
  const [selectedReference,setSelectedReference]=useState<string|null>(null);
  const pcb = bundle.pcbs[Math.min(documentIndex, Math.max(bundle.pcbs.length - 1, 0))];
  const bounds = pcb ? pcbBounds(pcb) : undefined;
  if (!pcb || !bounds) return <EmptyViewer kind="PCB" format={bundle.project.sourceFormat} />;
  const project = projector(bounds, zoom, library ? 100 : Infinity, viewWidth);
  const scale = project({x:1,y:0}).x-project({x:0,y:0}).x;
  const footprintById = new Map(pcb.footprints.map((footprint) => [footprint.id, footprint]));
  const chooseNet = (id?:string|null) => {setSelectedReference(null);setSelectedNetId(id || null);};
  const choosePart = (reference:string) => {setSelectedNetId(null);setSelectedReference(reference);};
  const netById = new Map(bundle.nets.map(net=>[net.id,net]));
  const selectedNet = netById.get(selectedNetId ?? "");
  const netPads = pcb.pads.filter(pad=>pad.netId===selectedNetId);
  const netReferences = [...new Set(netPads.map(pad=>footprintById.get(pad.footprintId ?? "")?.reference).filter((ref):ref is string=>!!ref))];
  const isVisible = (layer?: string) => !layer || !hiddenLayers.has(layer);
  const toggleLayer = (layer: string) => setHiddenLayers((current) => { const next = new Set(current); if (next.has(layer)) next.delete(layer); else next.add(layer); return next; });

  return (
    <article className={`panel eda-viewer-panel ${library ? "library-viewer" : ""}`}>
      <ViewerToolbar label={library ? "Footprint library preview · mm" : `PCB 2D · ${pcb.name}`} zoom={zoom} onZoom={next=>{if(next===1)resetView();else{setPan(p=>({x:p.x*next/zoom,y:p.y*next/zoom}));setZoom(next);}}}>
        <button type="button" aria-pressed={showLabels} onClick={() => setShowLabels(v => !v)}>Pad labels {showLabels ? "On" : "Off"}</button>
        {bundle.pcbs.length > 1 && <select aria-label="Choose PCB" value={documentIndex} onChange={(event) => { setDocumentIndex(Number(event.target.value)); setSelectedNetId(null);setSelectedReference(null);resetView(); }}>
          {bundle.pcbs.map((item, index) => <option value={index} key={item.id}>{item.name}</option>)}
        </select>}
      </ViewerToolbar>
      {library && <details className="library-layer-options"><summary>Layers and colors</summary><div className="library-layers" aria-label="Footprint layers">{[...new Set(pcb.footprints.flatMap(f=>(f.graphics??[]).map(g=>g.layer)))].map(layer=><button type="button" key={layer} aria-pressed={isVisible(layer)} onClick={()=>toggleLayer(layer)}>{layer}</button>)}<span>Pads {pcb.pads.length} · Copper: blue / Silkscreen: gray / Courtyard: purple / Fabrication: orange</span></div></details>}
      <div className={`viewer-body ${selectedReference || selectedNetId?'has-component':''}`}>
        <div className="viewer-canvas pcb-canvas">
          <svg ref={svgRef} tabIndex={0} onPointerDown={event=>{if(event.button!==0&&event.button!==1)return;const target=event.target;if((target as Element).closest?.('.pcb-component-hit'))return;event.currentTarget.setPointerCapture?.(event.pointerId);drag.current={id:event.pointerId,x:event.clientX,y:event.clientY};}} onPointerMove={event=>{const d=drag.current;if(!d||d.id!==event.pointerId)return;const r=event.currentTarget.getBoundingClientRect(),s=Math.min(r.width/viewWidth,r.height/VIEW_HEIGHT);if(s)setPan(p=>({x:p.x+(event.clientX-d.x)/s,y:p.y+(event.clientY-d.y)/s}));drag.current={id:d.id,x:event.clientX,y:event.clientY};}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onKeyDown={e=>{const delta:Record<string,[number,number]>={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};if(delta[e.key]){e.preventDefault();setPan(p=>({x:p.x+delta[e.key][0],y:p.y+delta[e.key][1]}));}if(e.key==='0')resetView();}} role="img" aria-label={`${pcb.name} PCB — drag to pan, scroll to zoom, select component`} viewBox={`0 0 ${viewWidth} ${VIEW_HEIGHT}`}>
            <defs><pattern id={`pcb-grid-${documentIndex}`} width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#36574c" /></pattern></defs>
            <rect width={viewWidth} height={VIEW_HEIGHT} fill={library ? "#ffffff" : "#10241f"} />
            {!library && <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#pcb-grid-${documentIndex})`} opacity=".42" />}
            <g transform={`translate(${pan.x} ${pan.y})`}>
            {pcb.boardOutline.map((item) => outlineElement(item, project))}
            {!library && pcb.footprints.map(fp=>{const center=numericPoint(fp.position);if(!center)return null;
              const pads=pcb.pads.filter(p=>p.footprintId===fp.id),coordinates=[center,...pads.map(p=>numericPoint(p.position)).filter((p):p is NumericPoint=>!!p)];
              const projected=coordinates.map(project),xs=projected.map(p=>p.x),ys=projected.map(p=>p.y),padRadius=Math.max(2,...pads.map(p=>Math.max(Number(p.size?.x??0),Number(p.size?.y??0))*scale/2));
              const minX=Math.min(...xs)-padRadius,minY=Math.min(...ys)-padRadius,w=Math.max(4,Math.max(...xs)-Math.min(...xs)+padRadius*2),h=Math.max(4,Math.max(...ys)-Math.min(...ys)+padRadius*2);
              return <rect key={fp.id} className="pcb-component-hit" data-reference={fp.reference} role="button" tabIndex={0} aria-label={`View ${fp.reference} details`} x={minX} y={minY} width={w} height={h} fill="transparent" stroke={selectedReference===fp.reference?'#68e493':'transparent'} strokeWidth="2" onPointerDown={e=>{if(e.button===0){e.stopPropagation();choosePart(fp.reference);}}} onClick={()=>choosePart(fp.reference)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choosePart(fp.reference);}}}/>;
            })}
            {pcb.tracks.filter((track) => isVisible(track.layer)).map((track) => {
              const start = numericPoint(track.start); const end = numericPoint(track.end);
              if (!start || !end) return null;
              const a = project(start); const b = project(end);
              const selected = !selectedNetId || track.netId === selectedNetId;
              const points = track.kind === "arc" && track.mid ? arcPoints(start,numericPoint(track.mid)!,end).map(project) : [a,b];
              const path = points.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ');
              return <g key={track.id} role="button" tabIndex={0} aria-label={`Select net ${netById.get(track.netId ?? '')?.canonicalName || track.netId || 'unassigned'}`}
                onPointerDown={e=>e.stopPropagation()} onClick={()=>chooseNet(track.netId)}
                onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseNet(track.netId);}}}>
                <path d={path} fill="none" stroke="transparent" strokeWidth={Math.max(Number(track.width || .25)*scale,8)} style={{cursor:'pointer'}}/>
                <path d={path} className={`pcb-track ${selected ? "" : "dimmed"}`} stroke={selectedNetId===track.netId?'#8fffc0':layerColor(track.layer)} strokeWidth={Math.max(Number(track.width || .25)*scale,.3)} pointerEvents="none"/>
              </g>;

            })}
            {pcb.pads.filter((pad) => pad.layers.some(isVisible) || !pad.layers.length).map((pad) => {
              const position = numericPoint(pad.position); if (!position) return null;
              const p = project(position); const sizeX = Math.max(Number(pad.size?.x ?? 1.2) * scale, .3); const sizeY = Math.max(Number(pad.size?.y ?? 1.2) * scale, .3);
              const selected = !selectedNetId || pad.netId === selectedNetId;
              return <g className={`pcb-pad ${selected ? "" : "dimmed"} ${(selectedNetId && selected) || selectedReference===footprintById.get(pad.footprintId ?? "")?.reference ? "net-selected" : ""}`} key={pad.id} role="button" tabIndex={0}
                aria-label={`Select pad ${pad.number} net ${pad.netName || 'unassigned'}`}
                onPointerDown={e=>e.stopPropagation()} onClick={()=>chooseNet(pad.netId)}
                onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseNet(pad.netId);}}}><title>{`${footprintById.get(pad.footprintId ?? "")?.reference ?? ""}.${pad.number} · ${pad.netName ?? ""}`}</title><g transform={`rotate(${-Number(pad.rotation ?? 0)} ${p.x} ${p.y})`}><rect x={p.x - sizeX / 2} y={p.y - sizeY / 2} width={sizeX} height={sizeY} rx={/circle|oval/i.test(pad.shape) ? Math.min(sizeX, sizeY) / 2 : pad.shape === "roundrect" ? Math.min(sizeX,sizeY)*.2 : 0} />{pad.drill && <ellipse cx={p.x} cy={p.y} rx={Number(pad.drill.x)*scale/2} ry={Number(pad.drill.y)*scale/2} fill={library ? "#ffffff" : "#10241f"} />}</g>{(showLabels || !!selectedNetId && selected) && <text x={library ? p.x : p.x + sizeX / 2 + 2} y={library ? p.y : p.y + 3} textAnchor={library ? "middle" : undefined} dominantBaseline={library ? "central" : undefined} style={library ? {fontSize:Math.max(1,Math.min(sizeY*.65,sizeX/(Math.max(pad.number.length,1)*.7),28)),fill:"#fff5a3"} : undefined}>{library ? pad.number : `${footprintById.get(pad.footprintId ?? "")?.reference}.${pad.number}`}</text>}</g>;
            })}
            {pcb.vias.map((via) => { const position = numericPoint(via.position); if (!position) return null; const p = project(position); return <g className={`pcb-via ${selectedNetId && via.netId !== selectedNetId ? "dimmed" : ""}`} key={via.id} onPointerDown={e=>e.stopPropagation()} onClick={()=>chooseNet(via.netId)}><circle cx={p.x} cy={p.y} r={Math.max(Number(via.size ?? 0.8) * scale / 2, .2)} /><circle cx={p.x} cy={p.y} r={Math.max(Number(via.drill ?? 0.35) * scale / 2, .1)} /></g>; })}
            {pcb.footprints.map(footprint => {const position=numericPoint(footprint.position);if(!position)return null;const p=project(position);return <g className="pcb-source-graphics" pointerEvents="none" key={footprint.id} transform={`translate(${p.x} ${p.y}) rotate(${-Number(footprint.rotation)})`}>{(footprint.graphics ?? []).filter(g=>isVisible(g.layer)&&/SilkS|Fab|CrtYd/.test(g.layer)).map(g=><g key={g.id} data-layer={g.layer}>{outlineElement(g,v=>({x:v.x*scale,y:v.y*scale}))}</g>)}</g>;})}
            {showLabels && !library && pcb.footprints.map(footprint => {const position=numericPoint(footprint.position);if(!position)return null;const p=project(position);return <text key={footprint.id} x={p.x} y={p.y-10} fill="#eee" fontSize="10" textAnchor="middle">{footprint.reference}</text>;})}

            </g>
          </svg>
        </div>
        {!library && (selectedReference?<ComponentInspector key={`${bundle.bundleId}:${selectedReference}`} bundle={bundle} inputs={assets} reference={selectedReference} onClose={()=>setSelectedReference(null)}/>:<aside className="viewer-inspector">
          {selectedNetId && <section className="pcb-net-details">
            <strong>{selectedNet?.canonicalName || netPads[0]?.netName || selectedNetId}</strong>
            <button type="button" onClick={()=>chooseNet(null)}>Clear selection</button>
            <p>{netPads.length} pads · {netReferences.length} components</p>
            {netReferences.map(reference=><details open key={reference}><summary>{reference}</summary>
              {netPads.filter(pad=>footprintById.get(pad.footprintId ?? '')?.reference===reference).map(pad=><button type="button" key={pad.id} onClick={()=>choosePart(reference)}>{reference} · Pad {pad.number}</button>)}
            </details>)}
          </section>}
          <div className="inspector-title"><Layers3 size={15} /><strong>Layers</strong><span>{pcb.layers.length}</span></div>
          {pcb.layers.slice(0, 32).map((layer) => <button type="button" className={hiddenLayers.has(layer.name) ? "muted-layer" : "active"} onClick={() => toggleLayer(layer.name)} key={layer.id}>{hiddenLayers.has(layer.name) ? <EyeOff size={12} /> : <Eye size={12} />}<span>{layer.name}</span><i style={{ background: layerColor(layer.name) }} /></button>)}
          <div className="inspector-title net-inspector-title"><Layers3 size={15} /><strong>Highlight net</strong></div>
          <select aria-label="Highlight PCB net" value={selectedNetId ?? ""} onChange={(event) => chooseNet(event.target.value)}><option value="">All nets</option>{bundle.nets.filter((net) => net.domain === "pcb_physical").map((net) => <option value={net.id} key={net.id}>{net.canonicalName}</option>)}</select>
        </aside>)}
      </div>
      <div className="viewer-status"><span>{pcb.layers.filter((layer) => layer.copper).length} copper layers</span><span>{pcb.footprints.length} footprints</span><span>{pcb.pads.length} pads</span><span>{pcb.tracks.length} tracks</span><strong>{pcb.physicalDimensions ? `${pcb.physicalDimensions.width} × ${pcb.physicalDimensions.height} × ${pcb.physicalDimensions.thickness ?? "?"} mm` : "Dimensions unavailable"}</strong></div>
    </article>
  );
}

export function Board3DViewer({ bundle,assets=[],active=true }: { bundle: CanonicalIrBundle;assets?:InputAsset[];active?:boolean }) {
  const [index,setIndex]=useState(0),[choice,setChoice]=useState("auto");
  const pcb=bundle.pcbs[Math.min(index,Math.max(0,bundle.pcbs.length-1))];
  // Tindie: EasyEDA Standard boards are in 10 mil with EasyEDA layer names; 3D gets millimetres and body envelopes (easyeda-3d.ts).
  const easy=useMemo(()=>pcb&&isEasyEdaStandard(pcb)?{pcb:pcbInMm(pcb),bodies:easyEdaBodies(pcb,assets)}:null,[pcb,assets]);
  if(!pcb)return <EmptyViewer kind="3D PCB" format={bundle.project.sourceFormat}/>;
  const models=modelAssets(assets),assembly=boardAssembly(pcb,models);
  const selected=choice==="auto"?undefined:models.find(a=>a.path===choice);
  return <article className="panel board-3d-panel"><div className="viewer-toolbar"><strong>PCB 3D · {pcb.name}</strong><select aria-label="Choose 3D board" value={index} onChange={e=>{setIndex(Number(e.target.value));setChoice("auto");}}>{bundle.pcbs.map((p,i)=><option key={p.id} value={i}>{p.name}</option>)}</select><select aria-label="Choose model" value={choice} onChange={e=>setChoice(e.target.value)}><option value="auto">PCB + source silkscreen + component models</option><option value="ir">Board and pads only</option>{models.map(a=><option key={a.path} value={a.path}>Model: {a.path}</option>)}</select></div>{selected?<AssemblyScene key={selected.path} asset={selected} active={active}/>:<BoardScene key={`${pcb.id}-${choice}`} pcb={easy?.pcb??pcb} assets={assets} components={choice!=="ir"} active={active} fallbackBodies={choice!=="ir"?easy?.bodies:undefined}/>}<div className="viewer-status">{selected?"Shows source solids and colours. Verify assembly model revision against the board.":"Loads included models. Unavailable models are listed; a board-only view is not a complete component assembly."}</div></article>;
}

type BomRow = {
  key: string;
  quantity: number;
  references: string[];
  value: string;
  footprint: string;
  manufacturer: string;
  mpn: string;
  variant: PartIr["variantStatus"];
};

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadText(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function BomViewer({ bundle }: { bundle: CanonicalIrBundle }) {
  const [query, setQuery] = useState("");
  const [variant, setVariant] = useState("all");
  const rows = useMemo(() => {
    const groups = new Map<string, BomRow>();
    for (const part of bundle.parts) {
      const key = [part.mpnRaw || "", part.value, part.footprint || "", part.variantStatus].join("|").toLowerCase();
      const row = groups.get(key) ?? { key, quantity: 0, references: [], value: part.value, footprint: part.footprint ?? "", manufacturer: part.manufacturerRaw ?? "", mpn: part.mpnRaw ?? "", variant: part.variantStatus };
      row.quantity += 1; row.references.push(part.reference); groups.set(key, row);
    }
    return Array.from(groups.values()).sort((left, right) => left.references[0].localeCompare(right.references[0], undefined, { numeric: true }));
  }, [bundle.parts]);
  const filtered = rows.filter((row) => (variant === "all" || row.variant === variant) && [row.value, row.footprint, row.manufacturer, row.mpn, row.references.join(" ")].join(" ").toLowerCase().includes(query.toLowerCase()));
  const exportCsv = () => {
    const lines = [["Item", "Qty", "References", "Value", "Footprint", "Manufacturer", "MPN", "Variant"], ...filtered.map((row, index) => [index + 1, row.quantity, row.references.join(" "), row.value, row.footprint, row.manufacturer, row.mpn, row.variant])];
    downloadText(`\ufeff${lines.map((line) => line.map(csvCell).join(",")).join("\n")}`, `${bundle.project.name.replace(/\W+/g, "-")}-bom.csv`, "text/csv;charset=utf-8");
  };

  return (
    <article className="panel table-panel bom-panel">
      <div className="viewer-toolbar"><div><Box size={15} /><strong>Bill of materials</strong><span className="preview-badge">{rows.length} line items · {bundle.parts.length} instances</span></div><div className="viewer-tools"><label className="viewer-search"><Search size={13} /><input aria-label="Search BOM" placeholder="RefDes / Value / MPN" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="BOM assembly status" value={variant} onChange={(event) => setVariant(event.target.value)}><option value="all">All assembly states</option><option value="fitted">Fitted</option><option value="dnp">DNP</option><option value="optional">Optional</option><option value="variant_excluded">Excluded</option><option value="unknown">Unknown</option></select><button type="button" onClick={exportCsv}><Download size={14} /> Download CSV</button></div></div>
      <div className="data-table"><table><thead><tr><th>Item</th><th>Qty</th><th>References</th><th>Value</th><th>Footprint</th><th>Manufacturer</th><th>MPN</th><th>Variant</th></tr></thead><tbody>{filtered.map((row, index) => <tr key={row.key}><td>{index + 1}</td><td><strong>{row.quantity}</strong></td><td><strong className="refdes bom-refs">{row.references.join(", ")}</strong></td><td>{row.value || "—"}</td><td>{row.footprint || <span className="muted">unresolved</span>}</td><td>{row.manufacturer || "—"}</td><td><code>{row.mpn || "—"}</code></td><td><span className={`variant ${row.variant}`}>{row.variant}</span></td></tr>)}</tbody></table></div>
      {!filtered.length && <div className="table-empty">No BOM rows match your filters.</div>}
    </article>
  );
}

export function NetlistToolbar({ bundle, query, onQuery }: { bundle: CanonicalIrBundle; query: string; onQuery: (value: string) => void }) {
  const exportCsv = () => {
    const lines = [["Domain", "Net", "Endpoint Type", "Reference", "Pin/Pad", "Target ID"], ...bundle.nets.flatMap((net) => net.endpoints.length ? net.endpoints.map((endpoint) => [net.domain, net.canonicalName, endpoint.type, endpoint.identifier.reference ?? endpoint.identifier.name ?? "", endpoint.identifier.pin ?? endpoint.identifier.pad ?? "", endpoint.targetId ?? ""]) : [[net.domain, net.canonicalName, "", "", "", ""]])];
    downloadText(`\ufeff${lines.map((line) => line.map(csvCell).join(",")).join("\n")}`, `${bundle.project.name.replace(/\W+/g, "-")}-netlist.csv`, "text/csv;charset=utf-8");
  };
  return <div className="netlist-tools"><label className="viewer-search"><Search size={13} /><input aria-label="Search netlist" placeholder="Net / RefDes / Pin" value={query} onChange={(event) => onQuery(event.target.value)} /></label><button type="button" onClick={exportCsv}><Download size={14} /> Download netlist CSV</button></div>;
}

