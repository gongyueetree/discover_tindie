import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {GET} from '../src/app/api/maker/datasheet/route';
async function main(){const original=globalThis.fetch;let calls=0;try{
 globalThis.fetch=async()=>{calls++;return new Response('%PDF-1.4\n test',{headers:{'Content-Disposition':'attachment'}});};
 const req=(url:string)=>new NextRequest('http://localhost/api/maker/datasheet?'+new URLSearchParams({url}));
 let r=await GET(req('https://www.st.com/test.pdf'));assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');assert.ok(r.headers.get('content-disposition')?.startsWith('inline'));
 calls=0;r=await GET(req('https://127.0.0.1/private'));assert.equal(r.status,400);assert.equal(calls,0);
 globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://169.254.169.254/private'}});};
 calls=0;r=await GET(req('https://www.st.com/test.pdf'));assert.equal(r.status,400);assert.equal(calls,1);
 globalThis.fetch=async()=>new Response('<html>error</html>');r=await GET(req('https://www.st.com/test.pdf'));assert.equal(r.status,502);
 console.log('Inline PDF header, denied host, redirected private host and non-PDF rejection checks passed.');
}finally{globalThis.fetch=original;}}main();
