// TEI id links: xml:id values and the #id pointers to them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { idAt, idProblems, links } from "../src/ids.ts";

const DOC = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body>
<p xml:id="p1">See <ref target="#p2 #p9">two</ref> and <ref target="http://x.org/a#b">web</ref>.</p>
<p xml:id="p2" corresp='#p1 people.xml#ana'><persName ref="#ana">Ana</persName></p>
<p xml:id="p1"/>
</body></text></TEI>`;

test("finds ids and the pointers to them", () => {
  const l = links(DOC);
  assert.deepEqual(l.ids.map((s) => s.id), ["p1", "p2", "p1"]);
  assert.deepEqual(l.pointers.map((p) => `${p.document}#${p.id}`), ["#p2", "#p9", "#p1", "people.xml#ana", "#ana"]);
  const p2 = l.pointers[0]!;
  assert.equal(DOC.slice(p2.start, p2.end), "p2");
  assert.equal(DOC.slice(l.ids[1]!.start, l.ids[1]!.end), "p2");
  assert.equal(idAt(l, DOC.indexOf("#p2") + 2)?.id, "p2");
  assert.equal(idAt(l, DOC.indexOf('"p2"') + 1)?.declaration, true);
  assert.equal(idAt(l, DOC.indexOf("people.xml#ana") + 12), undefined);
});

test("flags ids given twice and pointers to missing ids", () => {
  const problems = idProblems(links(DOC));
  assert.deepEqual(
    problems.map((p) => [p.severity, p.id]),
    [["error", "p1"], ["warning", "p9"], ["warning", "ana"]],
  );
});
