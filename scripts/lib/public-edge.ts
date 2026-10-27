export function isCloudflareChallenge(status: number, headers: Headers, body: string) {
  return (
    [403, 503].includes(status) &&
    Boolean(headers.get("cf-ray")) &&
    (headers.get("cf-mitigated") === "challenge" ||
      (body.includes("window._cf_chl_opt") && /<title>Just a moment/i.test(body)) ||
      body.includes('id="cf-error-details"'))
  );
}
