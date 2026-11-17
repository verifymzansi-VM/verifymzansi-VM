// Local stand-in for the shared rate limiter Worker, for the foundation test
// copy only (M0.7, M0.8). The website calls the limiter before fail-closed
// actions such as checkout and treats an unreachable limiter as "degraded" and
// blocks them, so the copy runs this stub on loopback. It allows every
// well-formed request: limits themselves are covered by unit tests, not here.
// It answers only POST /check with the copy's synthetic key, on 127.0.0.1.
import { createServer } from "node:http";

const MAX_BODY_BYTES = 4096;

/**
 * @param {{ port: number, apiKey: string }} options
 * @returns {Promise<import("node:http").Server>}
 */
export function startLocalLimiter({ port, apiKey }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid limiter port");
  if (typeof apiKey !== "string" || apiKey.length < 16) throw new Error("Invalid limiter key");
  const server = createServer((request, response) => {
    const answer = (status, body) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(body));
    };
    if (request.url !== "/check") return answer(404, { error: "not found" });
    if (request.method !== "POST") return answer(405, { error: "method not allowed" });
    if (request.headers.authorization !== `Bearer ${apiKey}`)
      return answer(401, { error: "unauthorised" });
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return answer(400, { error: "invalid body" });
      }
      if (typeof body?.key !== "string" || typeof body?.action !== "string")
        return answer(400, { error: "invalid body" });
      return answer(200, { allowed: true });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
