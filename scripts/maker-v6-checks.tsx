import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {createDemoFiles,filesToInputAssets} from '../src/vendor/canon/lib/eda/archive';import {parseEdaProject} from '../src/vendor/canon/lib/eda/parse';import {SchematicViewer} from '../src/vendor/canon/components/EdaViewers';import {matchRequestRows} from '../src/lib/maker/bom-request';import {terminology,hasChinese} from '../src/lib/maker/english';
(globalThis as any).React=React;
async function main(){
const {assets,diagnostics}=await filesToInputAssets(createDemoFiles());const b=await parseEdaProject(assets,diagnostics);b.schematics[0].pins[0].name='TEST_PIN_NAME';
const svg=renderToStaticMarkup(<SchematicViewer bundle={b}/>);assert.match(svg,/Pin numbers On/);assert.match(svg,/TEST_PIN_NAME/);
const rows=Array.from({length:10},(_,i)=>({id:String(i),reference:'U'+i,quantity:1,value:'MCU',mpn:'STM32F103C8T6',manufacturer:'ST',package:'LQFP48',original:{large:'x'.repeat(200000)},candidates:[{description:'x'.repeat(100000)}],status:'review'}));
assert.ok(JSON.stringify({rows}).length>100000);const payload=matchRequestRows(rows as any);assert.ok(JSON.stringify({rows:payload}).length<10000);assert.equal(payload[0].mpn,rows[0].mpn);assert.ok(!('candidates' in payload[0]));
for(const s of ['CPU核心 - ARM Cortex/8051/PIC核心','功耗模式 - 低功耗模式种类/电流','ADC规格 - ADC通道数/分辨率','Mainstream High-performance 系列Arm Cortex-M3 MCU, 配有64 KB Flash memory, 电机控制'])assert.ok(!hasChinese(terminology(s)));
console.log('PASS: default pin labels, pin name fallback, repeated-match request size, screenshot terminology');}
main().catch(e=>{console.error(e);process.exitCode=1});
