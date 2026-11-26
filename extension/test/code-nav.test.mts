// Go to Definition, Find All References and the outline for XSLT and
// XQuery.
import { test } from "node:test";
import assert from "node:assert/strict";
import { definitions, load, references, type Loaded, type Place } from "../src/code-nav.ts";
import { xqueryModule } from "../src/xquery-symbols.ts";
import { xslModule } from "../src/xsl-symbols.ts";

const XSL = `xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f"`;
const files: Record<string, string> = {
  "file:///x/main.xsl": `<xsl:stylesheet ${XSL} version="3.0" expand-text="yes">
  <xsl:include href="lib/lib.xsl"/>
  <xsl:param name="title" select="'T'"/>
  <xsl:key name="by-id" match="*" use="@id"/>
  <xsl:mode name="toc"/>
  <xsl:template match="/">
    <xsl:variable name="title" select="upper-case($title)"/>
    <h1 class="{$title}">{f:twice($title)}</h1>
    <xsl:apply-templates select="key('by-id', 'a')" mode="toc"/>
    <xsl:call-template name="footer"><xsl:with-param name="n" select="f:twice(1, 2)"/></xsl:call-template>
  </xsl:template>
  <xsl:template match="section" mode="toc">{$title}</xsl:template>
</xsl:stylesheet>`,
  "file:///x/lib/lib.xsl": `<xsl:stylesheet ${XSL} version="3.0">
  <xsl:function name="f:twice"><xsl:param name="x"/><xsl:sequence select="$x, $x"/></xsl:function>
  <xsl:function name="f:twice"><xsl:param name="x"/><xsl:param name="y"/><xsl:sequence select="$x, $y"/></xsl:function>
  <xsl:template name="footer"><xsl:param name="n"/><footer>{$n}</footer></xsl:template>
</xsl:stylesheet>`,
  "file:///q/main.xq": `import module namespace n = "urn:names" at "names.xqm";
declare variable $limit := 3;
declare function local:first($items as item()*) as item()? {
  let $first := head($items) (: $limit in a comment :)
  return $first
};
for $p in n:people(doc("a.xml"))[position() le $limit]
let $s := "$p in a string"
return local:first(($p, $s))`,
  "file:///q/names.xqm": `module namespace n = "urn:names";
declare function n:people($doc as document-node()) as xs:string* {
  distinct-values($doc//name)
};`,
};
const read = async (uri: string) => files[uri];

async function modules(uri: string): Promise<Loaded[]> {
  return load(uri, files[uri]!, read, uri.endsWith(".xsl") ? xslModule : xqueryModule);
}
/** The text at each place, with its file's name. */
const show = (places: Place[]) => places.map((p) => `${p.uri.slice(p.uri.lastIndexOf("/") + 1)}:${files[p.uri]!.slice(p.start, p.end)}@${p.start}`);
const at = (uri: string, needle: string, plus = 0, nth = 0) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = files[uri]!.indexOf(needle, i + 1);
  assert.ok(i >= 0, needle);
  return i + plus;
};

test("XSLT: goes to templates, functions by arity, variables in scope, keys and modes, across includes", async () => {
  const main = "file:///x/main.xsl";
  const ms = await modules(main);
  assert.deepEqual(
    ms.map((m) => m.uri),
    [main, "file:///x/lib/lib.xsl"],
  );
  const def = (needle: string, plus = 0, nth = 0) => show(definitions(ms[0]!, at(main, needle, plus, nth), ms));
  assert.deepEqual(def('name="footer"', 7), [`lib.xsl:footer@${files["file:///x/lib/lib.xsl"]!.indexOf("footer")}`]);
  // The local $title shadows the parameter after it is declared; in its
  // own select, the parameter is meant.
  assert.deepEqual(def("upper-case($title", 12), [`main.xsl:title@${at(main, "title")}`]);
  assert.deepEqual(def('class="{$title', 9), [`main.xsl:title@${at(main, '"title" select="upper', 1)}`]);
  // In another template, the parameter again.
  assert.deepEqual(def('mode="toc">{$title', 13), [`main.xsl:title@${at(main, "title")}`]);
  assert.deepEqual(def("f:twice($title", 2).length, 1);
  assert.match(def("f:twice(1, 2", 2)[0]!, /twice@/);
  assert.notDeepEqual(def("f:twice($title", 2), def("f:twice(1, 2", 2));
  assert.deepEqual(def("'by-id', 'a'", 1), [`main.xsl:by-id@${at(main, "by-id")}`]);
  // A mode: its declaration and the templates in it.
  assert.deepEqual(def('mode="toc"/>', 6), [`main.xsl:toc@${at(main, "toc")}`, `main.xsl:section@${at(main, "section")}`]);
});

test("XSLT: finds every use, also in the including module, and lists the declarations", async () => {
  const main = "file:///x/main.xsl";
  const lib = "file:///x/lib/lib.xsl";
  const all = await modules(main);
  const libModule = all.find((m) => m.uri === lib)!;
  // From the template's name in lib.xsl: its call in main.xsl.
  assert.deepEqual(show(references(libModule, at(lib, "footer", 1), all, false)), [`main.xsl:footer@${at(main, "footer")}`]);
  // The global parameter: used in two places; the local variable shadows it in a third.
  assert.deepEqual(
    show(references(all[0]!, at(main, "title", 1), all, true)).map((s) => s.split("@")[0]),
    ["main.xsl:title", "main.xsl:title", "main.xsl:title"],
  );
  assert.deepEqual(
    xslModule(files[main]!)
      .declarations.filter((d) => !d.scope)
      .map((d) => `${d.kind} ${d.label}`),
    ["param title", "key by-id", "mode toc", "match /", "match section"],
  );
  assert.deepEqual(
    xslModule(files[lib]!)
      .declarations.filter((d) => !d.scope)
      .map((d) => `${d.kind} ${d.label}`),
    ["function f:twice#1", "function f:twice#2", "template footer"],
  );
});

test("XQuery: goes to functions in imported modules and to the variables in scope", async () => {
  const main = "file:///q/main.xq";
  const ms = await modules(main);
  assert.equal(ms.length, 2);
  const def = (needle: string, plus = 0, nth = 0) => show(definitions(ms[0]!, at(main, needle, plus, nth), ms));
  assert.deepEqual(def("n:people(", 3), [`names.xqm:n:people@${files["file:///q/names.xqm"]!.indexOf("n:people")}`]);
  assert.deepEqual(def("local:first((", 3), [`main.xq:local:first@${at(main, "local:first")}`]);
  assert.deepEqual(def("() le $limit", 7), [`main.xq:limit@${at(main, "limit")}`]);
  assert.deepEqual(def("return $first", 8), [`main.xq:first@${at(main, "first :=")}`]);
  assert.deepEqual(def("head($items", 6), [`main.xq:items@${at(main, "items")}`]);
  assert.deepEqual(def("(($p", 3), [`main.xq:p@${at(main, "p in n:")}`]);
  // Not in strings or comments.
  assert.deepEqual(def("$limit in a comment", 1), []);
  assert.deepEqual(
    show(references(ms[0]!, at(main, "$limit", 1), ms, false)),
    [`main.xq:limit@${at(main, "limit]")}`],
  );
  assert.deepEqual(
    xqueryModule(files[main]!)
      .declarations.filter((d) => !d.scope)
      .map((d) => `${d.kind} ${d.label}`),
    ["function local:first#1", "variable $limit"],
  );
  assert.deepEqual(ms[0]!.module.imports, ["names.xqm"]);
});
