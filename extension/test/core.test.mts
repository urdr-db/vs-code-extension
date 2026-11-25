// The checks end to end through the WebAssembly module (build it first
// with `npm run wasm`), and the helpers that place problems in the text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, validate } from "../src/core.ts";
import { loadFrom } from "../src/node.ts";
import { locate } from "../src/locate.ts";
import { byteToIndex, indexToPosition, lineColumnToIndex } from "../src/positions.ts";

loadFrom(join(dirname(fileURLToPath(import.meta.url)), "..", "wasm"));

const files: Record<string, string> = {
  "file:///p/a.rng": `<element name="a" xmlns="http://relaxng.org/ns/structure/1.0"><zeroOrMore><element name="b"><attribute name="n"><data type="integer" datatypeLibrary="http://www.w3.org/2001/XMLSchema-datatypes"/></attribute></element></zeroOrMore></element>`,
  "file:///p/lib.xqm": `module namespace m = "urn:m"; declare function m:f() { 1 };`,
  "file:///p/common.xsl": `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"><xsl:template name="c"/></xsl:stylesheet>`,
};
const read = async (uri: string) => files[uri];

test("a document is checked against the schema its xml-model names", async () => {
  const text = `<?xml-model href="a.rng"?>\n<a><b n="1"/><b n="x"/></a>`;
  const report = await validate("file:///p/doc.xml", text, read);
  assert.equal(report.status, "invalid");
  assert.equal(report.issues?.length, 1);
  const at = locate(text, report.issues![0]!.path);
  assert.ok(at);
  assert.equal(text.slice(at.start, at.end), "n");
  assert.equal(indexToPosition(text, at.start).line, 1);
});

test("a schema that cannot be read is listed as needed", async () => {
  const report = await validate("file:///p/doc.xml", `<?xml-model href="missing.rng"?><a/>`, read);
  assert.deepEqual(report.needed, ["file:///p/missing.rng"]);
});

test("queries read the modules they import", async () => {
  const ok = await check("xquery", "file:///p/q.xq", `import module namespace m = "urn:m" at "lib.xqm"; m:f()`, read);
  assert.deepEqual(ok.problems, []);
  const bad = await check("xquery", "file:///p/q.xq", `import module namespace m = "urn:m" at "lib.xqm"; m:nope()`, read);
  assert.equal(bad.problems[0]?.code, "XPST0017");
});

test("stylesheets read the modules they include", async () => {
  const xsl = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">\n<xsl:include href="common.xsl"/>\n<xsl:template match="/"><xsl:call-template name="c"/><xsl:value-of select="1 +"/></xsl:template>\n</xsl:stylesheet>`;
  const answer = await check("xslt", "file:///p/main.xsl", xsl, read);
  assert.equal(answer.problems.length, 1);
  assert.equal(answer.problems[0]!.line, 3);
});

test("offsets convert between UTF-8 bytes and UTF-16", () => {
  const text = "ð€x\ny";
  // ð is 2 bytes, € 3, x 1.
  assert.equal(byteToIndex(text, 5), 2);
  assert.deepEqual(indexToPosition(text, 4), { line: 1, character: 0 });
  assert.equal(lineColumnToIndex(text, 2, 1), 4);
});

test("paths find elements by local name and position", () => {
  const text = `<tei:TEI xmlns:tei="urn:t"><tei:p/><!-- <p> --><tei:p rend="x"/></tei:TEI>`;
  const at = locate(text, "/Q{urn:t}TEI[1]/Q{urn:t}p[2]/@rend");
  assert.ok(at);
  assert.equal(text.slice(at.start, at.end), "rend");
});
