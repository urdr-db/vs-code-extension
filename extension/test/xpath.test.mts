// "Evaluate XPath": the stylesheet it runs, in the worker, on a TEI
// document, and how its paths are shown and found again.
// Needs the bundled worker: run `npm run build` first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { locate } from "../src/locate.ts";
import { threads } from "../src/node.ts";
import { Transformer } from "../src/transforms.ts";
import { locatablePath, readablePath, rootNamespaces, xpathStylesheet, type XPathAnswer } from "../src/xpath.ts";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "fixtures", "tei", "letter.xml");
const source = pathToFileURL(file).href;
const text = readFileSync(file, "utf8");

async function evaluate(t: Transformer, expression: string): Promise<XPathAnswer & { problems: string[] }> {
  const stylesheet = "urdr-xpath:test.xsl";
  const xsl = xpathStylesheet(expression, text);
  const answer = await t.transform({ stylesheet, source }, async (u) => (u === stylesheet ? xsl : u === source ? text : undefined), 30_000);
  const problems = answer.problems.map((p) => p.message);
  return problems.length ? { count: 0, items: [], problems } : { ...(JSON.parse(answer.results[0]!.text) as XPathAnswer), problems };
}

test("reads the root element's namespaces, past comments and processing instructions", () => {
  const ns = rootNamespaces(`<?xml version="1.0"?><!-- <x xmlns="urn:no"> --><TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:xi="http://www.w3.org/2001/XInclude"/>`);
  assert.equal(ns.default, "http://www.tei-c.org/ns/1.0");
  assert.deepEqual([...ns.prefixes], [["xi", "http://www.w3.org/2001/XInclude"]]);
});

test("evaluates XPath on a TEI document, with TEI as the default namespace", async () => {
  const t = new Transformer(threads(join(here, "..", "out", "transformer.js")));
  try {
    const p = await evaluate(t, "//p");
    assert.equal(p.count, 3);
    assert.equal(p.items[2]!.kind, "element");
    assert.match(p.items[2]!.text, /^William walked to Keswick/);
    assert.equal(readablePath(p.items[2]!.path!), "/TEI/text/body/div/p");
    const at = locate(text, locatablePath(p.items[2]!.path!))!;
    assert.match(text.slice(at.start), /^p>William/);

    const attr = await evaluate(t, "//name/@type");
    assert.deepEqual(attr.items.map((i) => [i.kind, i.text]), [["attribute", "place"]]);
    assert.match(text.slice(locate(text, attr.items[0]!.path!)!.start), /^type/);

    const prefixed = await evaluate(t, "//tei:persName/text()");
    assert.equal(prefixed.items[0]!.kind, "text");
    assert.equal(locatablePath(prefixed.items[0]!.path!).endsWith("persName[1]"), true);

    assert.deepEqual((await evaluate(t, "count(//p), 'a' || 'b'")).items.map((i) => i.text), ["3", "ab"]);
    assert.deepEqual((await evaluate(t, "map { 'a': 1 }")).items.map((i) => i.text), ['{"a":1}']);
    // Quotes, < and & in the expression reach XPath as written.
    assert.deepEqual((await evaluate(t, `count(//p) < 4 and "a&b" = 'a&b'`)).items.map((i) => i.text), ["true"]);
    assert.ok((await evaluate(t, "//p[")).problems.length);
  } finally {
    t.stop();
  }
});
