import "server-only";
import { parseEnv, serverEnvSchema, type ServerEnv } from "./schema";

let cached: ServerEnv | undefined;

/**
 * Validated server environment. The `server-only` import makes any accidental
 * import from a Client Component a build error, so secrets cannot reach the bundle.
 */
export function serverEnv(): ServerEnv {
  cached ??= parseEnv(serverEnvSchema, process.env);
  return cached;
}
