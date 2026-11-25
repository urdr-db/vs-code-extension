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
| Suggestions and hovers from the schema while typing | planned |
| TEI ODD files as schemas (compiled with the TEI stylesheets on Urðr's XSLT engine) | planned |
| Run an XSLT transformation, saved transforms, live preview to the side | planned |

A file passes or fails the same way here as in Urðr and in Urðr Studio:
all three run the same validators.

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
