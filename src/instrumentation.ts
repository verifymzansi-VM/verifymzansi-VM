export async function register() {
  const { validateEnv } = await import("./lib/config/env");
  validateEnv();
}
