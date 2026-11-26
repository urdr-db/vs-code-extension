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
/** Why the last download of an address failed. */
const failures = new Map<string, string>();

/** Whether this runs in a browser (VS Code for the Web) rather than Node. */
const inBrowser = typeof process === "undefined" || !process.versions?.node;

async function fetchText(uri: string): Promise<{ text?: string; why?: string }> {
  let response: Response;
  try {
    response = await fetch(uri, { redirect: "follow" });
  } catch (e) {
    if (inBrowser) {
      return {
        why: uri.startsWith("http:")
          ? "the browser does not load http addresses into VS Code for the Web; use https, on a server that allows cross-origin reads (CORS)"
          : "the browser refused it: the server must allow cross-origin reads (CORS)",
      };
    }
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    return { why: `it could not be downloaded: ${cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e))}` };
  }
  if (!response.ok) return { why: `the server answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""}` };
  return { text: await response.text() };
}

async function download(uri: string, platform: Platform): Promise<string | undefined> {
  const store = platform.store("schemas");
  const key = await sha256(uri);
  const kept = await store.get(key).catch(() => undefined);
  if (kept !== undefined) return kept;
  // A browser page on https may not load http: try the same address on
  // https first.
  let got = inBrowser && uri.startsWith("http:") ? await fetchText("https:" + uri.slice(5)) : {};
  if (got.text === undefined) got = await fetchText(uri);
  if (got.text === undefined) {
    failures.set(uri, got.why ?? "it could not be downloaded");
    return undefined;
  }
  failures.delete(uri);
  await store.set(key, got.text).catch(() => undefined);
  return got.text;
}

/** `message` with the reason each address it names could not be read,
 * where a download said why. */
export function explain(message: string): string {
  for (const [uri, why] of failures) if (message.includes(uri) && !message.includes(why)) message = `${message.replace(/\.?$/, "")}: ${why}.`;
  return message;
}

export function makeReader(settings: Settings, open: (uri: string) => string | undefined, platform: Platform): Reader {
  return async (uri) => {
    const inEditor = open(uri);
    if (inEditor !== undefined) return inEditor;
    if (/^https?:/.test(uri) && !platform.own(uri)) {
      if (!settings.fetchRemote) {
        failures.set(uri, "downloads are turned off (urdr.validation.fetchRemoteSchemas)");
        return undefined;
      }
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
