// Editing actions on elements, as in Oxygen XML Editor: Surround with
// Tags, Surround with the last tag, Delete Element Tags, Split Element,
// Join Elements, Rename Element, Format and Indent, Select Element and
// Go to Matching Tag. Each is a command in the Command
// Palette; package.json gives them Oxygen's keys while the setting
// urdr.oxygenShortcuts is on.
import * as vscode from "vscode";
import type { BaseLanguageClient, TextEdit } from "vscode-languageclient";
import { deleteTags, join, matchingTag, selectElement, split, type Edit } from "./elements.ts";

interface Allowed {
  name: string;
  required: string[];
  detail?: string;
  /** Whether it may also hold the selection; absent with no selection. */
  fits?: boolean;
}

/** A tag to wrap with: its name, and what else to write in the start tag. */
interface Wrap {
  name: string;
  attributes: string;
  required: string[];
}

const escapeSnippet = (s: string) => s.replace(/[$}\\]/g, (c) => "\\" + c);

function snippet(w: Wrap): vscode.SnippetString {
  let tab = 1;
  const required = w.required.map((a) => ` ${escapeSnippet(a)}="$${tab++}"`).join("");
  const name = escapeSnippet(w.name);
  return new vscode.SnippetString(`<${name}${escapeSnippet(w.attributes)}${required}>\${TM_SELECTED_TEXT}$0</${name}>`);
}

/** What the user typed in the picker: a name, perhaps with attributes. */
function parseTyped(typed: string): Wrap | undefined {
  const m = /^\s*<?\s*([^\s<>/"'=]+)(.*?)\s*\/?>?\s*$/.exec(typed);
  if (!m) return undefined;
  const attributes = m[2]!.trim();
  return { name: m[1]!, attributes: attributes ? ` ${attributes}` : "", required: [] };
}

async function pick(allowed: Allowed[]): Promise<Wrap | undefined> {
  type Item = vscode.QuickPickItem & { wrap?: Wrap };
  const qp = vscode.window.createQuickPick<Item>();
  qp.title = "Surround with Tags";
  qp.placeholder = allowed.length ? "Element name (the schema's choices are listed)" : "Element name, such as hi or hi rend=\"italic\"";
  const item = (a: Allowed): Item => ({ label: a.name, description: a.detail, wrap: { name: a.name, attributes: "", required: a.required } });
  const separator = (label: string): Item => ({ label, kind: vscode.QuickPickItemKind.Separator });
  // With a selection, the elements that may also hold it come first, then
  // the others allowed there.
  const fit = allowed.filter((a) => a.fits === true);
  const other = allowed.filter((a) => a.fits !== true);
  const grouped = allowed.some((a) => a.fits !== undefined);
  const listed: Item[] = grouped
    ? [
        ...(fit.length ? [separator("Fits the selection"), ...fit.map(item)] : []),
        ...(other.length ? [separator(fit.length ? "Allowed here" : "Allowed here, but none fits the selection"), ...other.map(item)] : []),
      ]
    : allowed.map(item);
  const update = () => {
    const typed = parseTyped(qp.value);
    const exact = typed && allowed.some((a) => a.name === qp.value.trim());
    qp.items = typed && !exact ? [{ label: qp.value.trim(), description: "as typed", wrap: typed, alwaysShow: true }, ...listed] : listed;
  };
  update();
  qp.onDidChangeValue(update);
  return new Promise((resolve) => {
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0]?.wrap ?? parseTyped(qp.value));
      qp.hide();
    });
    qp.onDidHide(() => {
      resolve(undefined);
      qp.dispose();
    });
    qp.show();
  });
}

async function apply(editor: vscode.TextEditor, edits: Edit[], caret?: number): Promise<void> {
  const doc = editor.document;
  await editor.edit((b) => {
    for (const e of edits) b.replace(new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
  });
  if (caret !== undefined) {
    const p = doc.positionAt(caret);
    editor.selection = new vscode.Selection(p, p);
  }
}

export function registerEditing(context: vscode.ExtensionContext, client: () => BaseLanguageClient | undefined): void {
  let last: Wrap | undefined;
  const surround = async (editor: vscode.TextEditor, w: Wrap) => {
    last = w;
    // The selected text comes in through TM_SELECTED_TEXT, which VS Code
    // does not re-indent.
    await editor.insertSnippet(snippet(w), editor.selections);
  };
  const say = (message: string) => void vscode.window.setStatusBarMessage(message, 4000);
  const offset = (editor: vscode.TextEditor) => editor.document.offsetAt(editor.selection.active);

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand("urdr.surroundWithTags", async (editor) => {
      const c = client();
      const at = editor.document.offsetAt(editor.selection.start);
      const end = editor.document.offsetAt(editor.selection.end);
      const allowed = c
        ? await c.sendRequest<Allowed[]>("urdr/elementsAt", { uri: editor.document.uri.toString(), offset: at, end }).catch(() => [] as Allowed[])
        : [];
      const w = await pick(allowed);
      if (w) await surround(editor, w);
    }),
    vscode.commands.registerTextEditorCommand("urdr.surroundWithLastTag", async (editor) => {
      if (last) await surround(editor, last);
      else await vscode.commands.executeCommand("urdr.surroundWithTags");
    }),
    vscode.commands.registerTextEditorCommand("urdr.deleteElementTags", async (editor) => {
      const edits = deleteTags(editor.document.getText(), offset(editor));
      if (edits) await apply(editor, edits);
      else say("No element here to remove the tags of.");
    }),
    vscode.commands.registerTextEditorCommand("urdr.splitElement", async (editor) => {
      const s = split(editor.document.getText(), offset(editor));
      if (s) await apply(editor, [s.edit], s.caret);
      else say("Put the caret inside an element's content to split it.");
    }),
    vscode.commands.registerTextEditorCommand("urdr.joinElements", async (editor) => {
      const e = join(editor.document.getText(), offset(editor));
      if (e) await apply(editor, [e], e.start + e.text.length);
      else say("Put the caret between two elements with the same name and attributes to join them.");
    }),
    vscode.commands.registerTextEditorCommand("urdr.renameElement", () => vscode.commands.executeCommand("editor.action.rename")),
    // Asks this extension's server, not whichever formatter VS Code
    // would choose for XML.
    vscode.commands.registerTextEditorCommand("urdr.formatAndIndent", async (editor) => {
      const c = client();
      if (!c) return;
      const { tabSize, insertSpaces } = editor.options;
      const edits = await c.sendRequest<TextEdit[] | null>("textDocument/formatting", {
        textDocument: { uri: editor.document.uri.toString() },
        options: { tabSize: typeof tabSize === "number" ? tabSize : 2, insertSpaces: insertSpaces !== false },
      });
      if (!edits?.length) return;
      const converted = await c.protocol2CodeConverter.asTextEdits(edits);
      await editor.edit((b) => converted?.forEach((e) => b.replace(e.range, e.newText)));
    }),
    vscode.commands.registerTextEditorCommand("urdr.selectElement", (editor) => {
      const doc = editor.document;
      const r = selectElement(doc.getText(), doc.offsetAt(editor.selection.start), doc.offsetAt(editor.selection.end));
      if (!r) return say("No element around the selection.");
      editor.selection = new vscode.Selection(doc.positionAt(r.start), doc.positionAt(r.end));
      editor.revealRange(editor.selection);
    }),
    vscode.commands.registerTextEditorCommand("urdr.goToMatchingTag", (editor) => {
      const doc = editor.document;
      const to = matchingTag(doc.getText(), offset(editor));
      if (to === undefined) return say("No tag here to match.");
      const p = doc.positionAt(to);
      editor.selection = new vscode.Selection(p, p);
      editor.revealRange(editor.selection);
    }),
  );
}
