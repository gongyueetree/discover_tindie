import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/maker/[...path]/route';
import { hasChinese } from '../src/lib/maker/english';
async function main() {
 const saved = globalThis.fetch;
 const key = process.env.AZURE_TRANSLATOR_KEY;
 try {
  delete process.env.AZURE_TRANSLATOR_KEY;
  const t=await POST(new NextRequest('http://localhost/api/maker/translate',{method:'POST',body:JSON.stringify({texts:['低噪声, 90 MHz可变 Gain amplifier','AD603AR-REEL 3.3V']})}),{params:{path:['translate']}});
  const text=(await t.json()).texts;
  assert.equal(t.status,200);assert.ok(!hasChinese(text[0]));assert.ok(text[0].includes('90 MHz'));assert.equal(text[1],'AD603AR-REEL 3.3V');
  const invalid=await POST(new NextRequest('http://localhost/api/maker/translate',{method:'POST',body:JSON.stringify({texts:[{}]})}),{params:{path:['translate']}});assert.equal(invalid.status,400);
  console.log('PASS: BOM English conversion preserves MPN/units; translation rejects invalid input.');
 } finally {globalThis.fetch=saved;if(key===undefined)delete process.env.AZURE_TRANSLATOR_KEY;else process.env.AZURE_TRANSLATOR_KEY=key;}
}
main().catch(e=>{console.error(e);process.exitCode=1});
