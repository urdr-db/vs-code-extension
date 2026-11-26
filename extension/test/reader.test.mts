// Reading files by web address, and saying why one could not be read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { explain, makeReader, type Settings } from "../src/reader.ts";
import type { Platform } from "../src/platform.ts";

const platform = {
  readFile: async () => undefined,
  own: () => false,
  store: () => ({ get: async () => undefined, set: async () => {} }),
} as unknown as Platform;
const settings: Settings = { validation: true, fetchRemote: true, delay: 0, transformTimeout: 60, oddSource: "" };

test("downloads by http and says why a download failed", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/ok.xsl") res.end("<ok/>");
    else (res.statusCode = 404), res.end("no");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const read = makeReader(settings, () => undefined, platform);
    assert.equal(await read(`${base}/ok.xsl`), "<ok/>");
    assert.equal(await read(`${base}/missing.xsl`), undefined);
    assert.equal(
      explain(`The stylesheet ${base}/missing.xsl cannot be read.`),
      `The stylesheet ${base}/missing.xsl cannot be read: the server answered 404 Not Found.`,
    );
    const off = makeReader({ ...settings, fetchRemote: false }, () => undefined, platform);
    assert.equal(await off(`${base}/other.xsl`), undefined);
    assert.match(explain(`The stylesheet ${base}/other.xsl cannot be read.`), /downloads are turned off \(urdr\.validation\.fetchRemoteSchemas\)\.$/);
  } finally {
    server.close();
  }
  // Nothing listens there.
  const read = makeReader(settings, () => undefined, platform);
  assert.equal(await read(`${base}/gone.xsl`), undefined);
  assert.match(explain(`${base}/gone.xsl cannot be read`), /cannot be read: it could not be downloaded: ECONNREFUSED\.$/);
  assert.equal(explain("Something else."), "Something else.");
});
