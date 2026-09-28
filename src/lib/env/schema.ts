import { z } from "zod";

/**
 * Environment contract. Pure module (no `process.env` access) so it can be unit tested.
 * `server.ts` and `public.ts` apply these schemas to the real environment.
 */

export const LLM_PROVIDERS = ["google", "anthropic", "openai"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** Default model per provider. Overridable with LLM_MODEL. */
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  google: "gemini-2.5-flash",
  anthropic: "claude-sonnet-5",
  openai: "gpt-5-mini",
};

const nonEmpty = (name: string) => z.string({ error: `${name} is required` }).trim().min(1, `${name} is required`);

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL" }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const serverEnvSchema = publicEnvSchema
  .extend({
    SUPABASE_SERVICE_ROLE_KEY: nonEmpty("SUPABASE_SERVICE_ROLE_KEY"),
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("google"),
    LLM_MODEL: z.string().trim().min(1).optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().trim().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
    OPENAI_API_KEY: z.string().trim().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.SUPABASE_SERVICE_ROLE_KEY === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_SERVICE_ROLE_KEY"],
        message: "SUPABASE_SERVICE_ROLE_KEY must not equal the public anon key",
      });
    }
    if (env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_")) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_SERVICE_ROLE_KEY"],
        message: "SUPABASE_SERVICE_ROLE_KEY looks like a publishable key; use the secret (service role) key",
      });
    }
    if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("sb_secret_")) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
        message: "NEXT_PUBLIC_SUPABASE_ANON_KEY is a secret key and would leak to the browser; use the publishable (anon) key",
      });
    }

    const requiredKey = {
      google: "GOOGLE_GENERATIVE_AI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
    } as const satisfies Record<LlmProvider, keyof typeof env>;
    const keyName = requiredKey[env.LLM_PROVIDER];
    if (!env[keyName]) {
      ctx.addIssue({
        code: "custom",
        path: [keyName],
        message: `${keyName} is required when LLM_PROVIDER=${env.LLM_PROVIDER}`,
      });
    }
  });
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Formats Zod issues into one readable startup error. Never echoes values. */
export function formatEnvError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  return `Invalid environment configuration:\n${lines.join("\n")}\nSee .env.example for the full list.`;
}

export function parseEnv<T extends z.ZodType>(schema: T, source: Record<string, string | undefined>): z.infer<T> {
  // Treat empty strings as unset so a blank line in .env.local does not satisfy `optional()`.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== ""));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}
