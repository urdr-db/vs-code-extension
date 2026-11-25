// The XQuery grammar, run as VS Code runs it (vscode-textmate with the
// Oniguruma regular expressions).
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

async function grammar() {
  const wasm = readFileSync(join(dirname(require.resolve("vscode-oniguruma")), "onig.wasm"));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources: string[]) => new oniguruma.OnigScanner(sources),
      createOnigString: (s: string) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async () =>
      textmate.parseRawGrammar(readFileSync(join(here, "..", "syntaxes", "xquery.tmLanguage.json"), "utf8"), "xquery.tmLanguage.json"),
  });
  const g = await registry.loadGrammar("source.xquery");
  assert.ok(g);
  return g;
}

/** Each token's text with its innermost scope, line by line. */
async function tokens(text: string): Promise<Array<[string, string]>> {
  const g = await grammar();
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

test("the example queries get their colours", async () => {
  const main = readFileSync(join(here, "fixtures", "xquery", "main.xq"), "utf8");
  const t = await tokens(main);
  assert.equal(scopeOf(t, " Imports names.xqm from the same folder. No problems. "), "comment.block.xquery");
  assert.match(scopeOf(t, "import module")!, /keyword\.other\.prolog/);
  assert.equal(scopeOf(t, '"'), "string.quoted.double.xquery");
  assert.match(scopeOf(t, "let")!, /keyword\.control/);
  assert.match(scopeOf(t, "letters")!, /^variable/);
  assert.match(scopeOf(t, "doc")!, /entity\.name\.function\.call/);
  assert.match(scopeOf(t, "order by")!, /keyword\.control/);
  assert.match(scopeOf(t, "person", 2)!, /entity\.name\.tag/);
  assert.match(scopeOf(t, "person", 3)!, /^variable/);

  const lib = readFileSync(join(here, "fixtures", "xquery", "names.xqm"), "utf8");
  const l = await tokens(lib);
  assert.match(scopeOf(l, "n:people")!, /entity\.name\.function\.xquery/);
  assert.match(scopeOf(l, "xs:string")!, /support\.type/);
  assert.match(scopeOf(l, "document-node")!, /support\.type/);
});

test("XML in queries, and names that look like keywords", async () => {
  const t = await tokens(
    [
      `declare %private function local:f() { () };`,
      `for $x in //for/@return`,
      `where count($x) gt 2 (: nested (: comment :) :)`,
      `return <a href="{$x}" class='c'>if text { $x } &amp; <!-- c --><b/></a>`,
      `, if($x) then 1.5e3 else 'it''s', \`\`[x \`{ $x }\` y]\`\`, $x => string()`,
    ].join("\n"),
  );
  assert.match(scopeOf(t, "%private")!, /annotation/);
  assert.match(scopeOf(t, "local:f")!, /entity\.name\.function\.xquery/);
  // An element named "for" and an attribute named "return" are not keywords.
  assert.doesNotMatch(scopeOf(t, "for", 1) ?? "", /keyword/);
  assert.doesNotMatch(scopeOf(t, "@return") ?? "", /keyword/);
  assert.match(scopeOf(t, "count")!, /function\.call/);
  assert.match(scopeOf(t, "gt")!, /keyword\.operator\.word/);
  assert.equal(scopeOf(t, " nested "), "comment.block.xquery");
  assert.match(scopeOf(t, "href")!, /attribute-name/);
  assert.match(scopeOf(t, "x", 3)!, /^variable/); // inside the attribute's { }
  // Text in an element is text, not keywords.
  assert.ok(t.some(([s, sc]) => s.includes("if text") && !/keyword/.test(sc)));
  assert.match(scopeOf(t, "&amp;")!, /entity/);
  assert.match(scopeOf(t, "<!--")!, /comment/);
  assert.match(scopeOf(t, "b")!, /entity\.name\.tag/);
  assert.match(scopeOf(t, "if")!, /keyword\.control/);
  assert.match(scopeOf(t, "1.5e3")!, /numeric/);
  assert.match(scopeOf(t, "''")!, /escape/);
  assert.match(scopeOf(t, "=>")!, /arrow/);
  assert.match(scopeOf(t, "string")!, /function\.call/);
});
