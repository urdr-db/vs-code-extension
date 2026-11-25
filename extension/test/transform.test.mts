// XSLT transformations in the worker thread, and the preview page.
// Needs the bundled worker: run `npm run build` first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TransformAnswer } from "../src/core.ts";
import { expand, previewPage, stylesheetHref } from "../src/preview-html.ts";
import { threads } from "../src/node.ts";
import { Transformer } from "../src/transforms.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "..", "examples");
const uri = (path: string) => pathToFileURL(join(examples, path)).href;
const disk = (u: string) => readFile(fileURLToPath(u), "utf8").catch(() => undefined);
const worker = () => new Transformer(threads(join(here, "..", "out", "transformer.js")));

test("finds the XSLT named by <?xml-stylesheet?>, not CSS", () => {
  assert.equal(stylesheetHref(`<?xml-stylesheet type="text/css" href="a.css"?><?xml-stylesheet type="text/xsl" href="b.xsl"?><r/>`), "b.xsl");
  assert.equal(stylesheetHref(`<?xml-stylesheet href='c.xslt'?><r/>`), "c.xslt");
  assert.equal(stylesheetHref(`<r/>`), undefined);
});

test("fills in output paths", () => {
  assert.equal(expand("html/${fileBasenameNoExtension}.html", { fileBasenameNoExtension: "letter" }), "html/letter.html");
  assert.equal(expand("${unknown}/x", {}), "${unknown}/x");
});

test("the preview page allows no scripts and shows problems on top", () => {
  const answer: TransformAnswer = {
    results: [{ href: "", text: "<html><head><title>t</title></head><body class=x><p>Hi</p></body></html>", method: "html", mediaType: "text/html" }],
    messages: ["<done>"],
    problems: [],
    needed: [],
  };
  const page = previewPage(answer, { cspSource: "vscode-resource:", base: "vscode-resource:/e/" });
  assert.match(page, /^<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
  assert.doesNotMatch(page, /script-src/);
  assert.match(page, /<base href="vscode-resource:\/e\/">/);
  assert.match(page, /<body class=x><div id="urdr-bar"[^>]*><div class="urdr-message">&lt;done&gt;<\/div><\/div><p>Hi<\/p>/);
  const text = previewPage({ ...answer, messages: [], results: [{ href: "", text: "<a/>", method: "xml", mediaType: "application/xml" }] }, { cspSource: "s", base: "b/" });
  assert.match(text, /<pre>&lt;a\/&gt;<\/pre>/);
  assert.doesNotMatch(text, /urdr-bar/);
});

test("runs a stylesheet in the worker, reading its include", async () => {
  const t = worker();
  try {
    const answer = await t.transform({ stylesheet: uri("xslt/letters-to-html.xsl"), source: uri("schemas/letters-valid.xml") }, disk, 30_000);
    assert.deepEqual(answer.problems, []);
    assert.match(answer.results[0]!.text, /<h2>Dorothy to Mary, 14 March 1802<\/h2>/);
    const pages = await t.transform({ stylesheet: uri("xslt/letter-pages.xsl"), initialTemplate: "main", parameters: { title: "All" } }, disk, 30_000);
    assert.deepEqual(pages.messages, ["1 letter(s) found"]);
    assert.deepEqual(pages.results.map((r) => r.href), ["", "letter-1.html"]);
  } finally {
    t.stop();
  }
});

test("stops a transformation that takes too long, then runs the next", async () => {
  const t = worker();
  const files: Record<string, string> = {
    "file:///t/slow.xsl": `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"><xsl:template name="xsl:initial-template"><xsl:value-of select="sum(for $i in 1 to 100000000000 return $i)"/></xsl:template></xsl:stylesheet>`,
    "file:///t/deep.xsl": `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"><xsl:template name="xsl:initial-template"><xsl:call-template name="down"><xsl:with-param name="n" select="100000000"/></xsl:call-template></xsl:template><xsl:template name="down"><xsl:param name="n"/><x><xsl:if test="$n gt 0"><xsl:call-template name="down"><xsl:with-param name="n" select="$n - 1"/></xsl:call-template></xsl:if></x></xsl:template></xsl:stylesheet>`,
    "file:///t/fast.xsl": `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"><xsl:output method="text"/><xsl:template name="xsl:initial-template">ok</xsl:template></xsl:stylesheet>`,
  };
  const read = async (u: string) => files[u];
  try {
    const slow = await t.transform({ stylesheet: "file:///t/slow.xsl" }, read, 1_000);
    assert.match(slow.problems[0]?.message ?? "", /took longer than 1 seconds/);
    assert.equal((await t.transform({ stylesheet: "file:///t/fast.xsl" }, read, 30_000)).results[0]?.text, "ok");
    const deep = await t.transform({ stylesheet: "file:///t/deep.xsl" }, read, 30_000);
    assert.equal(deep.results.length, 0);
    assert.ok(deep.problems.length, "a problem is reported");
    assert.equal((await t.transform({ stylesheet: "file:///t/fast.xsl" }, read, 30_000)).results[0]?.text, "ok");
  } finally {
    t.stop();
  }
});

test("the package includes every bundle the build makes", async () => {
  const bundle = await readFile(join(here, "..", "scripts", "bundle.mjs"), "utf8");
  const ignore = (await readFile(join(here, "..", ".vscodeignore"), "utf8")).split("\n");
  const outs = [...bundle.matchAll(/outfile: "([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(outs.includes("out/transformer.js"));
  assert.ok(outs.includes("out/web/server.js"));
  for (const o of outs) assert.ok(ignore.includes(`!${o}`), `${o} is left out of the package`);
});

test("the web bundles need nothing from Node", async () => {
  for (const name of ["client", "server", "transformer"]) {
    const code = await readFile(join(here, "..", "out", "web", `${name}.js`), "utf8");
    assert.doesNotMatch(code, /require\("(node:)?(fs|path|url|crypto|worker_threads|child_process|net|os)(\/[a-z]+)?"\)/, `out/web/${name}.js`);
  }
});
