import assert from 'node:assert/strict';
import {buildComponentGraph,GraphDesign} from '../src/lib/maker/component-graph';
const designs:GraphDesign[]=[
 {id:'1',projectId:'p1',projectName:'One',bom:{items:[{mpn:'IC-A',manufacturer:'A'},{mpn:'IC-A',manufacturer:'A'},{mpn:'IC-B'},{mpn:'DNP',dnp:true},{mpn:'10k'},{mpn:'100n'},{mpn:'4k7'},{mpn:'1N4148'},{value:'10k',keyKind:'none'}]}},
 {id:'2',projectId:'p1',projectName:'One revision',bom:{items:[{mpn:'IC-A',manufacturer:'A'}]}},
 {id:'3',projectId:'p2',projectName:'Two',bom:{items:[{mpn:'IC-A',manufacturer:'A'},{value:'IC-C',keyKind:'exact'},{mpn:'IC-A',manufacturer:'B'}]}},
 {id:'4',projectName:'Withdrawn',withdrawn:true,bom:{items:[{mpn:'X'}]}}
];
const g=buildComponentGraph(designs);
assert.equal(g.nodes.find(n=>n.label==='IC-A'&&n.manufacturer==='A')?.count,2);
assert.equal(g.nodes.length,5);assert.ok(g.nodes.some(n=>n.label==='1N4148')); assert.equal(g.projects,2);
const b=g.nodes.findIndex(n=>n.label==='IC-B');const a=g.nodes.findIndex(n=>n.label==='IC-A'&&n.manufacturer==='A');
const e=g.edges.find(e=>[e.a,e.b].includes(a)&&[e.a,e.b].includes(b))!;
assert.equal(e.weight,1);assert.equal(e.jaccard,.5);
assert.equal(buildComponentGraph(designs,'IC-C').nodes[0].label,'IC-C');
assert.equal(g.nodes.find(n=>n.label==='IC-C')?.identity,'BOM value · MPN unverified');
assert.deepEqual(buildComponentGraph([]).nodes,[]);
console.log('Graph deduplication, project frequency, manufacturer separation, DNP exclusion, identity provenance and Jaccard checks passed.');
const familyGraph=buildComponentGraph([
 {id:'a',projectId:'p1',projectName:'A',bom:{items:[{mpn:'STM32G031K8T6',footprint:'LQFP-32'},{mpn:'STM32G031G8U6',manufacturer:'ST',footprint:'UFQFPN-28'},{mpn:'CH340G'}]}},
 {id:'b',projectId:'p1',projectName:'A rev',bom:{items:[{mpn:'STM32G031K8T6',manufacturer:'STMicroelectronics'},{mpn:'CH340G'}]}},
 {id:'c',projectId:'p2',projectName:'B',bom:{items:[{mpn:'STM32G031F6P6'},{mpn:'CH340G'}]}},
 {id:'d',projectId:'p3',projectName:'C',bom:{items:[{mpn:'STM32G030K8T6'},{mpn:'STM32G031K8T6',manufacturer:'Other vendor'},{mpn:'UNKNOWN-A'},{mpn:'UNKNOWN-B'}]}}
],'STM32G031G8U6');
const family=familyGraph.nodes[0];
assert.equal(family.label,'STM32G031');assert.equal(family.count,2);assert.equal(family.variants.length,3);assert.equal(family.variants.find(v=>v.mpn==='STM32G031K8T6')?.projects.length,1);assert.deepEqual(family.variants.find(v=>v.mpn==='STM32G031G8U6')?.footprints,['UFQFPN-28']);
assert.ok(familyGraph.nodes.some(n=>n.label==='STM32G030'));
assert.ok(familyGraph.nodes.some(n=>n.label==='STM32G031K8T6'&&n.manufacturer==='Other vendor'));
assert.ok(familyGraph.nodes.some(n=>n.label==='UNKNOWN-A'));assert.ok(familyGraph.nodes.some(n=>n.label==='UNKNOWN-B'));
const c=familyGraph.nodes.findIndex(n=>n.label==='CH340G');const shared=familyGraph.edges.find(e=>e.a===0&&e.b===c)!;assert.equal(shared.weight,2);assert.equal(shared.jaccard,1);assert.ok(familyGraph.edges.every(e=>e.a!==e.b));
console.log('Family merging, variant provenance, manufacturer alias, non-merging boundaries, family focus and deduplicated family edges passed.');
