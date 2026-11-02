import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unzipSync, strFromU8} from 'fflate';
import {filesToInputAssets} from '../src/vendor/canon/lib/eda/archive';
import {parseEdaProject} from '../src/vendor/canon/lib/eda/parse';
import {projectPackage, canDownloadProject} from '../src/lib/maker/project-package';
async function main() {
 for(const example of ['kicad-demo','eagle-led']) {
  const {assets,diagnostics} = await filesToInputAssets([new File([readFileSync(`public/examples/${example}.zip`)], `${example}.zip`)]);
  const bundle=await parseEdaProject(assets,diagnostics);
  bundle.parts[0]={...bundle.parts[0],mpnRaw:'MIC5504-3.3YM5-TR',manufacturerRaw:'Microchip',fields:{...bundle.parts[0].fields,TindieMatchedSource:'ezplm',TindieMatchStatus:'confirmed'}};
  for(const origin of ['github','catalogue'] as const) {
   const files=unzipSync(projectPackage(bundle,assets,origin));
   for(const a of assets) assert.deepEqual(files['original/'+a.path],a.bytes);
   const bom=JSON.parse(strFromU8(files['enrichment/bom.json']));
   assert.equal(bom.parts[0].mpn,'MIC5504-3.3YM5-TR');
   assert.equal(bom.parts[0].manufacturer,'Microchip');
   assert.equal(bom.parts[0].identityStatus,'confirmed');
   assert.equal(bom.parts[0].reference,bundle.parts[0].reference);
   assert.match(strFromU8(files['enrichment/bom.csv']),/MIC5504-3.3YM5-TR/);
   assert.equal(JSON.parse(strFromU8(files['manifest.json'])).origin,origin);
  }
  assert.throws(()=>projectPackage(bundle,assets,'local'));
  assert.throws(()=>projectPackage(bundle,[],'catalogue'));
  assert.throws(()=>projectPackage(bundle,[{path:'../escape',bytes:new Uint8Array()}],'github'));
 }
 assert.equal(canDownloadProject('local'),false);
 assert.equal(canDownloadProject('github'),true);
 console.log('PASS: KiCad/Eagle source bytes, enriched CSV/JSON, origin policies, missing source and unsafe paths');
}
main().catch(e=>{console.error(e);process.exitCode=1});
