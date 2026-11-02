import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rankParts} from '../src/lib/maker/rank-parts';
import {matchRow} from '../src/lib/maker/bom';
import {boardDrills,buildBoardMeshes} from '../src/vendor/canon/lib/models/board-mesh';
import {triangulateBoard} from '../src/vendor/canon/lib/models/board-worker-client';
import {parseEdaProject} from '../src/vendor/canon/lib/eda/parse';
import {filesToInputAssets} from '../src/vendor/canon/lib/eda/archive';
import type {Part,BomRow} from '../src/lib/maker/types';
async function main(){
 const part=(mpn:string):Part=>({id:mpn,mpn,manufacturer:'Microchip Technology',description:'',source:'test',cad:[],parameters:{},offers:[]});
 const candidates=['MIC5504-2.8YM5-TR','MIC5504-1.2YM5-TR','MIC5504-3.3YM5-TR'].map(part);
 assert.equal(rankParts(candidates,'MIC5504-3.3YM5')[0].mpn,'MIC5504-3.3YM5-TR');
 assert.equal(rankParts([...candidates,part('MIC5504-3.3YM5')],'MIC5504-3.3YM5')[0].mpn,'MIC5504-3.3YM5');
 const row:BomRow={id:'1',mpn:'',manufacturer:'',package:'',reference:'U1',quantity:1,value:'MIC5504-3.3YM5',status:'unmatched',original:{}};
 const matched=matchRow(row,candidates);assert.equal(matched.candidates?.[0].mpn,'MIC5504-3.3YM5-TR');assert.equal(matched.status,'review');assert.equal(matched.selected,undefined);
 const f=await filesToInputAssets([new File([readFileSync('public/examples/kicad-demo.zip')],'demo.zip')]);const b=await parseEdaProject(f.assets,f.diagnostics);const pcb=b.pcbs[0];
 const basePad={...pcb.pads[0],position:{x:'110',y:'85',unit:'mm' as const},drill:{x:'4',y:'4'}};
 pcb.pads=[basePad,{...basePad,id:'large',drill:{x:'5',y:'5'}},{...basePad,id:'duplicate'}];pcb.vias=[];
 assert.equal(boardDrills(pcb).length,1);assert.equal(boardDrills(pcb)[0].x,5);
 pcb.pads[2]={...basePad,id:'other',position:{x:'118',y:'85',unit:'mm'}};assert.equal(boardDrills(pcb).length,2);
 const meshes=buildBoardMeshes(pcb);assert.ok(meshes.length&&meshes[0].position.length);assert.ok(meshes[0].position.every(Number.isFinite));
 const old=(globalThis as any).Worker;let terminated=0;
 class FakeWorker {onmessage?:Function;onerror?:Function;postMessage(){}terminate(){terminated++}}
 (globalThis as any).Worker=FakeWorker;
 try{await assert.rejects(triangulateBoard(pcb,new AbortController().signal,10),/too long/);assert.equal(terminated,1);const ac=new AbortController();const pending=triangulateBoard(pcb,ac.signal,1000);ac.abort();await assert.rejects(pending,/Cancelled/);assert.equal(terminated,2)}finally{(globalThis as any).Worker=old}
 if(process.env.MAKER_KEYBOARD_FIXTURE){const k=JSON.parse(readFileSync(process.env.MAKER_KEYBOARD_FIXTURE,'utf8')).pcbs[0];assert.equal(boardDrills(k).length,704);const started=performance.now();const real=buildBoardMeshes(k);assert.ok(real[0].position.every(Number.isFinite));console.log('Screenshot keyboard geometry:',Math.round(performance.now()-started),'ms,',real[0].position.length/3,'vertices');}
 console.log('Closest MPN vs voltage variant ranking, non-exact confirmation, nested/separate drills and worker timeout/cancellation passed.');
}main().catch(e=>{console.error(e);process.exitCode=1});
