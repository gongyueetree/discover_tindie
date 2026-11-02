'use client';
import type {CanonicalIrBundle,InputAsset} from '../lib/eda/types';
export function ComponentInspector({bundle,reference,onClose}:{bundle:CanonicalIrBundle;inputs:InputAsset[];reference:string;onClose:()=>void}){
 const part=bundle.parts.find(p=>p.reference===reference),fp=bundle.pcbs.flatMap(p=>p.footprints).find(p=>p.reference===reference);
 return <aside className="viewer-inspector"><div className="section-top"><h3>{reference}</h3><button onClick={onClose} aria-label="Close component">×</button></div><dl><dt>Value</dt><dd>{part?.value||fp?.value||'Not specified'}</dd><dt>Manufacturer</dt><dd>{part?.manufacturerRaw||'Not specified'}</dd><dt>MPN</dt><dd>{part?.mpnRaw||'Not specified'}</dd><dt>Footprint</dt><dd>{part?.footprint||fp?.libraryIdentifier||'Not linked'}</dd></dl><a className="btn" href={`/tools/components?q=${encodeURIComponent(part?.mpnRaw||part?.value||fp?.value||'')}`}>Look up component ↗</a></aside>
}
