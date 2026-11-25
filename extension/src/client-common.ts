// What the desktop client (client.ts) and the web client (client-web.ts)
// share: the documents served and the settings passed to the server.
import * as vscode from "vscode";
import type { LanguageClientOptions } from "vscode-languageclient";

export function clientOptions(extra: Record<string, unknown>): LanguageClientOptions {
  const config = vscode.workspace.getConfiguration("urdr");
  return {
    documentSelector: [{ language: "xml" }, { language: "xsl" }, { language: "xquery" }],
    synchronize: { configurationSection: "urdr" },
    initializationOptions: {
      validation: config.get<boolean>("validation.enabled", true),
      fetchRemote: config.get<boolean>("validation.fetchRemoteSchemas", true),
      delay: config.get<number>("checkDelay", 400),
      transformTimeout: config.get<number>("transform.timeout", 60),
      oddSource: config.get<string>("odd.source", ""),
      ...extra,
    },
  };
}
