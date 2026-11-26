// The language server: checks open documents with the Rust core and
// publishes what it finds as diagnostics. The same in desktop VS Code
// (server.ts) and in VS Code for the Web (server-web.ts); the bundle for
// the web takes "vscode-languageserver/node" from its browser half.
import {
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  type CompletionItem,
  type Connection,
  Diagnostic,
  DiagnosticSeverity,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { check, outline, validate, type Kind } from "./core.ts";
import { readDocs } from "./docs.ts";
import { schemaHints } from "./hints.ts";
import { hover, Index, mayHold, selectionContent, suggest } from "./suggest.ts";
import { tagNames } from "./elements.ts";
import { idAt, idProblems, links } from "./ids.ts";
import { contextAt } from "./context.ts";
import { locate } from "./locate.ts";
import { byteToIndex, indexToPosition, lineColumnToIndex, wordEnd } from "./positions.ts";
import { makeReader, type Settings } from "./reader.ts";
import { Transformer, type TransformParams } from "./transforms.ts";
import { ODD_RNG, OddCompiler, oddReader, rewriteOddModels } from "./odd.ts";
import type { Platform } from "./platform.ts";

/** Serves the client on `connection`. */
export function serve(connection: Connection, platform: Platform): void {
  const documents = new TextDocuments(TextDocument);

  let settings: Settings = { validation: true, fetchRemote: true, delay: 400, transformTimeout: 60, oddSource: "" };
  const reader = () => makeReader(settings, (uri) => documents.get(uri)?.getText(), platform);

  connection.onInitialize(async (params) => {
    const options = (params.initializationOptions ?? {}) as Partial<Settings>;
    settings = { ...settings, ...options };
    await platform.init(options);
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: ["<", "/", " ", '"', "'", ":"] },
        hoverProvider: true,
        renameProvider: { prepareProvider: true },
        definitionProvider: true,
        referencesProvider: true,
        linkedEditingRangeProvider: true,
      },
    };
  });

  connection.onDidChangeConfiguration((change) => {
    const u = (change.settings as { urdr?: Record<string, unknown> } | undefined)?.urdr;
    if (u) {
      const v = u["validation"] as { enabled?: boolean; fetchRemoteSchemas?: boolean } | undefined;
      settings = {
        ...settings,
        validation: v?.enabled ?? settings.validation,
        fetchRemote: v?.fetchRemoteSchemas ?? settings.fetchRemote,
        delay: (u["checkDelay"] as number | undefined) ?? settings.delay,
        transformTimeout: (u["transform"] as { timeout?: number } | undefined)?.timeout ?? settings.transformTimeout,
        oddSource: (u["odd"] as { source?: string } | undefined)?.source ?? settings.oddSource,
      };
    }
    documents.all().forEach((d) => schedule(d, 0));
  });

  const XSLT_NS = "http://www.w3.org/1999/XSL/Transform";
  const TEI_NS = "http://www.tei-c.org/ns/1.0";

  /** What to check a document as, by its language and, for XML, its root. */
  function kindOf(doc: TextDocument): Kind | "xml" | undefined {
    if (doc.languageId === "xquery") return "xquery";
    if (doc.languageId === "xsl") return "xslt";
    if (doc.languageId === "xml") {
      const head = doc.getText().slice(0, 4000);
      return head.includes(XSLT_NS) && /<([\w-]+:)?(stylesheet|transform|package)[\s>]/.test(head) ? "xslt" : "xml";
    }
    return undefined;
  }

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const versions = new Map<string, number>();

  function schedule(doc: TextDocument, delay = settings.delay): void {
    clearTimeout(timers.get(doc.uri));
    timers.set(
      doc.uri,
      setTimeout(() => {
        timers.delete(doc.uri);
        void run(doc);
      }, delay),
    );
  }

  async function run(doc: TextDocument): Promise<void> {
    const kind = kindOf(doc);
    if (!kind) return;
    const version = doc.version;
    versions.set(doc.uri, version);
    const text = doc.getText();
    const read = reader();
    let diagnostics: Diagnostic[];
    try {
      diagnostics = kind === "xml" ? await xmlDiagnostics(doc.uri, text, read) : await codeDiagnostics(kind, doc.uri, text, read);
    } catch (e) {
      connection.console.error(`Checking ${doc.uri} failed: ${e instanceof Error ? e.stack : String(e)}`);
      return;
    }
    // A newer check has started meanwhile: its answer wins.
    if (versions.get(doc.uri) !== version) return;
    void connection.sendDiagnostics({ uri: doc.uri, version, diagnostics });
  }

  function range(text: string, start: number, end: number) {
    return { start: indexToPosition(text, start), end: indexToPosition(text, Math.max(end, start + 1)) };
  }

  async function codeDiagnostics(kind: Kind, uri: string, text: string, read: ReturnType<typeof makeReader>): Promise<Diagnostic[]> {
    const answer = await check(kind, uri, text, read);
    return answer.problems.map((p) => {
      let start = 0;
      let end = 1;
      if (p.start !== null) {
        start = byteToIndex(text, p.start);
        end = byteToIndex(text, p.end ?? p.start);
        if (end <= start) end = wordEnd(text, start);
      } else if (p.line > 0 && !p.uri) {
        start = lineColumnToIndex(text, p.line, Math.max(1, p.column));
        end = wordEnd(text, start);
      }
      const where = p.uri ? `${p.uri}${p.line ? `, line ${p.line}` : ""}: ` : "";
      return {
        range: range(text, start, end),
        severity: DiagnosticSeverity.Error,
        code: p.code,
        source: kind === "xslt" ? "Urðr XSLT" : kind === "xpath" ? "Urðr XPath" : "Urðr XQuery",
        message: where + p.message,
      };
    });
  }

  async function xmlDiagnostics(uri: string, text: string, read: ReturnType<typeof makeReader>): Promise<Diagnostic[]> {
    if (!settings.validation) return [];
    // An ODD named as the schema is compiled, and its schemas checked
    // against instead.
    const { text: checked, odds } = rewriteOddModels(text, (ref) => new URL(ref, uri).href);
    const failures = new Map<string, string>();
    const report = await validate(uri, checked, odds.length ? oddReader(read, odds_, failures) : read);
    if (report.error) {
      // Not well-formed: the parser says where, in bytes.
      const at = /\(at byte (\d+)\)/.exec(report.error.message);
      const start = at ? byteToIndex(text, Number(at[1])) : 0;
      return [
        {
          range: range(text, start, start + 1),
          severity: DiagnosticSeverity.Error,
          code: report.error.code,
          source: "Urðr XML",
          message: report.error.message.replace(/\s*\(at byte \d+\)/, ""),
        },
      ];
    }
    const out: Diagnostic[] = (report.issues ?? []).map((i) => {
      const at = i.path ? locate(text, i.path) : undefined;
      return {
        range: range(text, at?.start ?? 0, at?.end ?? 1),
        severity: i.severity === "warning" ? DiagnosticSeverity.Warning : i.severity === "info" ? DiagnosticSeverity.Information : DiagnosticSeverity.Error,
        code: i.constraint || undefined,
        source: `Urðr ${languageName(i.language)}`,
        message: i.message,
      };
    });
    // Schemas the document names that could not be read: say so once, at
    // the top. A document that names no schema gets no message.
    for (const [odd, why] of failures) {
      const name = odd.slice(odd.lastIndexOf("/") + 1);
      const at = Math.max(0, text.indexOf(name));
      out.push({ range: range(text, at, at + name.length), severity: DiagnosticSeverity.Error, source: "Urðr ODD", message: why });
    }
    // In TEI, ids given twice and #pointers to ids the document lacks.
    if (text.slice(0, 4000).includes(TEI_NS)) {
      for (const p of idProblems(links(text))) {
        out.push({
          range: range(text, p.start, p.end),
          severity: p.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
          source: "Urðr TEI",
          message: p.message,
        });
      }
    }
    const needed = (report.needed ?? []).filter((n) => !n.startsWith(ODD_RNG));
    if (needed.length) {
      out.push({
        range: range(text, 0, 1),
        severity: DiagnosticSeverity.Warning,
        source: "Urðr XML",
        message: report.note || `Could not read ${needed.join(", ")}`,
      });
    }
    return out;
  }

  function languageName(language: string): string {
    return ({ "relax-ng": "RELAX NG", xsd: "XSD", schematron: "Schematron", dtd: "DTD" } as Record<string, string>)[language] ?? language;
  }

  // Suggestions and hovers: an index of the schema each XML document
  // names, kept while the names stay the same.
  const indexes = new Map<string, Promise<Index | undefined>>();

  function indexFor(doc: TextDocument): Promise<Index | undefined> {
    const { text } = rewriteOddModels(doc.getText(), (ref) => new URL(ref, doc.uri).href);
    const hints = schemaHints(text, (ref) => new URL(ref, doc.uri).href);
    if (!hints.length) return Promise.resolve(undefined);
    const key = JSON.stringify(hints);
    let p = indexes.get(key);
    if (!p) {
      const read = oddReader(reader(), odds_);
      p = outline(hints, read).then(({ answer, files }) => {
        if (!answer.outline) {
          // Nothing to suggest from yet (a schema not readable): try again
          // next time rather than keep the miss.
          indexes.delete(key);
          return undefined;
        }
        return new Index(answer.outline, readDocs(Object.values(files)));
      });
      p.catch(() => indexes.delete(key));
      indexes.set(key, p);
    }
    return p;
  }

  const KINDS = {
    element: CompletionItemKind.Class,
    close: CompletionItemKind.Class,
    attribute: CompletionItemKind.Property,
    value: CompletionItemKind.Value,
  } as const;

  connection.onCompletion(async (params): Promise<CompletionItem[]> => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc || kindOf(doc) !== "xml") return [];
    const text = doc.getText();
    const offset = doc.offsetAt(params.position);
    const ids = idsAfterHash(doc, text, offset, params.position);
    const index = await indexFor(doc).catch(() => undefined);
    if (!index) return ids;
    return [...ids, ...suggest(text, offset, index).map((s, i) => ({
      label: s.label,
      kind: KINDS[s.kind],
      detail: s.detail,
      documentation: s.documentation ? { kind: MarkupKind.Markdown, value: s.documentation } : undefined,
      // Required attributes first, then the schema's order.
      sortText: `${s.required ? "0" : "1"}${String(i).padStart(5, "0")}`,
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { range: { start: doc.positionAt(s.start), end: params.position }, newText: s.insert },
      command: s.retrigger ? { title: "Suggest values", command: "editor.action.triggerSuggest" } : undefined,
    }))];
  });

  /** After `#` in an attribute value, the document's ids. */
  function idsAfterHash(doc: TextDocument, text: string, offset: number, position: { line: number; character: number }): CompletionItem[] {
    const place = contextAt(text, offset).place;
    if (place.kind !== "value" || place.attribute === "xml:id") return [];
    const token = /\S*$/.exec(place.partial)![0];
    if (!token.startsWith("#")) return [];
    const start = doc.positionAt(offset - token.length + 1);
    return [...new Set(links(text).ids.map((s) => s.id))].map((id) => ({
      label: id,
      kind: CompletionItemKind.Reference,
      detail: "xml:id",
      sortText: `0${id}`,
      textEdit: { range: { start, end: position }, newText: id },
    }));
  }

  connection.onHover(async (params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc || kindOf(doc) !== "xml") return null;
    const index = await indexFor(doc).catch(() => undefined);
    if (!index) return null;
    const h = hover(doc.getText(), doc.offsetAt(params.position), index);
    if (!h) return null;
    return {
      contents: { kind: MarkupKind.Markdown, value: h.markdown },
      range: { start: doc.positionAt(h.start), end: doc.positionAt(h.end) },
    };
  });

  // Renaming an element renames its end tag too.
  const markup = (uri: string) => {
    const doc = documents.get(uri);
    const kind = doc && kindOf(doc);
    return kind === "xml" || kind === "xslt" ? doc : undefined;
  };
  const namesAt = (uri: string, position: { line: number; character: number }) => {
    const doc = markup(uri);
    if (!doc) return undefined;
    const ranges = tagNames(doc.getText(), doc.offsetAt(position));
    return ranges?.map((r) => ({ start: doc.positionAt(r.start), end: doc.positionAt(r.end) }));
  };
  // An id, as an xml:id or a #pointer: its declarations and every use.
  const idRanges = (uri: string, position: { line: number; character: number }) => {
    const doc = markup(uri);
    if (!doc) return undefined;
    const text = doc.getText();
    const l = links(text);
    const at = idAt(l, doc.offsetAt(position));
    if (!at) return undefined;
    const toRange = (s: { start: number; end: number }) => ({ start: doc.positionAt(s.start), end: doc.positionAt(s.end) });
    return {
      at: toRange(at.span),
      declarations: l.ids.filter((s) => s.id === at.id).map(toRange),
      uses: l.pointers.filter((p) => !p.document && p.id === at.id).map(toRange),
    };
  };
  connection.onPrepareRename(
    (params) =>
      namesAt(params.textDocument.uri, params.position)?.find((r) => r.start.line === params.position.line && r.start.character <= params.position.character && params.position.character <= r.end.character) ??
      idRanges(params.textDocument.uri, params.position)?.at ??
      null,
  );
  connection.onRenameRequest((params) => {
    const ranges = namesAt(params.textDocument.uri, params.position);
    const ids = ranges ? undefined : idRanges(params.textDocument.uri, params.position);
    const all = ranges ?? (ids ? [...ids.declarations, ...ids.uses] : undefined);
    if (!all) return null;
    return { changes: { [params.textDocument.uri]: all.map((range) => ({ range, newText: params.newName.replace(/^#/, "") })) } };
  });
  connection.onReferences((params) => {
    const ids = idRanges(params.textDocument.uri, params.position);
    if (!ids) return null;
    const ranges = [...(params.context.includeDeclaration ? ids.declarations : []), ...ids.uses];
    return ranges.map((range) => ({ uri: params.textDocument.uri, range }));
  });
  // From a pointer to the element with that xml:id, here or in the
  // document the pointer names (people.xml#ana).
  connection.onDefinition(async (params) => {
    const doc = markup(params.textDocument.uri);
    if (!doc) return null;
    const offset = doc.offsetAt(params.position);
    const pointer = links(doc.getText()).pointers.find((p) => p.start <= offset && offset <= p.end);
    if (!pointer) return null;
    let uri = doc.uri;
    let text: string | undefined = doc.getText();
    if (pointer.document) {
      try {
        uri = new URL(pointer.document, doc.uri).href;
      } catch {
        return null;
      }
      text = await reader()(uri);
    }
    if (text === undefined) return null;
    const target = links(text).ids.find((s) => s.id === pointer.id);
    if (!target) return null;
    return { uri, range: { start: indexToPosition(text, target.start), end: indexToPosition(text, target.end) } };
  });
  connection.languages.onLinkedEditingRange((params) => {
    const ranges = namesAt(params.textDocument.uri, params.position);
    return ranges && ranges.length > 1 ? { ranges, wordPattern: "[^\\s<>/\"'=]+" } : null;
  });

  // The elements allowed at an offset, for "Surround with Tags": what the
  // schema would suggest after a "<" typed there. With a selection up to
  // `end`, each says whether it may also hold what is selected.
  connection.onRequest("urdr/elementsAt", async (params: { uri: string; offset: number; end?: number }) => {
    const doc = markup(params.uri);
    if (!doc) return [];
    const index = await indexFor(doc).catch(() => undefined);
    if (!index) return [];
    const text = doc.getText();
    const content = params.end !== undefined && params.end > params.offset ? selectionContent(text, params.offset, params.end) : undefined;
    const grouped = content && (content.text || content.elements.length > 0) ? content : undefined;
    const typed = text.slice(0, params.offset) + "<" + text.slice(params.offset);
    return suggest(typed, params.offset + 1, index)
      .filter((s) => s.kind === "element")
      .map((s) => ({
        name: s.label,
        required: [...s.insert.matchAll(/ ([^\s=]+)="\$\d+"/g)].map((m) => m[1]!),
        detail: s.detail,
        fits: grouped && s.name ? mayHold(index.element(s.name), grouped) : undefined,
      }));
  });

  // XSLT transformations, for the "Transform with XSLT" command and the
  // preview.
  const transformer = new Transformer(platform.spawn);
  connection.onRequest("urdr/transform", (params: TransformParams) => transformer.transform(params, reader(), settings.transformTimeout * 1000));
  connection.onShutdown(() => transformer.stop());

  // TEI ODD files, compiled with the TEI stylesheets that ship with the
  // extension.
  const odds_ = new OddCompiler(transformer, {
    stylesheets: () => platform.teiStylesheets(),
    source: () => settings.oddSource || new URL("source/p5subset.xml", platform.teiStylesheets()).href,
    store: platform.store("odd"),
    started: (odd) => {
      let ended = false;
      let report: { done(): void } | undefined;
      void connection.window
        .createWorkDoneProgress()
        .then((r) => {
          r.begin(`Compiling ${odd.slice(odd.lastIndexOf("/") + 1)}`, undefined, "an ODD takes a minute or more the first time");
          report = r;
          if (ended) r.done();
        })
        .catch(() => undefined);
      return () => {
        ended = true;
        report?.done();
      };
    },
  });
  connection.onRequest("urdr/compileOdd", async (params: { odd: string }) => {
    try {
      return await odds_.compile(params.odd, reader());
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  documents.onDidOpen((e) => schedule(e.document, 0));
  documents.onDidChangeContent((e) => schedule(e.document));
  documents.onDidClose((e) => {
    clearTimeout(timers.get(e.document.uri));
    versions.delete(e.document.uri);
    void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  documents.listen(connection);
  connection.listen();
}
