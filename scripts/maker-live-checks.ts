import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/maker/[...path]/route";
async function main() {
  const matchRequest=new NextRequest('http://localhost/api/maker/match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:[{id:'1',reference:'U1',quantity:1,value:'DAC',mpn:'AD9102BCPZ',manufacturer:'Analog Devices',package:'',original:{},status:'unmatched'}]})});
  const matchResponse=await POST(matchRequest,{params:{path:['match']}});
  const matchBody=await matchResponse.json();
  assert.equal(matchResponse.status,200);assert.equal(matchBody.rows[0].status,'exact');
  console.log('Live BOM matching: exact AD9102BCPZ identity confirmed');

  for (const path of [
    "parts?q=AD9102",
    "circuits",
    "circuits/01a140db-9304-71c8-a4b6-3677b07d2131/view",
    "pricing/AD9102BCPZ?qty=10&manufacturer=Analog%20Devices",
  ]) {
    const req = new NextRequest("http://localhost/api/maker/" + path);
    const r = await GET(req, {
      params: { path: path.split("?")[0].split("/") },
    });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    if (path === "circuits") {
      assert.ok(j.total > 0);
      assert.ok(j.items.length);
      console.log("Catalogue:", j.total, "projects,", j.items.length, "cards");
    } else if (path.includes("/view")) {
      assert.ok(j.bundle.pcbs.length);
      console.log(
        "Live parsed project:",
        j.bundle.project.name,
        j.bundle.pcbs.length,
        "board(s)",
      );
    } else if (path.startsWith("parts")) {
      assert.ok(j.items.some((p: any) => p.mpn === "AD9102BCPZ"));
      console.log(
        "Part lookup:",
        j.items.length,
        "variants, CAD assets:",
        j.items[0].cad.length,
      );
    } else {
      console.log(
        "Pricing:",
        j.offers.length,
        "live offers; partial:",
        j.partialSources,
      );
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
