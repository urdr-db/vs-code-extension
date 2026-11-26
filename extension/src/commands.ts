// "Transform with XSLT…" and "Open XSLT Preview to the Side". The
// language server runs the transformations; this side picks the
// stylesheet, writes or shows the results, and keeps the preview fresh.
import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import type { TransformAnswer } from "./core.ts";
import { registerCaretPath } from "./caret.ts";
import { registerEditing } from "./editing.ts";
import { registerXPath } from "./xpath-command.ts";
import { describe, expand, previewPage, stylesheetHref } from "./preview-html.ts";
import type { TransformParams } from "./transforms.ts";

/** A transform saved in the settings (`urdr.transforms`). Paths are
 * relative to the workspace folder. */
interface SavedTransform {
  name?: string;
  stylesheet: string;
  /** Glob of the documents it applies to; leave out for none. */
  source?: string;
  /** Where to write the result. `${fileBasenameNoExtension}`,
   * `${fileDirname}` and `${workspaceFolder}` are filled in. */
  output?: string;
  parameters?: Record<string, string>;
  initialTemplate?: string;
  initialMode?: string;
}

/** A transformation chosen for a document. */
interface Choice {
  label: string;
  stylesheet: vscode.Uri;
  source: vscode.Uri | undefined;
  saved?: SavedTransform;
  folder?: vscode.WorkspaceFolder;
  /** Offer to save it in the settings afterwards. */
  offerToSave?: boolean;
}

const XSLT_NS = "http://www.w3.org/1999/XSL/Transform";
const isStylesheet = (doc: vscode.TextDocument) =>
  doc.languageId === "xsl" || (doc.languageId === "xml" && doc.getText(new vscode.Range(0, 0, 60, 0)).includes(XSLT_NS));

function resolveIn(folder: vscode.WorkspaceFolder | undefined, path: string, near: vscode.Uri): vscode.Uri {
  if (/^[a-z][\w+.-]*:\/\//i.test(path)) return vscode.Uri.parse(path);
  if (path.startsWith("/") || /^[a-z]:[\\/]/i.test(path)) return vscode.Uri.file(path);
  return vscode.Uri.joinPath(folder?.uri ?? vscode.Uri.joinPath(near, ".."), path);
}

function saved(doc: vscode.TextDocument): Choice[] {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const list = vscode.workspace.getConfiguration("urdr", doc.uri).get<SavedTransform[]>("transforms", []);
  const out: Choice[] = [];
  for (const t of list) {
    if (!t?.stylesheet) continue;
    const stylesheet = resolveIn(folder, t.stylesheet, doc.uri);
    const name = t.name ?? t.stylesheet;
    if (isStylesheet(doc)) {
      if (stylesheet.toString() === doc.uri.toString()) {
        // Run from the stylesheet: on its source, if that is one file.
        const source = t.source && !/[*?{[]/.test(t.source) ? resolveIn(folder, t.source, doc.uri) : undefined;
        out.push({ label: name, stylesheet, source, saved: t, folder });
      }
    } else if (t.source && folder && vscode.languages.match({ pattern: new vscode.RelativePattern(folder, t.source) }, doc) > 0) {
      out.push({ label: name, stylesheet, source: doc.uri, saved: t, folder });
    }
  }
  return out;
}

function fromInstruction(doc: vscode.TextDocument): Choice | undefined {
  const href = stylesheetHref(doc.getText());
  if (!href) return undefined;
  const stylesheet = /^[a-z][\w+.-]*:/i.test(href) ? vscode.Uri.parse(href) : vscode.Uri.joinPath(doc.uri, "..", href);
  return { label: `${href} (from <?xml-stylesheet?>)`, stylesheet, source: doc.uri, offerToSave: true };
}

async function ask(doc: vscode.TextDocument, options: Choice[]): Promise<Choice | undefined> {
  const other = isStylesheet(doc) ? "Choose a source document…" : "Choose a stylesheet…";
  const noSource = "Run without a source document";
  const items: (vscode.QuickPickItem & { choice?: Choice })[] = options.map((c) => ({ label: c.label, choice: c }));
  items.push({ label: other });
  if (isStylesheet(doc)) items.push({ label: noSource, detail: "Starts at xsl:initial-template" });
  const picked = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, { placeHolder: "Transform with which stylesheet?" });
  if (!picked) return undefined;
  if (picked.choice) return picked.choice;
  if (picked.label === noSource) return { label: noSource, stylesheet: doc.uri, source: undefined, offerToSave: true };
  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.joinPath(doc.uri, ".."),
    filters: isStylesheet(doc) ? { XML: ["xml", "tei", "odd"], "All files": ["*"] } : { XSLT: ["xsl", "xslt"], "All files": ["*"] },
    openLabel: isStylesheet(doc) ? "Transform this document" : "Use this stylesheet",
  });
  const file = files?.[0];
  if (!file) return undefined;
  return isStylesheet(doc)
    ? { label: vscode.workspace.asRelativePath(file), stylesheet: doc.uri, source: file, offerToSave: true }
    : { label: vscode.workspace.asRelativePath(file), stylesheet: file, source: doc.uri, offerToSave: true };
}

function params(choice: Choice, output: vscode.Uri | undefined): TransformParams {
  return {
    stylesheet: choice.stylesheet.toString(),
    source: choice.source?.toString() ?? null,
    parameters: choice.saved?.parameters ?? {},
    initialTemplate: choice.saved?.initialTemplate ?? null,
    initialMode: choice.saved?.initialMode ?? null,
    output: output?.toString() ?? null,
  };
}

function outputUri(choice: Choice): vscode.Uri | undefined {
  const template = choice.saved?.output;
  if (!template) return undefined;
  const near = choice.source ?? choice.stylesheet;
  const name = near.path.split("/").pop() ?? "";
  const path = expand(template, {
    fileBasenameNoExtension: name.replace(/\.[^.]*$/, ""),
    fileBasename: name,
    fileDirname: vscode.Uri.joinPath(near, "..").fsPath,
    workspaceFolder: choice.folder?.uri.fsPath ?? "",
  });
  return resolveIn(choice.folder, path, near);
}

const LANGUAGE: Record<string, string> = { html: "html", xhtml: "html", xml: "xml", json: "json", text: "plaintext", adaptive: "plaintext" };

/** Saves `choice` in the workspace settings. */
async function save(choice: Choice): Promise<void> {
  const config = vscode.workspace.getConfiguration("urdr", choice.source ?? choice.stylesheet);
  const list = config.get<SavedTransform[]>("transforms", []);
  const rel = (u: vscode.Uri) => vscode.workspace.asRelativePath(u, false);
  const entry: SavedTransform = { name: choice.stylesheet.path.split("/").pop() ?? "Transform", stylesheet: rel(choice.stylesheet) };
  if (choice.source) entry.source = rel(choice.source);
  else entry.initialTemplate = "xsl:initial-template";
  await config.update("transforms", [...list, entry], vscode.ConfigurationTarget.Workspace);
  void vscode.window.showInformationMessage("Saved in the workspace settings as urdr.transforms. Add \"output\" there to write the result to a file.");
}

export function register(context: vscode.ExtensionContext, client: () => BaseLanguageClient | undefined): void {
  registerEditing(context, client);
  registerCaretPath(context);
  registerXPath(context, client);
  const log = vscode.window.createOutputChannel("Urðr-XML: XSLT");
  context.subscriptions.push(log);

  const run = async (p: TransformParams): Promise<TransformAnswer> => {
    const c = client();
    if (!c) throw new Error("the Urðr-XML language server is not running");
    return c.sendRequest<TransformAnswer>("urdr/transform", p);
  };

  const showMessages = (answer: TransformAnswer, label: string) => {
    if (!answer.messages.length) return;
    log.appendLine(`[${new Date().toLocaleTimeString()}] ${label}`);
    for (const m of answer.messages) log.appendLine(m);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("urdr.transform", async (resource?: vscode.Uri) => {
      const doc = resource ? await vscode.workspace.openTextDocument(resource) : vscode.window.activeTextEditor?.document;
      if (!doc) {
        void vscode.window.showWarningMessage("Open an XML document or a stylesheet first.");
        return;
      }
      const options = saved(doc);
      const pi = isStylesheet(doc) ? undefined : fromInstruction(doc);
      if (pi) options.push(pi);
      const choice = await ask(doc, options);
      if (!choice) return;
      const output = outputUri(choice);
      const answer = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Transforming with ${choice.label}…`, cancellable: false },
        () => run(params(choice, output)),
      );
      showMessages(answer, choice.label);
      const principal = answer.results[0];
      if (answer.problems.length || !principal) {
        const p = answer.problems[0];
        const open = "Open stylesheet";
        const pick = await vscode.window.showErrorMessage(p ? describe(p) : "The transformation gave no result.", open);
        if (pick === open) {
          const at = p?.line ? new vscode.Position(p.line - 1, Math.max(0, p.column - 1)) : undefined;
          await vscode.window.showTextDocument(p?.uri ? vscode.Uri.parse(p.uri) : choice.stylesheet, at ? { selection: new vscode.Range(at, at) } : {});
        }
        return;
      }
      if (output) {
        const enc = new TextEncoder();
        await vscode.workspace.fs.writeFile(output, enc.encode(principal.text));
        for (const r of answer.results.slice(1)) {
          await vscode.workspace.fs.writeFile(vscode.Uri.parse(new URL(r.href, output.toString()).href), enc.encode(r.text));
        }
        const more = answer.results.length > 1 ? ` and ${answer.results.length - 1} more` : "";
        const openIt = "Open";
        if ((await vscode.window.showInformationMessage(`Wrote ${vscode.workspace.asRelativePath(output)}${more}.`, openIt)) === openIt) {
          await vscode.window.showTextDocument(output, { viewColumn: vscode.ViewColumn.Beside });
        }
        return;
      }
      const shown = await vscode.workspace.openTextDocument({ content: principal.text, language: LANGUAGE[principal.method] ?? "plaintext" });
      await vscode.window.showTextDocument(shown, { viewColumn: vscode.ViewColumn.Beside });
      const notes: string[] = [];
      if (answer.results.length > 1) notes.push(`The stylesheet made ${answer.results.length - 1} more document(s); they are written only when the transform has an "output".`);
      if (choice.offerToSave) {
        const keep = "Save this transform";
        if ((await vscode.window.showInformationMessage([...notes, "Use this transform again?"].join(" "), keep)) === keep) await save(choice);
      } else if (notes.length) void vscode.window.showInformationMessage(notes.join(" "));
    }),
  );

  // An ODD's schema as a file, for tools that need it on disk.
  context.subscriptions.push(
    vscode.commands.registerCommand("urdr.compileOdd", async (resource?: vscode.Uri) => {
      const odd = resource ?? vscode.window.activeTextEditor?.document.uri;
      const c = client();
      if (!odd || !c) return;
      const answer = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Compiling ${odd.path.split("/").pop()}… (a minute or more the first time)` },
        () => c.sendRequest<{ rng?: string; error?: string }>("urdr/compileOdd", { odd: odd.toString() }),
      );
      if (answer.error || answer.rng === undefined) {
        void vscode.window.showErrorMessage(answer.error ?? "The ODD could not be compiled.");
        return;
      }
      const target = await vscode.window.showSaveDialog({
        defaultUri: odd.with({ path: odd.path.replace(/(\.odd)?$/i, ".rng") }),
        filters: { "RELAX NG": ["rng"] },
        saveLabel: "Save the RELAX NG schema",
      });
      if (!target) return;
      const enc = new TextEncoder();
      await vscode.workspace.fs.writeFile(target, enc.encode(answer.rng));
      void vscode.window.showInformationMessage(`Wrote ${vscode.workspace.asRelativePath(target)}, with the ODD's Schematron rules embedded.`);
    }),
  );

  const previews = new Map<string, Preview>();
  context.subscriptions.push(
    vscode.commands.registerCommand("urdr.preview", async (resource?: vscode.Uri) => {
      const doc = resource ? await vscode.workspace.openTextDocument(resource) : vscode.window.activeTextEditor?.document;
      if (!doc) {
        void vscode.window.showWarningMessage("Open an XML document or a stylesheet first.");
        return;
      }
      const key = doc.uri.toString();
      const open = previews.get(key);
      if (open) {
        open.panel.reveal(vscode.ViewColumn.Beside, true);
        return;
      }
      // A saved transform, else the document's own <?xml-stylesheet?>,
      // else ask.
      const options = saved(doc);
      const pi = isStylesheet(doc) ? undefined : fromInstruction(doc);
      const choice = options.length === 1 ? options[0] : !options.length && pi ? pi : await ask(doc, pi ? [...options, pi] : options);
      if (!choice) return;
      const preview = new Preview(choice, run, (a) => showMessages(a, choice.label));
      previews.set(key, preview);
      preview.panel.onDidDispose(() => previews.delete(key));
    }),
  );
}

/** A live preview of one transformation, run again as its files change. */
class Preview {
  readonly panel: vscode.WebviewPanel;
  private readonly choice: Choice;
  private readonly run: (p: TransformParams) => Promise<TransformAnswer>;
  private readonly messages: (a: TransformAnswer) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private lastGood: TransformAnswer | undefined;
  private readonly watched: Set<string>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(choice: Choice, run: (p: TransformParams) => Promise<TransformAnswer>, messages: (a: TransformAnswer) => void) {
    this.choice = choice;
    this.run = run;
    this.messages = messages;
    const near = choice.source ?? choice.stylesheet;
    const roots = [...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri), vscode.Uri.joinPath(near, "..")];
    const name = near.path.split("/").pop() ?? "";
    this.panel = vscode.window.createWebviewPanel(
      "urdr.preview",
      `Preview ${name}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false, localResourceRoots: roots },
    );
    this.watched = new Set([choice.stylesheet.toString(), ...(choice.source ? [choice.source.toString()] : [])]);
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.watched.has(e.document.uri.toString())) this.schedule(300);
      }),
      // Included modules and documents read with doc() change on save.
      vscode.workspace.onDidSaveTextDocument(() => this.schedule(0)),
    );
    this.panel.onDidDispose(() => {
      clearTimeout(this.timer);
      for (const d of this.disposables) d.dispose();
    });
    this.panel.webview.html = `<!DOCTYPE html><html><body style="font-family:sans-serif;opacity:.6;padding:1em">Transforming with ${choice.label.replace(/</g, "&lt;")}…</body></html>`;
    this.schedule(0);
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    let answer: TransformAnswer;
    try {
      answer = await this.run(params(this.choice, undefined));
    } catch (e) {
      answer = { results: [], messages: [], needed: [], problems: [{ code: "", message: e instanceof Error ? e.message : String(e), start: null, end: null, line: 0, column: 0, uri: null }] };
    }
    // A newer run has started meanwhile: its answer wins.
    if (generation !== this.generation) return;
    this.messages(answer);
    const near = this.choice.source ?? this.choice.stylesheet;
    const base = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(near, "..")).toString().replace(/\/?$/, "/");
    const failed = !answer.results.length;
    if (!failed) this.lastGood = answer;
    const shown = failed && this.lastGood ? { ...this.lastGood, problems: answer.problems, messages: answer.messages } : answer;
    this.panel.webview.html = previewPage(shown, { cspSource: this.panel.webview.cspSource, base, stale: failed && !!this.lastGood });
  }
}
