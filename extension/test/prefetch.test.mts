// A stylesheet's includes are read before the core is asked, so a deep
// or wide tree of includes takes one round, not one per module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFrom, threads } from "../src/node.ts";
import { prefetchModules } from "../src/prefetch.ts";
import { Transformer } from "../src/transforms.ts";

const here = dirname(fileURLToPath(import.meta.url));
loadFrom(join(here, "..", "wasm"));

const XSL = "http://www.w3.org/1999/XSL/Transform";
// A main module that includes 40 modules, each naming a template.
const files: Record<string, string> = {};
const N = 40;
files["file:///s/main.xsl"] = `<xsl:stylesheet version="3.0" xmlns:xsl="${XSL}">
${Array.from({ length: N }, (_, i) => `<xsl:include href="m${i}.xsl"/>`).join("\n")}
<xsl:template match="/"><out>${Array.from({ length: N }, (_, i) => `<xsl:call-template name="t${i}"/>`).join("")}</out></xsl:template>
</xsl:stylesheet>`;
for (let i = 0; i < N; i++) files[`file:///s/m${i}.xsl`] = `<xsl:stylesheet version="3.0" xmlns:xsl="${XSL}"><xsl:template name="t${i}"><t${i}/></xsl:template></xsl:stylesheet>`;
files["file:///d/doc.xml"] = "<doc/>";
let reads = 0;
const read = async (u: string) => (reads++, files[u]);

test("prefetch reads every included module", async () => {
  const got = await prefetchModules("xslt", "file:///s/main.xsl", files["file:///s/main.xsl"]!, read);
  assert.equal(Object.keys(got).length, N);
});

test("a stylesheet with more includes than rounds still runs", async () => {
  const t = new Transformer(threads(join(here, "..", "out", "transformer.js")));
  try {
    const a = await t.transform({ stylesheet: "file:///s/main.xsl", source: "file:///d/doc.xml" }, read, 60_000);
    assert.deepEqual(a.problems, []);
    assert.match(a.results[0]?.text ?? "", /<t0\/>.*<t39\/>/s);
  } finally {
    t.stop();
  }
});
