// Suggestions and hovers from a schema outline, through the WebAssembly
// module (build it first with `npm run wasm`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { outline } from "../src/core.ts";
import { loadFrom } from "../src/node.ts";
import { contextAt } from "../src/context.ts";
import { readDocs } from "../src/docs.ts";
import { schemaHints } from "../src/hints.ts";
import { hover, Index, suggest } from "../src/suggest.ts";

loadFrom(join(dirname(fileURLToPath(import.meta.url)), "..", "wasm"));

const TEI = "http://www.tei-c.org/ns/1.0";
const RNG = `<grammar xmlns="http://relaxng.org/ns/structure/1.0" xmlns:a="http://relaxng.org/ns/compatibility/annotations/1.0" ns="${TEI}">
  <start><element name="TEI"><oneOrMore><ref name="p"/></oneOrMore></element></start>
  <define name="p"><element name="p"><a:documentation>(paragraph) marks paragraphs in prose.</a:documentation>
    <optional><attribute name="rend"><a:documentation>(rendition) how it looked.</a:documentation><choice><value>italic</value><value>bold</value></choice></attribute></optional>
    <attribute name="n"/>
    <zeroOrMore><choice><text/><ref name="name"/></choice></zeroOrMore>
  </element></define>
  <define name="name"><element name="name"><empty/></element></define>
</grammar>`;
const files: Record<string, string> = { "file:///s/t.rng": RNG };
const read = async (uri: string) => files[uri];
const PROLOG = `<?xml-model href="../s/t.rng" schematypens="http://relaxng.org/ns/structure/1.0"?>\n`;

async function index(): Promise<Index> {
  const hints = schemaHints(PROLOG + "<TEI/>", (r) => new URL(r, "file:///d/doc.xml").href);
  assert.deepEqual(hints, [{ language: "rng", uri: "file:///s/t.rng" }]);
  const { answer, files: read_ } = await outline(hints, read);
  assert.ok(answer.outline, answer.note);
  return new Index(answer.outline, readDocs(Object.values(read_)));
}

/** Text with a `|` where the cursor is. */
function at(text: string): [string, number] {
  const i = text.indexOf("|");
  return [text.slice(0, i) + text.slice(i + 1), i];
}

test("hints: XSD on the root wins over xml-model", () => {
  const text = `<?xml-model href="a.rng"?><r xmlns:x="http://www.w3.org/2001/XMLSchema-instance" x:noNamespaceSchemaLocation="b.xsd">`;
  assert.deepEqual(schemaHints(text, (r) => r), [{ language: "xsd", uri: "b.xsd" }]);
});

test("context: open elements and what is being typed, in broken text", () => {
  const [text, i] = at(`<a xmlns="urn:a"><b k="1"><!-- <c> --><d |`);
  const c = contextAt(text, i);
  assert.deepEqual(c.open.map((e) => e.local), ["a", "b"]);
  assert.equal(c.place.kind, "attribute");
  const [t2, j] = at(`<a><b k="x|`);
  const v = contextAt(t2, j).place;
  assert.ok(v.kind === "value" && v.attribute === "k" && v.partial === "x");
});

test("suggests the children the schema allows, with required attributes", async () => {
  const ix = await index();
  const [text, i] = at(`${PROLOG}<TEI xmlns="${TEI}"><|`);
  const s = suggest(text, i, ix);
  assert.deepEqual(s.map((x) => x.label), ["p"]);
  assert.equal(s[0]!.insert, `p n="$1">$0</p>`);
  assert.match(s[0]!.documentation ?? "", /paragraph/);
});

test("suggests attributes not yet written, then their values", async () => {
  const ix = await index();
  const [text, i] = at(`${PROLOG}<TEI xmlns="${TEI}"><p n="1" |`);
  assert.deepEqual(suggest(text, i, ix).map((x) => x.label), ["rend"]);
  const [t2, j] = at(`${PROLOG}<TEI xmlns="${TEI}"><p rend="|`);
  assert.deepEqual(suggest(t2, j, ix).map((x) => x.label), ["bold", "italic"]);
  const [t3, k] = at(`${PROLOG}<TEI xmlns="${TEI}"><p n="1"><|`);
  const empty = suggest(t3, k, ix).find((x) => x.label === "name");
  assert.equal(empty?.insert, "name/>");
});

test("closes the open element", async () => {
  const ix = await index();
  const [text, i] = at(`${PROLOG}<TEI xmlns="${TEI}"><p n="1">x</|`);
  assert.deepEqual(suggest(text, i, ix).map((x) => x.insert), ["p>"]);
});

test("hovers show documentation, attributes and content", async () => {
  const ix = await index();
  const text = `${PROLOG}<TEI xmlns="${TEI}"><p n="1" rend="bold">x</p></TEI>`;
  const onP = hover(text, text.indexOf("<p ") + 1, ix);
  assert.ok(onP);
  assert.match(onP.markdown, /paragraph/);
  assert.match(onP.markdown, /\*\*n\*\*/);
  assert.match(onP.markdown, /May contain: name, and text/);
  const onRend = hover(text, text.indexOf("rend") + 2, ix);
  assert.match(onRend?.markdown ?? "", /rendition[\s\S]*`italic`/);
});
