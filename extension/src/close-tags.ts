// Closing tags as they are typed (closing.ts says what is added), while
// the setting urdr.autoCloseTags is on.
import * as vscode from "vscode";
import { closingFor } from "./closing.ts";

/** Closes tags as they are typed in XML and XSLT editors while
 * `urdr.autoCloseTags` is on. */
export function registerCloseTags(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const doc = e.document;
      if (doc.languageId !== "xml" && doc.languageId !== "xsl") return;
      // Only one character typed, not a paste, an undo or several cursors.
      if (e.reason !== undefined || e.contentChanges.length !== 1) return;
      const change = e.contentChanges[0]!;
      if (change.rangeLength !== 0 || (change.text !== ">" && change.text !== "/")) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== doc) return;
      if (!vscode.workspace.getConfiguration("urdr", doc).get<boolean>("autoCloseTags", true)) return;
      const offset = change.rangeOffset + 1;
      const close = closingFor(doc.getText(), offset, change.text);
      if (!close) return;
      const at = doc.positionAt(offset);
      const version = doc.version;
      void editor
        .edit((b) => b.insert(at, close.insert), { undoStopBefore: false, undoStopAfter: false })
        .then((done) => {
          if (!done || doc.version !== version + 1) return;
          const caret = doc.positionAt(offset + close.caret);
          editor.selection = new vscode.Selection(caret, caret);
        });
    }),
  );
}
