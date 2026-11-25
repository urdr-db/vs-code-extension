// The language server: checks open documents with the Rust core and
// publishes what it finds as diagnostics.
import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { check, validate, type Kind } from "./core.ts";
import { locate } from "./locate.ts";
import { byteToIndex, indexToPosition, lineColumnToIndex, wordEnd } from "./positions.ts";
import { makeReader, type Settings } from "./reader.ts";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let settings: Settings = { validation: true, fetchRemote: true, delay: 400, cacheDir: undefined };

connection.onInitialize((params) => {
  const options = (params.initializationOptions ?? {}) as Partial<Settings>;
  settings = { ...settings, ...options };
  return { capabilities: { textDocumentSync: TextDocumentSyncKind.Incremental } };
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
    };
  }
  documents.all().forEach((d) => schedule(d, 0));
});

const XSLT_NS = "http://www.w3.org/1999/XSL/Transform";

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
  const read = makeReader(settings, (uri) => documents.get(uri)?.getText());
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
  const report = await validate(uri, text, read);
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
  if (report.needed?.length) {
    out.push({
      range: range(text, 0, 1),
      severity: DiagnosticSeverity.Warning,
      source: "Urðr XML",
      message: report.note || `Could not read ${report.needed.join(", ")}`,
    });
  }
  return out;
}

function languageName(language: string): string {
  return ({ "relax-ng": "RELAX NG", xsd: "XSD", schematron: "Schematron", dtd: "DTD" } as Record<string, string>)[language] ?? language;
}

documents.onDidOpen((e) => schedule(e.document, 0));
documents.onDidChangeContent((e) => schedule(e.document));
documents.onDidClose((e) => {
  clearTimeout(timers.get(e.document.uri));
  versions.delete(e.document.uri);
  void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
