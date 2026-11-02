import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filesToInputAssets} from '../src/vendor/canon/lib/eda/archive';
import {drawSchematic} from '../src/vendor/eelib/kicad-schematic';
async function main(){
 const {assets}=await filesToInputAssets([new File([readFileSync('public/examples/kicad-demo.zip')],'demo.zip')]);
 const file=assets.find(a=>a.path.endsWith('.kicad_sch'))!;
 const drawing=drawSchematic(new TextDecoder().decode(file.bytes),file.path,'Demo',new Map()).drawing;
 const pins=Object.values(drawing.netPins||{}).flat();
 assert.ok(pins.length>0);assert.ok(pins.every(p=>p.reference && p.number));
 const connected=Object.values(drawing.netPins||{}).find(p=>p.length>1);assert.ok(connected,'A real connected net should expose source pin identities');
 console.log('Native schematic net connectivity retains references and pin numbers:',pins.map(p=>`${p.reference}.${p.number}`).join(', '));
}
main().catch(e=>{console.error(e);process.exit(1);});
