# Examples

Open this folder in VS Code with the extension installed, then open each
file. Problems show as squiggles and in the **Problems** panel
(View → Problems). Each file says at the top what it should find.

| File | Checks | Expect |
|---|---|---|
| `schemas/letters-valid.xml` | RELAX NG + Schematron | nothing |
| `schemas/letters-invalid.xml` | RELAX NG + Schematron | 4 problems |
| `schemas/catalogue.xml` | XSD | 2 problems |
| `schemas/poem.xml` | DTD | 1 problem |
| `tei/letter.xml` | TEI Lite from tei-c.org (needs internet the first time) | 2 problems |
| `xslt/letters-to-html.xsl` | XSLT 3.0 with an include | nothing |
| `xslt/broken.xsl` | XSLT 3.0 | problems one at a time |
| `xquery/main.xq` | XQuery 3.1 with a library module | nothing |
| `xquery/broken.xq` | XQuery 3.1 | problems one at a time |

Stylesheets and queries stop at their first error, as an XSLT or XQuery
processor does, so fix one to see the next.

Try breaking things too: misspell an element in `letters-valid.xml`, or
remove a `)` in `main.xq`.
