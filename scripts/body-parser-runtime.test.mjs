import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const require = createRequire(import.meta.url);
// Start at our declared adapter dependency and follow its actual module
// resolution. A hoisted Express copy could differ from the wrapper's copy.
const adapterRequire = createRequire(require.resolve("@opennextjs/cloudflare"));
const wrapperRequire = createRequire(
  adapterRequire.resolve("@opennextjs/aws/overrides/wrappers/express-dev.js")
);
const parserPath = createRequire(wrapperRequire.resolve("express")).resolve("body-parser");

// Run in a child: an uncaught decoder error must fail this test, not terminate
// the parent test runner. All HTTP traffic binds exclusively to loopback.
// Regression scenarios: GHSA-27r3-jxmh-p828 and downstream stream preservation.
const probe = String.raw`
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const parser = require(process.argv[1]);
const scenario = process.argv[2];
const original = Buffer.from(JSON.stringify({ probe: 'local-only' }));
const hashBody = scenario === 'downstream';
const rejectCharset = scenario === 'charset';
const encoding = hashBody ? 'deflate' : 'gzip';
const first = Buffer.concat([
  hashBody ? zlib.deflateSync(original) : zlib.gzipSync(original),
  Buffer.from([0]),
]);
const suffix = Buffer.alloc(hashBody ? 4096 : 131072, 81);
const complete = Buffer.concat([first, suffix]);
const expectedHash = createHash('sha256').update(complete).digest('hex');
const middleware = parser.json(rejectCharset ? { verify() {} } : {});
let client;
const server = http.createServer((request, response) => {
  const hash = hashBody ? createHash('sha256') : null;
  if (hash) request.pipe(hash);
  middleware(request, response, (error) => {
    if (error) {
      response.writeHead(error.status || 500).end('refused');
      return;
    }
    if (hash) {
      hash.once('finish', () => response.end(JSON.stringify({ parsed: request.body, digest: hash.digest('hex') })));
      client.end(suffix);
    } else response.end(JSON.stringify(request.body));
  });
});
const deadline = setTimeout(() => { console.error('Loopback parser probe timed out'); process.exit(2); }, 4000);
server.listen(0, '127.0.0.1', () => {
  client = http.request({
    host: '127.0.0.1', port: server.address().port, method: 'POST', agent: false,
    headers: {
      'content-type': rejectCharset ? 'application/json; charset=utf-999' : 'application/json',
      'content-encoding': encoding,
      'content-length': complete.length,
    },
  }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('error', (error) => { throw error; });
    response.on('end', () => {
      // Give any late decoder error a chance to terminate this child.
      setTimeout(() => {
        assert.equal(response.statusCode, rejectCharset ? 415 : 200);
        if (!rejectCharset) assert.deepEqual(JSON.parse(body), hashBody
          ? { parsed: JSON.parse(original), digest: expectedHash }
          : JSON.parse(original));
        clearTimeout(deadline);
        server.close(() => process.stdout.write('parser-probe-ok'));
      }, 150);
    });
  });
  client.on('error', (error) => { throw error; });
  if (hashBody) client.write(first);
  else client.end(complete);
});
`;

for (const scenario of ["gzip", "charset", "downstream"]) {
  test(`body parser safely handles compressed trailing bytes: ${scenario}`, () => {
    const result = spawnSync(process.execPath, ["-e", probe, parserPath, scenario], {
      encoding: "utf8",
      timeout: 6000,
      windowsHide: true,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "parser-probe-ok");
  });
}
