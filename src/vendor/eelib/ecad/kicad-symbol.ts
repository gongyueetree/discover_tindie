// @ts-nocheck — vendored from eelib (eelib-bff/src/refir/core/design-assets/kicad.ts), trimmed to symbolDefinition.
import { atom, childValue, directChildren, head, type SExpr, type SList } from './sexpr';
const span={start:0,end:0,line:1,column:1};
const a=(value:string,quoted=false):SExpr=>({kind:'atom',value,quoted,span});
function clone(n:SList):SList{return structuredClone(n);}
export function symbolDefinition(root:SList,name:string,seen=new Set<string>()):SList|undefined{
 if(seen.has(name))throw Error('SYMBOL_INHERITANCE_CYCLE');seen.add(name);
 const node=directChildren(root,'symbol').find(n=>atom(n.items[1])===name);if(!node)return;
 const result=clone(node),parent=childValue(result,'extends');
 if(parent){const base=symbolDefinition(root,parent,seen);if(!base)throw Error('SYMBOL_PARENT_MISSING: '+parent);
 const ownProps=new Set(directChildren(result,'property').map(n=>atom(n.items[1])));
 const ownHeads=new Set(directChildren(result).filter(n=>!['property','extends'].includes(head(n)!)).map(head));
 const inherited=directChildren(base).filter(n=>head(n)==='property'?!ownProps.has(atom(n.items[1])):!ownHeads.has(head(n)));
 result.items=result.items.filter(n=>head(n)!=='extends');result.items.push(...inherited);
 }
 const entry=name.split(':').at(-1)!;result.items[1]=a(entry,true);
 for(const sub of directChildren(result,'symbol')){const suffix=atom(sub.items[1])?.match(/_(\d+_\d+)$/)?.[1];if(suffix)sub.items[1]=a(`${entry}_${suffix}`,true);}
 return result;
}
