// Suggestions in XQuery files: keywords, the engine's functions, what
// the module and its imports declare, and the variables in scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtins } from "../src/core.ts";
import { loadFrom } from "../src/node.ts";
import { load } from "../src/code-nav.ts";
import { xqueryModule } from "../src/xquery-symbols.ts";
import { suggestQuery } from "../src/xquery-complete.ts";

loadFrom(join(dirname(fileURLToPath(import.meta.url)), "..", "wasm"));

const LIB = `module namespace m = "urn:m";
declare variable $m:base := 1;
declare function m:greet($who) { "hi " || $who };
`;
const files: Record<string, string> = { "file:///q/lib.xqm": LIB };

/** The labels suggested at `|`. */
async function labels(marked: string, explicit = false): Promise<string[]> {
  const i = marked.indexOf("|");
  const text = marked.slice(0, i) + marked.slice(i + 1);
  const modules = await load("file:///q/main.xq", text, async (u) => files[u], xqueryModule);
  return suggestQuery(modules, i, builtins(), explicit).map((s) => s.label);
}

test("the engine's functions, by prefix", async () => {
  const got = await labels("map:|");
  assert.ok(got.includes("map:get") && got.includes("map:merge"), got.join());
  assert.ok(!got.some((l) => l.startsWith("fn:")));
  const plain = await labels("con|");
  assert.ok(plain.includes("concat") && plain.includes("contains") && plain.includes("count"));
  assert.ok(plain.includes("let") && plain.includes("map:"));
});

test("a function's call puts the cursor between the parentheses", async () => {
  const text = "cou";
  const modules = await load("file:///q/main.xq", text, async () => undefined, xqueryModule);
  const s = suggestQuery(modules, 3, builtins());
  assert.equal(s.find((x) => x.label === "count")?.insert, "count($0)");
  assert.equal(s.find((x) => x.label === "current-date")?.insert, "current-date()");
});

test("functions and variables the module and its imports declare", async () => {
  const main = `import module namespace m = "urn:m" at "lib.xqm";
declare function local:twice($x) { $x * 2 };
`;
  const fns = await labels(`${main}m:|`);
  assert.ok(fns.includes("m:greet"), fns.join());
  assert.ok((await labels(`${main}loc|`)).includes("local:twice"));
  assert.deepEqual(await labels(`${main}$|`), ["$m:base"]);
});

test("variables in scope, the nearest first", async () => {
  assert.deepEqual(await labels(`for $a in 1 to 3 let $b := $a return $|`), ["$b", "$a"]);
  // Out of a function's body, its parameter is gone.
  assert.deepEqual(await labels(`declare function local:f($p) { $p }; $|`), []);
});

test("nothing in comments, strings or element constructors", async () => {
  assert.deepEqual(await labels(`(: con| :)`), []);
  assert.deepEqual(await labels(`"con|"`), []);
  assert.deepEqual(await labels(`<con|`), []);
});
