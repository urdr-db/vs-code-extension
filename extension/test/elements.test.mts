// The element scanner behind the editing actions (Surround with Tags,
// Delete Element Tags, Split, Join, Rename).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteTags, elementAt, elements, join, split, tagNames, tags, type Edit } from "../src/elements.ts";

const DOC = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "<b>">]><r a="x>y"><!-- <c> --><p xml:id="p1" rend="i">one <hi>two</hi> <hi>three</hi></p><e/><![CDATA[<x>]]></r>`;
const at = (s: string) => DOC.indexOf(s);
const apply = (text: string, edits: Edit[]) =>
  [...edits].sort((a, b) => b.start - a.start).reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), text);

test("finds tags, skipping comments, CDATA, PIs, the DOCTYPE and > in attribute values", () => {
  assert.equal(tags(DOC).map((t) => `${t.kind}:${t.name}`).join(" "), "start:r start:p start:hi end:hi start:hi end:hi end:p empty:e end:r");
  assert.equal(elements(DOC).map((e) => `${e.open.name}@${e.depth}`).join(" "), "r@0 p@1 hi@2 hi@2 e@1");
  assert.equal(elementAt(DOC, at("two") + 1)?.open.name, "hi");
  // Half-typed documents: an unclosed element runs to its parent's end tag.
  assert.deepEqual(elements("<a><b>x</a>").map((e) => [e.open.name, !!e.close]), [["a", true], ["b", false]]);
  assert.deepEqual(tags("<a><b x='1'").map((t) => t.name), ["a"]);
});

test("deletes an element's tags and keeps its content", () => {
  assert.match(apply(DOC, deleteTags(DOC, at("two"))!), /one two <hi>three<\/hi>/);
  assert.match(apply(DOC, deleteTags(DOC, at("<e/>") + 1)!), /<\/p><!\[CDATA/);
  assert.equal(deleteTags("text", 2), undefined);
});

test("splits an element at the caret, copying its attributes but not its id", () => {
  const s = split(DOC, at("one") + 2)!;
  const out = apply(DOC, [s.edit]);
  assert.match(out, /<p xml:id="p1" rend="i">on<\/p><p rend="i">e <hi>/);
  assert.equal(out.slice(s.caret, s.caret + 1), "e");
});

test("joins sibling elements with the same name and attributes", () => {
  assert.match(apply(DOC, [join(DOC, at("</hi> <hi>") + 2)!]), /one <hi>two three<\/hi><\/p>/);
  assert.equal(join(`<a><b>1</b><c>2</c></a>`, 9), undefined);
  assert.equal(join(`<a><b n="1">1</b><b n="2">2</b></a>`, 17), undefined);
  assert.equal(apply(`<a><b>1</b><b>2</b></a>`, [join(`<a><b>1</b><b>2</b></a>`, 11)!]), `<a><b>12</b></a>`);
});

test("finds both names of an element to rename", () => {
  const r = tagNames(DOC, at("<hi>") + 2)!;
  assert.deepEqual(r.map((x) => DOC.slice(x.start, x.end)), ["hi", "hi"]);
  assert.equal(r[1]!.start, at("</hi>") + 2);
  assert.equal(tagNames(DOC, at("<e/>") + 1)!.length, 1);
  assert.equal(tagNames(DOC, at("two")), undefined);
});
