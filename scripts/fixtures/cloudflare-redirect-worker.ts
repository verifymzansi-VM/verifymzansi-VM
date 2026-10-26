import { fetchWithoutRedirects } from "../../src/lib/utils/fetch-without-redirects";
interface Env {
  TARGET: { fetch: typeof fetch };
}
const worker = {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (path === "/ok") return Response.json({ ok: true });
    if (path === "/redirect")
      return new Response(null, {
        status: 302,
        headers: { Location: "https://must-not-be-contacted.invalid" },
      });
    try {
      const target = path === "/probe-redirect" ? "/redirect" : "/ok";
      return await fetchWithoutRedirects(
        "https://fixture.invalid" + target,
        {
          headers: { Authorization: "Bearer synthetic-transport-fixture" },
        },
        env.TARGET.fetch.bind(env.TARGET)
      );
    } catch (error) {
      return Response.json(
        { refused: error instanceof Error && error.message === "Unexpected redirect refused" },
        { status: 409 }
      );
    }
  },
};
export default worker;
