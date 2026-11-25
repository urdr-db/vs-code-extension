// The extension: starts the language server and passes it the settings.
import * as vscode from "vscode";
import { register } from "./commands.ts";
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  register(context, () => client);
  const module = context.asAbsolutePath("out/server.js");
  const server: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6019"] } },
  };
  const config = vscode.workspace.getConfiguration("urdr");
  const options: LanguageClientOptions = {
    documentSelector: [
      { language: "xml" },
      { language: "xsl" },
      { language: "xquery" },
    ],
    synchronize: { configurationSection: "urdr" },
    initializationOptions: {
      validation: config.get<boolean>("validation.enabled", true),
      fetchRemote: config.get<boolean>("validation.fetchRemoteSchemas", true),
      delay: config.get<number>("checkDelay", 400),
      cacheDir: vscode.Uri.joinPath(context.globalStorageUri, "schemas").fsPath,
      transformTimeout: config.get<number>("transform.timeout", 60),
      oddSource: config.get<string>("odd.source", ""),
    },
  };
  client = new LanguageClient("urdr", "Urðr-XML", server, options);
  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
