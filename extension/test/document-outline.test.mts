// Suggestions where no schema is named: the names the document already
// uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { documentOutline } from "../src/document-outline.ts";
import { Index, suggest } from "../src/suggest.ts";

const NO_DOCS = { elements: new Map<string, string>(), attributes: new Map<string, string>() };

/** Text with a `|` where the cursor is, and what is suggested there. */
function labels(marked: string): string[] {
  const i = marked.indexOf("|");
  const text = marked.slice(0, i) + marked.slice(i + 1);
  return suggest(text, i, new Index(documentOutline(text, i), NO_DOCS)).map((s) => s.label);
}

const DOC = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body>
  <p rend="italic">A <persName ref="#ana">Ana</persName> and <hi rend="bold">b</hi>.</p>
  <p rend="bold" n="2">x</p>
`;

test("children seen under an element of the same name", () => {
  assert.deepEqual(labels(`${DOC}<p><|</p></body></text></TEI>`).sort(), ["hi", "persName"]);
  assert.deepEqual(labels(`${DOC}<|</body></text></TEI>`), ["p"]);
});

test("an element with nothing seen under it may hold any name used", () => {
  const got = labels(`${DOC}<p><hi><|</hi></p></body></text></TEI>`);
  assert.ok(got.includes("p") && got.includes("persName") && got.includes("TEI"), got.join());
});

test("attributes seen on the element, not those already written", () => {
  assert.deepEqual(labels(`${DOC}<p |`).sort(), ["n", "rend"]);
  assert.deepEqual(labels(`${DOC}<p rend="bold" |`), ["n"]);
});

test("values seen for the attribute, not the one being typed", () => {
  assert.deepEqual(labels(`${DOC}<p rend="|"`), ["bold", "italic"]);
  assert.deepEqual(labels(`${DOC}<p rend="it|"`), ["bold", "italic"]);
});

test("free text is not offered as values", () => {
  const many = Array.from({ length: 40 }, (_, i) => `<w n="${i}"/>`).join("");
  assert.deepEqual(labels(`<r>${many}<w n="|"/></r>`), []);
  assert.deepEqual(labels(`<r><note resp="a long sentence that someone wrote here, as text"/><note resp="|"/></r>`), []);
});

test("names keep their namespaces", () => {
  const text = `<r xmlns:x="urn:x"><x:a/><b/></r>`;
  const o = documentOutline(text);
  assert.deepEqual(o.elements.find((e) => e.name[1] === "r")?.children, [["urn:x", "a"], ["", "b"]]);
});
