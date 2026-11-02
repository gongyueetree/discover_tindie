import assert from 'node:assert/strict';
import {terminology,hasChinese} from '../src/lib/maker/english';
import {circuitMetadata,byStars} from '../src/lib/maker/circuit-metadata';
for(const s of ['压摆率(V/µs)','输入偏置 current [Typical value] (nA)','电路数','供电 current (nA)','Vs跨度 [Minimum] (V)','噪声系数 [Typical value] (dB)','Frequency 响应 (MHz)'])assert.equal(hasChinese(terminology(s)),false,s);
assert.equal(terminology('275 V/µs'),'275 V/µs');
const rows=[{id:'none'},{id:'zero',stars:0,license:{spdx_id:'MIT'}},{id:'high',githubStars:120,license:{declared:'CERN-OHL-S-2.0'}}].map(circuitMetadata).sort(byStars);
assert.deepEqual(rows.map(r=>r.id),['high','zero','none']);assert.equal(rows[2].githubStars,null);assert.equal(rows[2].license.declared,null);assert.equal(rows[1].license.declared,'MIT');
console.log('Screenshot terminology, numeric preservation, star zero-vs-unknown and license normalization passed.');
