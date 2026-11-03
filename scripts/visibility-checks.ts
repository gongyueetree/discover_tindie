/** Who sees the new tabs while they are in preview (src/lib/maker/visibility.ts). */
import assert from "node:assert/strict";
import { toolsAllowed, previewKeyMatches } from "../src/lib/maker/visibility";

delete process.env.MAKER_TOOLS_PUBLIC;
process.env.MAKER_PREVIEW_KEY = "k".repeat(24);
assert.equal(toolsAllowed(undefined, undefined), false, "public: hidden");
assert.equal(toolsAllowed("user", undefined), false, "a signed-in shopper: hidden");
assert.equal(toolsAllowed("admin", undefined), true);
assert.equal(toolsAllowed("editor", undefined), true);
assert.equal(toolsAllowed(undefined, "k".repeat(24)), true, "preview cookie");
assert.equal(toolsAllowed(undefined, "k".repeat(23) + "x"), false);
process.env.MAKER_PREVIEW_KEY = "short";
assert.equal(previewKeyMatches("short"), false, "keys under 16 characters are refused");
delete process.env.MAKER_PREVIEW_KEY;
assert.equal(previewKeyMatches(""), false, "no key configured: no preview link");
process.env.MAKER_TOOLS_PUBLIC = "1";
assert.equal(toolsAllowed(undefined, undefined), true, "go-live switch");
console.log("PASS: new tabs hidden from the public until MAKER_TOOLS_PUBLIC=1; admins / editors and the preview key see them");
