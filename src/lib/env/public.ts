import { parseEnv, publicEnvSchema, type PublicEnv } from "./schema";

/**
 * Browser-safe environment. Next.js only inlines NEXT_PUBLIC_* variables that are
 * referenced literally, so each one is listed by name here.
 */
export const publicEnv: PublicEnv = parseEnv(publicEnvSchema, {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
