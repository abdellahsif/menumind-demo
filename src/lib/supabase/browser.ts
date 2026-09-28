"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env/public";
import type { Database } from "./database.types";

let client: SupabaseClient<Database> | undefined;

/**
 * Anon-key client for the browser. RLS limits it to reading the menu and
 * confirmed orders (used by the live board's Realtime subscription).
 */
export function supabaseBrowser(): SupabaseClient<Database> {
  client ??= createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return client;
}
