![Urðr-XML: TEI, XSLT and XQuery checking for VS Code](splash.png)

# Urðr-XML for VS Code

A VS Code extension for digital humanities work with XML: it checks TEI
and other XML documents against their schemas, and checks XSLT, XQuery
and XPath, using the engine of the [Urðr](https://github.com/silencesys/dh--urdr)
XML database. It needs no Urðr server and no Java: the engine runs inside
the extension as WebAssembly.

## What it does

| | Status |
|---|---|
| Validate XML against RELAX NG, XSD 1.1, Schematron and DTD, as named by `<?xml-model?>`, `xsi:schemaLocation` or `DOCTYPE` | ✓ |
| Download schemas named by `http(s)` address (such as the TEI schemas) once, and keep them | ✓ |
| Check XSLT 3.0 stylesheets, with their includes and imports | ✓ |
| Check XQuery 3.1 modules, with the library modules they import | ✓ |
| Suggestions from the schema while typing: child elements (with their required attributes), attributes, values, closing tags | ✓ |
| Hovers with the schema's documentation (such as TEI's), attributes and allowed content | ✓ |
| Run an XSLT 3.0 transformation on a document (**Transform with XSLT…**), with transforms saved in the workspace settings | ✓ |
| Live preview of a transformation to the side, as for Markdown, updated as you type | ✓ |
| TEI ODD files as schemas: a document whose `<?xml-model?>` names an `.odd` is checked against the RELAX NG and Schematron it compiles to | ✓ |

A file passes or fails the same way here as in Urðr and in Urðr Studio:
all three run the same validators.

## TEI ODD files

Name the ODD itself as the schema:

```xml
<?xml-model href="myproject.odd" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>
```

The extension compiles it with the TEI stylesheets (odd2odd and
odd2relax, which ship with it, as does the TEI P5 source they compile
against) on Urðr's XSLT engine, and checks the document against the
schema, its Schematron rules included. Suggestions and hovers come from
it too. Compiling takes from seconds to a few minutes the first time,
with a progress note; the result is kept until the ODD changes.
**Urðr-XML: Compile ODD to RELAX NG** (right-click an `.odd`) saves the
schema as a file. `urdr.odd.source` points at another TEI source
(`p5subset.xml`) when an ODD needs a different TEI version.

## Transforming with XSLT

- **Urðr-XML: Transform with XSLT…** (in the Command Palette, and on the
  right-click menu of XML and XSLT files) runs a stylesheet on the
  current document, or on a document you choose when a stylesheet is
  open. The result opens beside the document, or is written to a file.
- **Urðr-XML: Open XSLT Preview to the Side** (the preview button at the
  top right of the editor) shows the result beside the document and runs
  it again as you type in the document or the stylesheet. HTML is shown
  as a page; other results as text. Scripts in the result never run.

The stylesheet is the one a saved transform names for the document, else
the document's own `<?xml-stylesheet type="text/xsl" href="…"?>`, else
the extension asks. Transforms are saved in `.vscode/settings.json`:

```jsonc
"urdr.transforms": [
  {
    "name": "Letters to HTML",
    "stylesheet": "xslt/letters-to-html.xsl",
    "source": "letters/*.xml",                         // which documents it is for
    "output": "html/${fileBasenameNoExtension}.html",  // leave out to open the result in an editor
    "parameters": { "title": "Letters" }
  }
]
```

`xsl:include`, `xsl:import`, `doc()` and `unparsed-text()` read files
from open editors and the disk; `xsl:result-document` writes next to the
output. `xsl:message` texts go to the **Urðr-XML: XSLT** output panel. A
transformation that runs longer than `urdr.transform.timeout` seconds
(60) is stopped.

## Trying it

Install a build (`urdr-xml-<version>.vsix`) with **Extensions → … →
Install from VSIX…**, then open the [`examples`](examples) folder. Its
README lists what each file should show.

## How it is built

```
extension/   the VS Code extension (TypeScript): client, language server
core/        the Rust crate the language server runs, compiled to WebAssembly
docs/        how it works
```

See [docs/architecture.md](docs/architecture.md).

## Building

Needs Rust 1.100 with the `wasm32-unknown-unknown` target,
`wasm-bindgen-cli` 0.2.130 and Node 22. The Urðr crates come from the
private `silencesys/dh--urdr` repository, so building needs read access
to it.

```sh
cargo test --workspace
cd extension
npm ci
npm run build      # WebAssembly, type check, bundle
npm test
npx vsce package --no-dependencies
```

Install the `.vsix` with **Extensions → … → Install from VSIX**.

## License

MPL-2.0, as Urðr.
