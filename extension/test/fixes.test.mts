// Quick fixes for schema problems, from the outline (build the
// WebAssembly module first with `npm run wasm`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { outline } from "../src/core.ts";
import { loadFrom } from "../src/node.ts";
import { readDocs } from "../src/docs.ts";
import type { Edit } from "../src/elements.ts";
import { fixesAt } from "../src/fixes.ts";
import { schemaHints } from "../src/hints.ts";
import { Index } from "../src/suggest.ts";

loadFrom(join(dirname(fileURLToPath(import.meta.url)), "..", "wasm"));

const TEI = "http://www.tei-c.org/ns/1.0";
const RNG = `<grammar xmlns="http://relaxng.org/ns/structure/1.0" ns="${TEI}">
  <start><element name="TEI"><oneOrMore><choice><ref name="p"/><ref name="div"/></choice></oneOrMore></element></start>
  <define name="p"><element name="p">
    <optional><attribute name="rend"><choice><value>italic</value><value>bold</value></choice></attribute></optional>
    <attribute name="n"/>
    <attribute name="id" ns="http://www.w3.org/XML/1998/namespace"/>
    <text/>
  </element></define>
  <define name="div"><element name="div"><attribute name="type"/><text/></element></define>
</grammar>`;
const PROLOG = `<?xml-model href="../s/t.rng" schematypens="http://relaxng.org/ns/structure/1.0"?>\n`;

async function index(): Promise<Index> {
  const hints = schemaHints(PROLOG + "<TEI/>", (r) => new URL(r, "file:///d/doc.xml").href);
  const { answer, files } = await outline(hints, async (uri) => (uri === "file:///s/t.rng" ? RNG : undefined));
  assert.ok(answer.outline, answer.note);
  return new Index(answer.outline, readDocs(Object.values(files)));
}

const apply = (text: string, edits: Edit[]) =>
  [...edits].sort((a, b) => b.start - a.start).reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), text);

test("adds the required attributes a start tag lacks", async () => {
  const i = await index();
  const text = PROLOG + `<TEI xmlns="${TEI}"><p rend="x">a</p><div/></TEI>`;
  const fixes = fixesAt(text, text.indexOf("p rend"), i);
  assert.deepEqual(
    fixes.map((f) => [f.title, f.preferred]),
    [
      ["Add the required attribute n", false],
      ["Add the required attribute xml:id", false],
      ["Add all required attributes", true],
    ],
  );
  assert.match(apply(text, fixes[2]!.edits), /<p rend="x" n="" xml:id="">a<\/p>/);
  const div = fixesAt(text, text.indexOf("div/>"), i);
  assert.equal(apply(text, div[0]!.edits).includes(`<div type=""/>`), true);
});

test("changes an element the parent does not allow, closest name first", async () => {
  const i = await index();
  const text = PROLOG + `<TEI xmlns="${TEI}"><dvi type="a">x</dvi></TEI>`;
  const fixes = fixesAt(text, text.indexOf("dvi"), i);
  assert.deepEqual(
    fixes.map((f) => f.title),
    ["Change to <div>", "Change to <p>"],
  );
  assert.match(apply(text, fixes[0]!.edits), /<div type="a">x<\/div>/);
  // The names the validator expected come first.
  assert.deepEqual(
    fixesAt(text, text.indexOf("dvi"), i, ["p"]).map((f) => [f.title, f.preferred]),
    [
      ["Change to <p>", true],
      ["Change to <div>", false],
    ],
  );
  // An allowed element gets no change.
  assert.deepEqual(fixesAt(text.replace(/dvi/g, "div"), text.indexOf("dvi"), i), []);
});

test("removes or changes an attribute the element does not allow", async () => {
  const i = await index();
  const text = PROLOG + `<TEI xmlns="${TEI}"><p n="1" xml:id="a" rnd='x'>a</p></TEI>`;
  const fixes = fixesAt(text, text.indexOf("rnd"), i);
  assert.deepEqual(
    fixes.map((f) => f.title),
    ["Remove the attribute rnd", "Change to rend"],
  );
  assert.match(apply(text, fixes[0]!.edits), /<p n="1" xml:id="a">a/);
  assert.match(apply(text, fixes[1]!.edits), /<p n="1" xml:id="a" rend='x'>a/);
  assert.deepEqual(fixesAt(text, text.indexOf("n="), i), []);
});

test("changes a value to one the attribute takes", async () => {
  const i = await index();
  const text = PROLOG + `<TEI xmlns="${TEI}"><p n="1" xml:id="a" rend="itlic">a</p></TEI>`;
  const fixes = fixesAt(text, text.indexOf("rend"), i);
  assert.deepEqual(
    fixes.map((f) => f.title),
    ['Change the value to "italic"', 'Change the value to "bold"'],
  );
  assert.match(apply(text, fixes[0]!.edits), /rend="italic">a/);
  assert.deepEqual(fixesAt(text.replace("itlic", "bold"), text.indexOf("rend"), i), []);
});
