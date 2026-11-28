// The keymap presets: every key the extension adds belongs to one preset
// of urdr.keymap, only in XML and XSLT editors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
const bindings: Array<{ command: string; key: string; mac?: string; when: string }> = pkg.contributes.keybindings;
const presets: string[] = pkg.contributes.configuration.properties["urdr.keymap"].enum;

test("each key belongs to a preset other than VS Code's", () => {
  assert.deepEqual(presets, ["oxygen", "xmlspy", "vscode"]);
  for (const b of bindings) {
    const m = /config\.urdr\.keymap == '(\w+)'/.exec(b.when);
    assert.ok(m && presets.includes(m[1]!) && m[1] !== "vscode", `${b.command}: ${b.when}`);
    assert.match(b.when, /editorLangId == xml \|\| editorLangId == xsl/);
  }
});

test("no preset puts two commands on one key", () => {
  const seen = new Map<string, string>();
  for (const b of bindings) {
    const preset = /keymap == '(\w+)'/.exec(b.when)![1]!;
    for (const k of [`${b.key}`, `mac:${b.mac ?? b.key}`]) {
      const id = `${preset} ${k}`;
      assert.ok(!seen.has(id) || seen.get(id) === b.command, `${id}: ${seen.get(id)} and ${b.command}`);
      seen.set(id, b.command);
    }
  }
});

test("Oxygen's keys stay off for those who turned the older setting off", () => {
  for (const b of bindings.filter((b) => b.when.includes("'oxygen'"))) assert.match(b.when, /config\.urdr\.oxygenShortcuts/);
});
