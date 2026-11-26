// XPath colours inside XSLT and Schematron attributes: the injections run
// with VS Code's own XML and XSL grammars, as VS Code runs them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import textmate from "vscode-textmate";
import oniguruma from "vscode-oniguruma";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FILES: Record<string, string> = {
  "text.xml": "test/fixtures/grammars/xml.tmLanguage.json",
  "text.xml.xsl": "test/fixtures/grammars/xsl.tmLanguage.json",
  "source.xpath": "syntaxes/xpath.tmLanguage.json",
  "xpath-attributes.injection.urdr": "syntaxes/xpath-attributes.injection.json",
  "xpath-avt.injection.urdr": "syntaxes/xpath-avt.injection.json",
};

async function registry() {
  const wasm = readFileSync(join(dirname(require.resolve("vscode-oniguruma")), "onig.wasm"));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)).catch(() => undefined);
  // The injections as package.json gives them.
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  const grammars: Array<{ scopeName: string; injectTo?: string[] }> = pkg.contributes.grammars;
  return new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources: string[]) => new oniguruma.OnigScanner(sources),
      createOnigString: (s: string) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scope) => {
      const file = FILES[scope];
      return file ? textmate.parseRawGrammar(readFileSync(join(here, "..", file), "utf8"), file) : null;
    },
    getInjections: (scope) => grammars.filter((g) => g.injectTo?.includes(scope)).map((g) => g.scopeName),
  });
}

/** Each token's text with its innermost scope. */
async function tokens(scope: string, text: string): Promise<Array<[string, string]>> {
  const g = await (await registry()).loadGrammar(scope);
  assert.ok(g);
  let stack = textmate.INITIAL;
  const out: Array<[string, string]> = [];
  for (const line of text.split("\n")) {
    const r = g.tokenizeLine(line, stack);
    for (const t of r.tokens) {
      const s = line.slice(t.startIndex, t.endIndex);
      if (s.trim()) out.push([s, t.scopes[t.scopes.length - 1]!]);
    }
    stack = r.ruleStack;
  }
  return out;
}

const scopeOf = (ts: Array<[string, string]>, text: string, nth = 0) => ts.filter(([s]) => s === text)[nth]?.[1];

test("colours the XPath in XSLT attributes and attribute value templates", async () => {
  const ts = await tokens(
    "text.xml.xsl",
    `<xsl:template match="tei:p[@rend = 'i']">
  <xsl:if test="count($items) &gt; 2 and not(child::*) (: note :)">
    <a href="{$base}/{@n}.html" class="x{{y}}"><xsl:value-of select="if (. eq &quot;a&quot;) then f:x(.) else //div"/></a>
  </xsl:if>
</xsl:template>`,
  );
  assert.equal(scopeOf(ts, "@rend"), "entity.other.attribute-name.xpath");
  assert.equal(scopeOf(ts, "'"), "string.quoted.single.xpath");
  assert.equal(scopeOf(ts, "count"), "support.function.xpath");
  assert.equal(scopeOf(ts, "$items"), "variable.other.xpath");
  assert.equal(scopeOf(ts, "&gt;"), "constant.character.entity.xml");
  assert.equal(scopeOf(ts, "and"), "keyword.operator.xpath");
  assert.equal(scopeOf(ts, "child"), "keyword.other.axis.xpath");
  assert.equal(scopeOf(ts, "(:"), "comment.block.xpath");
  assert.equal(scopeOf(ts, "$base"), "variable.other.xpath");
  assert.equal(scopeOf(ts, "{{"), "constant.character.escape.xpath");
  assert.equal(scopeOf(ts, "if", 1), "keyword.operator.xpath");
  assert.equal(scopeOf(ts, "&quot;"), "string.quoted.double.xpath");
  // After a slash, div is an element name, not the operator.
  assert.equal(scopeOf(ts, "div"), "entity.name.tag.xpath");
  // Other attributes keep the XML colours.
  assert.equal(scopeOf(ts, '"', 0), "punctuation.definition.string.begin.xml");
});

test("colours Schematron tests in an XML file, and leaves TEI text alone", async () => {
  const ts = await tokens("text.xml", `<sch:assert test='@when castable as xs:date'>Dates</sch:assert><p rend="count(x)">and</p>`);
  assert.equal(scopeOf(ts, "@when"), "entity.other.attribute-name.xpath");
  assert.equal(scopeOf(ts, "castable"), "keyword.operator.xpath");
  assert.equal(scopeOf(ts, "count(x)"), "string.quoted.double.xml");
  // No value templates outside XSLT.
  const plain = await tokens("text.xml", `<a href="{$x}"/>`);
  assert.equal(scopeOf(plain, "{$x}"), "string.quoted.double.xml");
});
