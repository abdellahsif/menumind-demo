import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";
import type { Database } from "./database.types";

export type AdminClient = SupabaseClient<Database>;

let client: AdminClient | undefined;

/**
 * Service-role client. Bypasses RLS, so it is only importable from server code
 * (enforced by `server-only`). Every order write in the app goes through here.
 */
export function supabaseAdmin(): AdminClient {
  if (!client) {
    const env = serverEnv();
    client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
