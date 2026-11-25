// Reads the files a check needs: open editors first, then the disk, then
// (for http and https) the web, keeping each download on disk.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Reader } from "./converse.ts";

export interface Settings {
  validation: boolean;
  fetchRemote: boolean;
  delay: number;
  /** Where downloads are kept; `undefined` keeps them in memory only. */
  cacheDir: string | undefined;
}

const memory = new Map<string, Promise<string | undefined>>();

async function download(uri: string, cacheDir: string | undefined): Promise<string | undefined> {
  const file = cacheDir ? join(cacheDir, createHash("sha256").update(uri).digest("hex")) : undefined;
  if (file) {
    const kept = await readFile(file, "utf8").catch(() => undefined);
    if (kept !== undefined) return kept;
  }
  const response = await fetch(uri, { redirect: "follow" });
  if (!response.ok) return undefined;
  const text = await response.text();
  if (file && cacheDir) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, text, "utf8");
  }
  return text;
}

export function makeReader(settings: Settings, open: (uri: string) => string | undefined): Reader {
  return async (uri) => {
    const inEditor = open(uri);
    if (inEditor !== undefined) return inEditor;
    if (uri.startsWith("file:")) return readFile(fileURLToPath(uri), "utf8").catch(() => undefined);
    if (/^https?:/.test(uri) && settings.fetchRemote) {
      let p = memory.get(uri);
      if (!p) {
        p = download(uri, settings.cacheDir).catch(() => undefined);
        memory.set(uri, p);
      }
      const text = await p;
      if (text === undefined) memory.delete(uri);
      return text;
    }
    return undefined;
  };
}
