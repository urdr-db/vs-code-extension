// What the language server needs from where it runs. Desktop VS Code
// runs it in Node (node.ts); VS Code for the Web runs it in a web worker
// (web.ts). Everything else is the same in both.

/** Texts kept between sessions, by name. */
export interface Store {
  get(key: string): Promise<string | undefined>;
  set(key: string, text: string): Promise<void>;
}

/** A message from the transformation worker: an answer, or the error
 * that stopped it. */
export interface WorkerReply {
  id: number;
  answer?: string;
  error?: string;
}

export interface WorkerHandle {
  post(message: { id: number; request: string }): void;
  terminate(): void;
}

/** Starts a transformation worker. */
export type Spawn = (on: { message(m: WorkerReply): void; error(e: Error): void; exit(): void }) => WorkerHandle;

export interface Platform {
  /** Called once, before the first check, with the client's options. */
  init(options: Record<string, unknown>): Promise<void>;
  /** Reads a file that is not open in an editor and not on the web. */
  readFile(uri: string): Promise<string | undefined>;
  /** Whether `uri` is one of the extension's own files, which are read
   * with `readFile` even when it is a web address. */
  own(uri: string): boolean;
  /** Downloaded schemas (`schemas`) and compiled ODDs (`odd`). */
  store(area: "schemas" | "odd"): Store;
  spawn: Spawn;
  /** The TEI stylesheets folder, as a URI ending in `/`. */
  teiStylesheets(): string;
}

/** A hex SHA-256 of `text`, for naming kept files. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
