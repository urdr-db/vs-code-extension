# Architecture

## The pieces

- **The client** is what VS Code loads. It starts the language server
  and passes it the settings.
- **The language server** (`extension/src/service.ts`) runs apart from
  the editor, so long checks never slow it down. It watches the open
  documents and publishes what it finds as diagnostics, through the
  Language Server Protocol (LSP), which other editors speak too.
- **The core** (`core/`) is a Rust crate built on the Urðr crates,
  compiled to WebAssembly. The server loads it once and calls it for
  every check.

## Desktop and web

The same server runs in two places. What differs is behind one
interface, `Platform` (`extension/src/platform.ts`): how files are read,
where downloads and compiled ODDs are kept, and how the transformation
worker starts.

| | Desktop VS Code | VS Code for the Web |
|---|---|---|
| Client | `client.ts` | `client-web.ts` |
| Server | a Node process (`server.ts`, `node.ts`) | a web worker (`server-web.ts`, `web.ts`) |
| Workspace files | read from the disk | asked of the client, which reads them with `workspace.fs` |
| Kept texts | files in the extension's storage | asked of the client, kept in the extension's storage |
| Transformations | a worker thread (`transformer.ts`) | a web worker (`transformer-web.ts`) |
| The module and the TEI stylesheets | read from the disk | fetched from the extension's address |

The web bundles take `vscode-languageserver/node` from its browser half
(`extension/scripts/bundle.mjs`), and a test checks they need nothing
from Node. In the browser the server compiles the module once and hands
it to each transformation worker; a worker starts from a blob URL, as a
worker may only start one from its own origin.

## Checks are conversations

The core never reads files or the network. Every check is a conversation,
as in Urðr Studio's offline validator: the server passes the text and
every related file it has read so far; the core answers with the
problems it found and the files it still needs (`needed`); the server
reads those and asks again, until nothing new is needed
(`extension/src/converse.ts`).

The server reads needed files from open editors first, then the
workspace, then the web for `http(s)` addresses (`extension/src/reader.ts`). Each
download is kept in the extension's storage, so the TEI schemas are
fetched once.

## Placing problems

The validators report where a problem is as a path, such as
`/Q{http://www.tei-c.org/ns/1.0}TEI[1]/…/p[1]/@rend`. The server finds
that node in the text (`extension/src/locate.ts`, ported from Studio) and
marks the element's or attribute's name. Query and stylesheet errors come
with byte offsets or line and column, converted to VS Code's positions in
`extension/src/positions.ts`.

## Where the Urðr code comes from

The core depends on the Urðr crates by git, pinned in the workspace
`Cargo.toml`. Move every pin together. The extension never needs changes
to the Urðr database; where the crates need something, that goes to
dh--urdr as its own pull request first.

## Suggestions and hovers

For an XML document, the server finds the schemas it names from its
prolog and root start tag with patterns (`extension/src/hints.ts`), so
suggestions keep working while the document is half typed. The core
reads those schemas into an outline (`core/src/outline.rs`, the same
outline Studio suggests from): for each element, its children,
attributes and their values. The outline of the last schema set is kept,
so a grammar as large as `tei_all.rng` is read once.

Where the cursor is (after `<`, inside a start tag, inside quotes, in
text) is read from the text before it (`extension/src/context.ts`).
Documentation comes from the schema texts themselves: RELAX NG's
`a:documentation`, as the TEI schemas carry, and XSD's
`xs:documentation` (`extension/src/docs.ts`).

## Transformations and the preview

The core runs a stylesheet as Urðr's transform request does
(`core/src/transform.rs`), as a conversation too: besides included and
imported modules, the documents `doc()` and `unparsed-text()` read are
reported as needed. WebAssembly has no clock, so the server passes the
time for `current-dateTime()`. The core keeps the last few compiled
stylesheets, so a preview that runs again as the source changes does not
compile again.

A transformation can take long, or never end. The server runs it in a
worker (`extension/src/transformer.ts`, driven by
`extension/src/transforms.ts`) and stops the worker when it takes longer
than the time limit; the next transformation starts a new one.

Stylesheets such as TEI's recurse deeply: the WebAssembly module gets a
64 MiB stack (`.cargo/config.toml`), the Node worker a large V8 stack,
and calls may nest 3,000 deep before the run stops with
`urdr:LIMT0002`, short of where the stack would run out. A browser gives
its workers a smaller stack, but the TEI stylesheets still fit: an ODD
compiles in Chromium. If the stack runs out anyway, the worker is
replaced and the error says so.

The extension side (`extension/src/commands.ts`) picks the stylesheet,
asks the server with the `urdr/transform` request, and writes the results
or shows them. The preview is a webview with scripts off, allowed to load
only files from the workspace and the document's folder; its page
(`extension/src/preview-html.ts`) adds a content security policy and a
`<base>` so relative links and pictures resolve next to the document.

## ODD files

When a document's `<?xml-model?>` names an ODD, the server replaces that
instruction, before checking, with one that names a made-up URI,
`urdr-odd:rng:<the ODD's URI>` (`extension/src/odd.ts`). When the
validator or the outline asks for that URI, the reader compiles the ODD
instead of reading a file: odd2odd merges it with the TEI source, and
odd2relax turns the result into RELAX NG, both through the same worker
as other transformations. The RELAX NG carries the ODD's Schematron rules
embedded, as Urðr's validator reads them. The schema is kept in memory
and in the extension's storage under a hash of the ODD's text, the TEI
stylesheets' version and the TEI source, so an ODD compiles once.

The stylesheets and `p5subset.xml` ship in `extension/tei-stylesheets/`
(see its README), so ODDs compile offline.

## Editing elements

The Oxygen-style actions (`extension/src/editing.ts`) work on a tolerant
scan of the text's tags (`extension/src/elements.ts`), which skips
comments, CDATA, processing instructions and the DOCTYPE, and matches
start and end tags even in a half-edited document. They run in the
client, so they need no round trip, except **Surround with Tags**, which
asks the server (`urdr/elementsAt`) what the schema allows at the
selection, and which of those may also hold what is selected: its
top-level elements must be children the outline allows, and its text
allowed (order and counts are not checked). Renaming is the LSP rename request, answered by the server
from the same scan, which also answers linked editing.
