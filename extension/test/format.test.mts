// Format and Indent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "../src/format.ts";

const TEI = `<?xml version="1.0"?>
<!-- top --><TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>A <hi>t</hi></title></titleStmt></fileDesc></teiHeader>
<text><body><div type="letter"><p><hi>one</hi><hi>two</hi></p>
<p xml:space="preserve">  <hi> x </hi>  </p><lb/><!-- c --></div></body></text></TEI>
`;

test("indents elements that hold only elements, and keeps mixed content as written", () => {
  const mixed = (ns: string, local: string) => ns === "http://www.tei-c.org/ns/1.0" && ["p", "title"].includes(local);
  const out = format(TEI, { indent: "  ", mixed });
  assert.equal(
    out,
    `<?xml version="1.0"?>
<!-- top -->
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title>A <hi>t</hi></title>
      </titleStmt>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div type="letter">
        <p><hi>one</hi><hi>two</hi></p>
        <p xml:space="preserve">  <hi> x </hi>  </p>
        <lb/>
        <!-- c -->
      </div>
    </body>
  </text>
</TEI>
`,
  );
  // Formatting again changes nothing.
  assert.equal(format(out!, { indent: "  ", mixed }), out);
});

test("without a schema, only an element holding text is kept as written", () => {
  const out = format(`<r><p><hi>a</hi><hi>b</hi></p><q>x <hi>y</hi></q></r>`, { indent: "\t" });
  assert.equal(out, "<r>\n\t<p>\n\t\t<hi>a</hi>\n\t\t<hi>b</hi>\n\t</p>\n\t<q>x <hi>y</hi></q>\n</r>");
});

test("keeps xsl:text and CDATA, and moves the lines of what it keeps", () => {
  const xsl = `<x:stylesheet xmlns:x="http://www.w3.org/1999/XSL/Transform"><x:template><x:text>
</x:text><b><x:value-of select="."/></b></x:template></x:stylesheet>`;
  assert.equal(
    format(xsl, { indent: "  " }),
    `<x:stylesheet xmlns:x="http://www.w3.org/1999/XSL/Transform">\n  <x:template>\n    <x:text>\n</x:text>\n    <b>\n      <x:value-of select="."/>\n    </b>\n  </x:template>\n</x:stylesheet>`,
  );
  assert.equal(format(`<r>\n<p>a\nb</p>\n</r>`, { indent: "  " }), `<r>\n  <p>a\n  b</p>\n</r>`);
  assert.equal(format(`<r><s><![CDATA[a\nb]]></s></r>`, { indent: "  " }), `<r>\n  <s><![CDATA[a\nb]]></s>\n</r>`);
  assert.equal(format(`﻿<r>\r\n<a/></r>\r\n`, { indent: " " }), `﻿<r>\r\n <a/>\r\n</r>\r\n`);
});

test("leaves a document whose tags don't match", () => {
  assert.equal(format(`<a><b></a>`, { indent: " " }), undefined);
  assert.equal(format(`<a><b x="1"</a>`, { indent: " " }), undefined);
  assert.equal(format(`<a/>text`, { indent: " " }), undefined);
});
