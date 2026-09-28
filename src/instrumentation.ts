/**
 * Runs once when the Next.js server starts. Validating here makes a misconfigured
 * deployment fail immediately with a readable message instead of on the first request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { parseEnv, serverEnvSchema } = await import("./lib/env/schema");
    parseEnv(serverEnvSchema, process.env);
  }
}
