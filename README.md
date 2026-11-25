![Urðr-XML: TEI, XSLT and XQuery checking for VS Code](splash.png)

# Urðr-XML

Urðr-XML checks TEI and other XML documents against their schemas as you
type, and checks XSLT, XQuery and XPath. It runs and previews XSLT
transformations, and it reads TEI ODD files as schemas.

It uses the engine of Urðr, an XML database for digital humanities work,
built into the extension as WebAssembly. You don't need Java, Saxon or an
Urðr server.

## Getting started

Install **Urðr-XML** from the Extensions view, then open an XML file that
names its schema. It works in desktop VS Code and in VS Code for the Web
(vscode.dev and github.dev). Problems show up in the editor and in the **Problems**
panel.

The [examples folder](examples) has a document for each feature, and its
README says what each file should show. You can download it as
`urdr-xml-examples.zip` from the
[Releases](https://github.com/urdr-db/vs-code-extension/releases) page.

## Validation

A document is checked against the schemas it names:

- `<?xml-model?>` processing instructions, for RELAX NG (XML or compact
  syntax), Schematron and XSD;
- `xsi:schemaLocation` and `xsi:noNamespaceSchemaLocation`, for XSD 1.1;
- a `DOCTYPE`, for DTDs.

For example, a TEI document:

```xml
<?xml-model href="https://tei-c.org/release/xml/tei/custom/schema/relaxng/tei_all.rng"
            type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>
```

Schemas given by a web address are downloaded the first time and kept,
so the TEI schemas are read once. Turn this off with
`urdr.validation.fetchRemoteSchemas`.

XSLT 3.0 stylesheets and XQuery 3.1 modules are checked too, with the
stylesheets they include or import and the library modules they import.
They stop at the first error, as an XSLT or XQuery processor does, so
fix one to see the next.
XQuery files also get syntax colours, which VS Code doesn't have on its own.

## Suggestions and hovers

While you type, the schema suggests the elements allowed at that point
(with their required attributes), attributes, attribute values and the
closing tag. Hovering over an element or attribute shows the schema's
documentation for it, such as the TEI Guidelines' description, along
with its attributes and what it may contain.

## TEI ODD files

A document can name an ODD as its schema:

```xml
<?xml-model href="myproject.odd" type="application/xml"
            schematypens="http://relaxng.org/ns/structure/1.0"?>
```

The extension compiles the ODD with the TEI Stylesheets (odd2odd, then
odd2relax) and checks the document against the result, including the
ODD's Schematron constraints. Suggestions and hovers use it too.

The first compile takes from a few seconds for a small ODD to a few
minutes for `tei_all`, with a progress note. The
result is kept until the ODD changes, also between sessions.

The TEI Stylesheets and the TEI P5 source (`p5subset.xml`, version
4.12.0) ship with the extension. To compile against another TEI version,
set `urdr.odd.source` to its `p5subset.xml`.

To save the schema as a file, right-click the `.odd` and choose
**Compile ODD to RELAX NG**.

## Transforming with XSLT

**Transform with XSLT…** runs a stylesheet on the current document. With
a stylesheet open, it asks for the document to run it on. The result
opens beside the document, or is written to a file. You'll find the
command in the Command Palette and on the right-click menu of XML and
XSLT files.

**Open XSLT Preview to the Side** (the preview button at the top right of
the editor) shows the result next to the document, and updates it as you
edit the document or the stylesheet. HTML results are shown as a page,
with scripts turned off. Other results are shown as text.

The extension picks the stylesheet in this order:

1. a saved transform whose `source` matches the document;
2. the document's own `<?xml-stylesheet type="text/xsl" href="…"?>`;
3. otherwise it asks.

Save transforms in the workspace's `.vscode/settings.json`:

```jsonc
"urdr.transforms": [
  {
    "name": "Letters to HTML",
    "stylesheet": "xslt/letters-to-html.xsl",
    "source": "letters/*.xml",
    "output": "html/${fileBasenameNoExtension}.html",
    "parameters": { "title": "Letters" }
  }
]
```

Leave out `output` to open the result in an editor. A transform can also
set `initialTemplate` and `initialMode`.

`xsl:include`, `xsl:import`, `doc()` and `unparsed-text()` read from open
editors and from disk. `xsl:result-document` writes files next to the
output. `xsl:message` output goes to the **Urðr-XML: XSLT** output panel.

## Settings

| Setting | Default | |
|---|---|---|
| `urdr.validation.enabled` | `true` | Check XML documents against their schemas. |
| `urdr.validation.fetchRemoteSchemas` | `true` | Download schemas named by `http(s)` address. |
| `urdr.checkDelay` | `400` | Milliseconds to wait after typing stops before checking. |
| `urdr.transforms` | `[]` | Saved XSLT transforms (see above). |
| `urdr.transform.timeout` | `60` | Seconds a transformation may run before it is stopped. |
| `urdr.odd.source` | | The `p5subset.xml` that ODDs compile against. Empty uses the bundled TEI P5 4.12.0. |

## Limitations

- In VS Code for the Web (vscode.dev, github.dev), schemas named by web
  address download only from sites that let browser pages read them
  (CORS). Schemas in the workspace always work.
- `collection()` and `uri-collection()` aren't available in transformations.

## Reporting problems

Please open an issue on
[GitHub](https://github.com/urdr-db/vs-code-extension/issues) with the
document and schema (or a small part of them) that show the problem.

To build the extension yourself, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MPL-2.0. The bundled TEI Stylesheets and TEI P5 source keep their own
licenses; see [extension/tei-stylesheets/README.md](extension/tei-stylesheets/README.md).
