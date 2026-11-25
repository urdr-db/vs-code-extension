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
| `odd/letter.xml` | the TEI customisation `odd/letters.odd`, compiled in the editor (a minute the first time) | 2 problems |
| `xslt/letters-to-html.xsl` | XSLT 3.0 with an include | nothing |
| `xslt/broken.xsl` | XSLT 3.0 | problems one at a time |
| `xslt/tei-to-html.xsl`, `xslt/letter-pages.xsl` | XSLT 3.0, for transforming (below) | nothing |
| `xquery/main.xq` | XQuery 3.1 with a library module | nothing |
| `xquery/broken.xq` | XQuery 3.1 | problems one at a time |

Stylesheets and queries stop at their first error, as an XSLT or XQuery
processor does, so fix one to see the next.

Try breaking things too: misspell an element in `letters-valid.xml`, or
remove a `)` in `main.xq`.

## Transforming

- Open `tei/letter.xml` and press the preview button at the top right
  (**Open XSLT Preview to the Side**). It names its stylesheet,
  `xslt/tei-to-html.xsl`, itself. Change "Keswick" and watch the preview.
- Open `schemas/letters-valid.xml` and run **Urðr-XML: Transform with
  XSLT…** from the Command Palette. Pick "Letters to HTML", saved in
  `.vscode/settings.json`: it writes `out/letters-valid.html`.
- Open `xslt/letter-pages.xsl` and run the same command, picking "Letter
  pages". It runs without a source document, reads the letters with
  `doc()`, writes `out/index.html` and one page per letter, and its
  `xsl:message` shows in the **Urðr-XML: XSLT** output panel.
