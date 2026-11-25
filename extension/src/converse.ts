// The conversation with the Rust core: check, read what it says it
// needed, check again, until nothing new is needed.

/** Reads a file by absolute URI; `undefined` when it cannot be found. */
export type Reader = (uri: string) => Promise<string | undefined>;

/** At most this many rounds, so a chain of includes cannot loop. */
const ROUNDS = 25;

/** Runs `check` with the files it asks for. `check` gets every file read
 * so far and answers JSON with a `needed` list. */
export async function converse<T extends { needed?: string[] }>(
  check: (files: Record<string, string>) => T,
  read: Reader,
  /** Filled with every file read, for callers that want the texts. */
  files: Record<string, string> = {},
): Promise<T> {
  const tried = new Set<string>();
  let answer = check(files);
  for (let round = 0; round < ROUNDS; round++) {
    const fresh = (answer.needed ?? []).filter((u) => !tried.has(u));
    if (!fresh.length) break;
    await Promise.all(
      fresh.map(async (uri) => {
        tried.add(uri);
        const text = await read(uri).catch(() => undefined);
        if (text !== undefined) files[uri] = text;
      }),
    );
    answer = check(files);
  }
  return answer;
}
