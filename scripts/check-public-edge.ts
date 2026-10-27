import { isCloudflareChallenge } from "./lib/public-edge";

async function main() {
  const url = new URL(process.env.APP_URL || "https://verifymzansi.com");
  if (url.origin !== "https://verifymzansi.com" || url.username || url.password)
    throw new Error("Invalid public edge target");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  if (isCloudflareChallenge(response.status, response.headers, body)) {
    console.log(
      "::notice::Cloudflare challenged the automated public-edge request. Public browser verification remains separate; authenticated app smoke/readiness must still pass."
    );
    return;
  }
  if (
    response.status !== 200 ||
    !body.includes("gntzjtuncsyefujajmjy") ||
    body.includes("tnygdgormnofpgjknlhr")
  )
    throw new Error(`Public homepage failed deployment alignment (HTTP ${response.status})`);
  console.log("Public homepage serves the deployed foundation configuration.");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Public edge probe failed");
  process.exitCode = 1;
});
