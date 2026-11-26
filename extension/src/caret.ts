// The caret's place in the document, as a path of elements in the status
// bar (`/TEI/text/body/div[2]/p[3]`), and "Copy XPath", which copies it.
// Like any status bar entry, it can be hidden from the bar's menu.
import * as vscode from "vscode";
import { pathAt } from "./elements.ts";

const markup = (doc: vscode.TextDocument) => doc.languageId === "xml" || doc.languageId === "xsl";

export function registerCaretPath(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem("urdr.caretPath", vscode.StatusBarAlignment.Left, 100);
  item.name = "Urðr-XML: Caret Path";
  item.command = "urdr.copyXPath";
  item.tooltip = "Copy XPath";
  const pathOf = (editor: vscode.TextEditor | undefined) =>
    editor && markup(editor.document) ? pathAt(editor.document.getText(), editor.document.offsetAt(editor.selection.active)) : undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const editor = vscode.window.activeTextEditor;
      const path = pathOf(editor);
      if (path) {
        item.text = `$(list-tree) ${path}`;
        item.show();
      } else item.hide();
    }, 150);
  };

  context.subscriptions.push(
    item,
    vscode.window.onDidChangeTextEditorSelection(update),
    vscode.window.onDidChangeActiveTextEditor(update),
    { dispose: () => clearTimeout(timer) },
    vscode.commands.registerCommand("urdr.copyXPath", async () => {
      const path = pathOf(vscode.window.activeTextEditor);
      if (!path) return void vscode.window.setStatusBarMessage("Put the caret inside an element to copy its XPath.", 4000);
      await vscode.env.clipboard.writeText(path);
      vscode.window.setStatusBarMessage(`Copied ${path}`, 3000);
    }),
  );
  update();
}
