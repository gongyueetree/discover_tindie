import { atom, childValue, directChildren, firstChild, parseSExpression, rootExpression, type SList } from '@/vendor/canon/lib/eda/sexpr';

/** Preserve KiCad library typography in millimetres, never scale text by body size. */
export function applySymbolTypography(preview:any, source:string) {
  const root=rootExpression(parseSExpression(source));
  if(!root)return preview;
  const symbols=directChildren(root,'symbol');
  const symbol=symbols.find(s=>atom(s.items[1])===preview.name) ?? (symbols.length===1?symbols[0]:undefined);
  if(!symbol)return preview;
  const chain:SList[]=[];
  let current:SList|undefined=symbol;
  while(current&&!chain.includes(current)) {
    chain.unshift(current);
    const parent=childValue(current,'extends');
    current=parent?symbols.find(s=>atom(s.items[1])===parent):undefined;
  }
  const settings=(name:string)=>[...chain].reverse().map(s=>firstChild(s,name)).find(Boolean);
  const names=settings('pin_names'), numbers=settings('pin_numbers');
  const hidden=(node:SList|undefined)=>node?.items.some(n=>atom(n)==='hide')??false;
  const child=(node:SList|undefined,key:string)=>node?firstChild(node,key):undefined;
  const value=(node:SList|undefined,key:string)=>node?childValue(node,key):undefined;
  const size=(pin:SList,kind:string)=>Number(value(child(child(child(pin,kind),'effects'),'font'),'size')||1.27);
  const pins=new Map<string,object>();
  for(const owner of chain)for(const unit of directChildren(owner,'symbol'))for(const pin of directChildren(unit,'pin')) {
    const number=childValue(pin,'number');
    if(number)pins.set(number,{nameSize:size(pin,'name'),numberSize:size(pin,'number'),nameOffset:Number(value(names,'offset')??0.508),hideName:hidden(names),hideNumber:hidden(numbers)});
  }
  const enrich=(part:any)=>({...part,pins:part.pins?.map((p:any)=>({...p,...pins.get(p.number)}))});
  return {...enrich(preview),parts:preview.parts?.map(enrich)};
}
