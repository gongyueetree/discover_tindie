import assert from "node:assert/strict";
import { translateTexts,englishDisplay } from "../src/lib/maker/translation";
async function main() {
  const originalFetch = globalThis.fetch;
  const oldKey = process.env.AZURE_TRANSLATOR_KEY;
  try {
    delete process.env.AZURE_TRANSLATOR_KEY;
    const category=await englishDisplay({category:{id:"hmi",name:"人机接口HMI"},assets:{name:"原始工程.kicad_pcb"}});
    assert.equal(category.category.name,"Human-machine interface");assert.equal(category.category.id,"hmi");assert.equal(category.assets.name,"原始工程.kicad_pcb");
    assert.equal(
      (await translateTexts(["高电流I/O端口"]))[0],
      "High-current I/O ports",
    );
    assert.equal(
      (await translateTexts(["罕见未收录的术语"]))[0],
      "罕见未收录的术语",
    );
    process.env.AZURE_TRANSLATOR_KEY = "test-not-a-real-credential";
    let requests = 0;
    globalThis.fetch = (async (_url, opts) => {
      requests++;
      const body = JSON.parse(String(opts?.body));
      return new Response(
        JSON.stringify(
          body.map((b: { Text: string }) => ({
            translations: [
              {
                to: "en",
                text: b.Text.replace("额外说明", "Additional note "),
              },
            ],
          })),
        ),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    const source = "额外说明 STM32G031C4U6 1.7-3.6V 64 MHz";
    const out = (await translateTexts([source]))[0];
    assert.ok(out.includes("STM32G031C4U6"));
    assert.ok(out.includes("1.7-3.6V"));
    assert.ok(out.includes("64 MHz"));
    assert.ok(!out.includes("TINDIEKEEP"));
    await translateTexts([source]);
    assert.equal(requests, 1);
    globalThis.fetch = (async () =>
      new Response("", { status: 429 })) as typeof fetch;
    assert.equal(
      (await translateTexts(["无法翻译的资料"]))[0],
      "无法翻译的资料",
    );
    console.log(
      "Translation fallback, terminology, protected identifiers/units/numbers, cache and provider error handling passed.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.AZURE_TRANSLATOR_KEY;
    else process.env.AZURE_TRANSLATOR_KEY = oldKey;
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
