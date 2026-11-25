// Reads the files a check needs: open editors first, then the
// workspace, then (for http and https) the web, keeping each download.
import type { Reader } from "./converse.ts";
import { sha256, type Platform } from "./platform.ts";

export interface Settings {
  validation: boolean;
  fetchRemote: boolean;
  delay: number;
  /** Seconds a transformation may take. */
  transformTimeout: number;
  /** The TEI source ODDs compile against; empty for the one that ships. */
  oddSource: string;
}

const memory = new Map<string, Promise<string | undefined>>();

async function download(uri: string, platform: Platform): Promise<string | undefined> {
  const store = platform.store("schemas");
  const key = await sha256(uri);
  const kept = await store.get(key).catch(() => undefined);
  if (kept !== undefined) return kept;
  const response = await fetch(uri, { redirect: "follow" });
  if (!response.ok) return undefined;
  const text = await response.text();
  await store.set(key, text).catch(() => undefined);
  return text;
}

export function makeReader(settings: Settings, open: (uri: string) => string | undefined, platform: Platform): Reader {
  return async (uri) => {
    const inEditor = open(uri);
    if (inEditor !== undefined) return inEditor;
    if (/^https?:/.test(uri) && !platform.own(uri)) {
      if (!settings.fetchRemote) return undefined;
      let p = memory.get(uri);
      if (!p) {
        p = download(uri, platform).catch(() => undefined);
        memory.set(uri, p);
      }
      const text = await p;
      if (text === undefined) memory.delete(uri);
      return text;
    }
    return platform.readFile(uri).catch(() => undefined);
  };
}
