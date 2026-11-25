// TEI ODD files as schemas. A document whose `<?xml-model?>` names an
// ODD is checked against the RELAX NG schema the ODD compiles to, with
// the TEI stylesheets (odd2odd, odd2relax) running on Urðr's XSLT
// engine, as the TEI's own tools do with Saxon. The ODD's Schematron
// rules come embedded in that schema, and the validator checks them
// too. Compiling takes a while, so each result is kept by the ODD's
// text.
import type { Reader } from "./converse.ts";
import { sha256, type Store } from "./platform.ts";
import { describe } from "./preview-html.ts";
import type { Transformer } from "./transforms.ts";

const RNG_NS = "http://relaxng.org/ns/structure/1.0";
const TEI_NS = "http://www.tei-c.org/ns/1.0";

/** The scheme of the schema an ODD compiles to, followed by the ODD's URI. */
export const ODD_RNG = "urdr-odd:rng:";

function pseudo(data: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of data.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]!] = m[2] ?? m[3] ?? "";
  return out;
}

/** Whether an `xml-model` names an ODD: by the `.odd` ending, or by
 * the TEI namespace as its schema type. */
function namesOdd(a: Record<string, string>): boolean {
  const href = (a["href"] ?? "").replace(/[?#].*$/, "").toLowerCase();
  if (!href) return false;
  const typens = a["schematypens"];
  if (typens === TEI_NS || a["type"] === "application/tei+xml") return true;
  return href.endsWith(".odd") && (!typens || typens === RNG_NS);
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The document with each `xml-model` that names an ODD replaced by one
 * that names its RELAX NG schema, taking as many lines so that positions
 * after it stay put; and the ODDs' URIs. */
export function rewriteOddModels(text: string, resolve: (ref: string) => string): { text: string; odds: string[] } {
  const rootAt = text.search(/<[A-Za-z_]/);
  const end = rootAt < 0 ? text.length : rootAt;
  const odds: string[] = [];
  const prolog = text.slice(0, end).replace(/<\?xml-model\s([\s\S]*?)\?>/g, (pi, data: string) => {
    const a = pseudo(data);
    if (!namesOdd(a)) return pi;
    const odd = resolve(a["href"]!);
    odds.push(odd);
    // Keep the line count: a PI may run over several lines.
    const lines = "\n".repeat((pi.match(/\n/g) ?? []).length);
    return `<?xml-model href="${escapeAttr(ODD_RNG + odd)}" schematypens="${RNG_NS}"?>${lines}`;
  });
  return { text: odds.length ? prolog + text.slice(end) : text, odds };
}

export interface CompiledOdd {
  /** The RELAX NG schema, with the ODD's Schematron rules embedded. */
  rng: string;
}

export interface OddOptions {
  /** The TEI stylesheets folder, as a URI ending in `/`. */
  stylesheets: () => string;
  /** The TEI source (`p5subset.xml`) to compile against, as a URI. */
  source: () => string;
  /** Where compiled ODDs are kept between sessions. */
  store?: Store;
  /** Called when a compile starts; the function it returns, when it ends. */
  started?: (odd: string) => () => void;
}

/** Each step may take this long: tei_all takes a few minutes. */
const STEP_TIMEOUT = 15 * 60 * 1000;

export class OddCompiler {
  private readonly transformer: Transformer;
  private readonly options: OddOptions;
  private readonly kept = new Map<string, Promise<CompiledOdd>>();

  constructor(transformer: Transformer, options: OddOptions) {
    this.transformer = transformer;
    this.options = options;
  }

  /** The schemas the ODD at `odd` compiles to. Rejects with the reason
   * when it cannot be read or compiled. */
  async compile(odd: string, read: Reader): Promise<CompiledOdd> {
    const text = await read(odd).catch(() => undefined);
    if (text === undefined) throw new Error(`The ODD ${odd} cannot be read.`);
    const version = await read(new URL("VERSION", this.options.stylesheets()).href).catch(() => "");
    const key = await sha256(`${version}\n${this.options.source()}\n${odd}\n${text}`);
    let p = this.kept.get(key);
    if (!p) {
      p = this.fromDisk(key).then((kept) => kept ?? this.run(odd, text, read, key));
      p.catch(() => this.kept.delete(key));
      this.kept.set(key, p);
    }
    return p;
  }

  private async fromDisk(key: string): Promise<CompiledOdd | undefined> {
    const kept = await this.options.store?.get(`${key}.json`).catch(() => undefined);
    return kept ? (JSON.parse(kept) as CompiledOdd) : undefined;
  }

  private async run(odd: string, text: string, read: Reader, key: string): Promise<CompiledOdd> {
    const done = this.options.started?.(odd);
    try {
      const sheet = (name: string) => new URL(`odds/${name}.xsl`, this.options.stylesheets()).href;
      const step = async (name: string, source: string, r: Reader, parameters: Record<string, string> = {}) => {
        const answer = await this.transformer.transform({ stylesheet: sheet(name), source, parameters }, r, STEP_TIMEOUT);
        const result = answer.results[0];
        if (!result) {
          const p = answer.problems[0];
          throw new Error(`Compiling the ODD ${odd} failed in ${name}: ${p ? describe(p) : "no result"}`);
        }
        return result.text;
      };
      const withOdd: Reader = async (u) => (u === odd ? text : read(u));
      const compiled = await step("odd2odd", odd, withOdd, { defaultSource: this.options.source() });
      // The compiled ODD is read as if it sat next to the ODD.
      const at = odd.replace(/(\.odd)?$/i, ".compiled.odd");
      const withCompiled: Reader = async (u) => (u === at ? compiled : read(u));
      const out = { rng: await step("odd2relax", at, withCompiled) };
      await this.options.store?.set(`${key}.json`, JSON.stringify(out)).catch(() => undefined);
      return out;
    } finally {
      done?.();
    }
  }
}

/** A reader that answers the URIs `rewriteOddModels` makes with the
 * compiled schemas, and every other URI with `read`. Failures are noted
 * in `failures` by ODD URI. */
export function oddReader(read: Reader, compiler: OddCompiler, failures?: Map<string, string>): Reader {
  return async (uri) => {
    if (!uri.startsWith(ODD_RNG)) return read(uri);
    const odd = uri.slice(ODD_RNG.length);
    try {
      return (await compiler.compile(odd, read)).rng;
    } catch (e) {
      failures?.set(odd, e instanceof Error ? e.message : String(e));
      return undefined;
    }
  };
}
