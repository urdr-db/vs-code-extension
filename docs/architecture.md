# Architecture

## The pieces

- **The client** (`extension/src/client.ts`) is what VS Code loads. It
  starts the language server and passes it the settings.
- **The language server** (`extension/src/server.ts`) runs in its own
  Node process, so long checks never slow down the editor. It watches the
  open documents and publishes what it finds as diagnostics, through the
  Language Server Protocol (LSP), which other editors speak too.
- **The core** (`core/`) is a Rust crate built on the Urðr crates,
  compiled to WebAssembly. The server loads it once and calls it for
  every check.

## Checks are conversations

The core never reads files or the network. Every check is a conversation,
as in Urðr Studio's offline validator: the server passes the text and
every related file it has read so far; the core answers with the
problems it found and the files it still needs (`needed`); the server
reads those and asks again, until nothing new is needed
(`extension/src/converse.ts`).

An everyday picture: a proofreader at home with no library. They read the
manuscript, write down which style guides it cites that they do not have,
someone brings those, and they read it again.

This keeps the same module usable in the browser (vscode.dev), where
there is no disk.

The server reads needed files from open editors first, then the disk,
then the web for `http(s)` addresses (`extension/src/reader.ts`). Each
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
worker thread (`extension/src/transformer.ts`, driven by
`extension/src/transforms.ts`) and stops the worker when it takes longer
than the time limit; the next transformation starts a new one. The
WebAssembly module gets a 16 MiB stack (`.cargo/config.toml`), since
stylesheets such as TEI's recurse deeply.

The extension side (`extension/src/commands.ts`) picks the stylesheet,
asks the server with the `urdr/transform` request, and writes the results
or shows them. The preview is a webview with scripts off, allowed to load
only files from the workspace and the document's folder; its page
(`extension/src/preview-html.ts`) adds a content security policy and a
`<base>` so relative links and pictures resolve next to the document.
