// TEI ODD files as schemas: finding them in the prolog, and compiling
// one with the TEI stylesheets that ship with the extension. Needs the
// bundled worker: run `npm run build` first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validate } from "../src/core.ts";
import { dirStore, loadFrom, threads } from "../src/node.ts";
import { schemaHints } from "../src/hints.ts";
import { ODD_RNG, OddCompiler, oddReader, rewriteOddModels } from "../src/odd.ts";
import { Transformer } from "../src/transforms.ts";

const here = dirname(fileURLToPath(import.meta.url));
loadFrom(join(here, "..", "wasm"));
const stylesheets = pathToFileURL(join(here, "..", "tei-stylesheets")).href + "/";
const disk = (u: string) => readFile(fileURLToPath(u), "utf8").catch(() => undefined);

test("an xml-model that names an ODD becomes one that names its RELAX NG, over as many lines", () => {
  const text = `<?xml version="1.0"?>\n<?xml-model href="../odd/my.odd"\n  type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>\n<?xml-model href="x.rng"?>\n<TEI/>`;
  const { text: out, odds } = rewriteOddModels(text, (r) => new URL(r, "file:///e/doc/a.xml").href);
  assert.deepEqual(odds, ["file:///e/odd/my.odd"]);
  assert.equal(out.split("\n").length, text.split("\n").length);
  assert.ok(out.includes(`<?xml-model href="${ODD_RNG}file:///e/odd/my.odd" schematypens="http://relaxng.org/ns/structure/1.0"?>`));
  assert.ok(out.includes(`<?xml-model href="x.rng"?>`));
  // Suggestions come from the compiled schema.
  assert.deepEqual(schemaHints(out, (r) => new URL(r, "file:///e/doc/a.xml").href), [{ language: "rng", uri: `${ODD_RNG}file:///e/odd/my.odd` }]);
  // The TEI namespace as schema type names an ODD too; other documents stay as they are.
  assert.equal(rewriteOddModels(`<?xml-model href="p.xml" schematypens="http://www.tei-c.org/ns/1.0"?><TEI/>`, (r) => r).odds.length, 1);
  const plain = `<?xml-model href="a.rng"?><TEI/>`;
  assert.equal(rewriteOddModels(plain, (r) => r).text, plain);
});

test("compiles an ODD to RELAX NG with its Schematron rules, keeps it, and checks documents against it", async () => {
  const transformer = new Transformer(threads(join(here, "..", "out", "transformer.js")));
  const cache = await mkdtemp(join(tmpdir(), "urdr-odd-"));
  const started: string[] = [];
  const compiler = new OddCompiler(transformer, {
    stylesheets: () => stylesheets,
    source: () => new URL("source/p5subset.xml", stylesheets).href,
    store: dirStore(() => cache),
    started: (odd) => (started.push(odd), () => undefined),
  });
  // A small customisation: TEI's core and header, with <p> and <hi> only
  // in the text, and a rule that <hi> needs @rend.
  const odd = "file:///odd/mini.odd";
  const files: Record<string, string> = {
    [odd]: `<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:sch="http://purl.oclc.org/dsdl/schematron">
  <teiHeader><fileDesc><titleStmt><title>Mini</title></titleStmt><publicationStmt><p/></publicationStmt><sourceDesc><p/></sourceDesc></fileDesc></teiHeader>
  <text><body>
    <schemaSpec ident="mini" start="TEI">
      <moduleRef key="tei"/>
      <moduleRef key="header" include="teiHeader fileDesc titleStmt publicationStmt sourceDesc"/>
      <moduleRef key="core" include="p hi title"/>
      <moduleRef key="textstructure" include="TEI text body"/>
      <elementSpec ident="hi" mode="change">
        <constraintSpec ident="hi-rend" scheme="schematron" mode="add">
          <constraint><sch:rule context="tei:hi"><sch:assert test="@rend">hi needs @rend</sch:assert></sch:rule></constraint>
        </constraintSpec>
      </elementSpec>
    </schemaSpec>
  </body></text>
</TEI>`,
  };
  const read = async (u: string) => files[u] ?? disk(u);
  try {
    const compiled = await compiler.compile(odd, read);
    assert.match(compiled.rng, /<element name="hi"/);
    assert.doesNotMatch(compiled.rng, /<element name="persName"/);
    assert.match(compiled.rng, /hi needs @rend/);
    assert.equal((await readdir(cache)).length, 1);
    // Kept: the same text is not compiled again, even by a new compiler.
    const again = new OddCompiler(transformer, { stylesheets: () => stylesheets, source: () => new URL("source/p5subset.xml", stylesheets).href, store: dirStore(() => cache), started: (o) => (started.push(o), () => undefined) });
    assert.deepEqual(await again.compile(odd, read), compiled);
    assert.equal(started.length, 1);

    const doc = `<?xml-model href="../odd/mini.odd" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>T</title></titleStmt><publicationStmt><p/></publicationStmt><sourceDesc><p/></sourceDesc></fileDesc></teiHeader>
<text><body><p>A <hi>b</hi> <persName>c</persName></p></body></text></TEI>`;
    const { text } = rewriteOddModels(doc, (r) => new URL(r, "file:///doc/a.xml").href);
    const report = await validate("file:///doc/a.xml", text, oddReader(read, compiler));
    const messages = (report.issues ?? []).map((i) => `${i.language}: ${i.message}`);
    assert.ok(messages.some((m) => m.startsWith("relax-ng") && /persName/.test(m)), messages.join("\n"));
    assert.ok(messages.some((m) => m.startsWith("schematron") && /hi needs @rend/.test(m)), messages.join("\n"));

    const failures = new Map<string, string>();
    const missing = await oddReader(read, compiler, failures)(`${ODD_RNG}file:///odd/none.odd`);
    assert.equal(missing, undefined);
    assert.match(failures.get("file:///odd/none.odd") ?? "", /cannot be read/);
  } finally {
    transformer.stop();
  }
});
