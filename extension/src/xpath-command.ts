// "Evaluate XPath": asks for an expression, runs it on the open document
// in the language server, and lists the results; moving through the list
// shows each node in the editor.
import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import { pathAt } from "./elements.ts";
import { locate } from "./locate.ts";
import { locatablePath, readablePath, type XPathAnswer, type XPathItem } from "./xpath.ts";

type Item = vscode.QuickPickItem & { result?: XPathItem };

export function registerXPath(context: vscode.ExtensionContext, client: () => BaseLanguageClient | undefined): void {
  let last = "";

  /** Asks for an expression until it runs; undefined if given up. */
  const ask = (editor: vscode.TextEditor, c: BaseLanguageClient) =>
    new Promise<{ expression: string; answer: XPathAnswer } | undefined>((resolve) => {
      const input = vscode.window.createInputBox();
      input.title = "Evaluate XPath";
      input.prompt = "An XPath 3.1 expression, run on this document. Unprefixed names are in the root element's namespace.";
      input.value = last || pathAt(editor.document.getText(), editor.document.offsetAt(editor.selection.active)) || "//";
      let done = false;
      input.onDidChangeValue(() => (input.validationMessage = undefined));
      input.onDidAccept(async () => {
        const expression = input.value.trim();
        if (!expression) return;
        input.busy = true;
        const answer = await c
          .sendRequest<XPathAnswer>("urdr/evaluateXPath", { uri: editor.document.uri.toString(), expression })
          .catch((e: unknown): XPathAnswer => ({ count: 0, items: [], error: e instanceof Error ? e.message : String(e) }));
        input.busy = false;
        if (answer.error) {
          input.validationMessage = answer.error;
          return;
        }
        last = expression;
        done = true;
        resolve({ expression, answer });
        input.hide();
      });
      input.onDidHide(() => {
        if (!done) resolve(undefined);
        input.dispose();
      });
      input.show();
    });

  const rangeOf = (doc: vscode.TextDocument, r: XPathItem) => {
    if (r.path === undefined) return undefined;
    const path = locatablePath(r.path);
    const text = doc.getText();
    if (path === "" || path === "/") return new vscode.Range(0, 0, 0, 0);
    const at = locate(text, path);
    return at ? new vscode.Range(doc.positionAt(at.start), doc.positionAt(at.end)) : undefined;
  };

  const show = (editor: vscode.TextEditor, expression: string, answer: XPathAnswer) => {
    const qp = vscode.window.createQuickPick<Item>();
    const shown = answer.items.length < answer.count ? `the first ${answer.items.length} of ${answer.count}` : `${answer.count}`;
    qp.title = `${shown} ${answer.count === 1 ? "result" : "results"} for ${expression}`;
    qp.placeholder = answer.count ? "Filter the results; Enter goes to one" : "No results";
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.items = answer.items.map((r) =>
      r.path !== undefined
        ? { label: readablePath(r.path), description: r.kind === "element" || r.kind === "attribute" ? undefined : r.kind, detail: r.text || undefined, result: r }
        : { label: r.text || "(empty string)", result: r },
    );
    const before = editor.selection;
    const visible = editor.visibleRanges[0];
    const go = (item: Item | undefined, select: boolean) => {
      const range = item?.result && rangeOf(editor.document, item.result);
      if (!range) return;
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      editor.selection = select ? new vscode.Selection(range.start, range.end) : new vscode.Selection(range.start, range.start);
    };
    let accepted = false;
    qp.onDidChangeActive((items) => go(items[0], false));
    qp.onDidAccept(() => {
      accepted = true;
      go(qp.selectedItems[0], true);
      qp.hide();
    });
    qp.onDidHide(() => {
      if (!accepted) {
        editor.selection = before;
        if (visible) editor.revealRange(visible, vscode.TextEditorRevealType.AtTop);
      }
      qp.dispose();
    });
    qp.show();
  };

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand("urdr.evaluateXPath", async (editor) => {
      const c = client();
      if (!c) return void vscode.window.showWarningMessage("The Urðr-XML language server is not running yet.");
      const run = await ask(editor, c);
      if (run) show(editor, run.expression, run.answer);
    }),
  );
}
