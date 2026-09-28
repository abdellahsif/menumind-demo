import { describe, expect, it } from "vitest";
import { parseEnv, publicEnvSchema, serverEnvSchema } from "@/lib/env/schema";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_xyz",
  GOOGLE_GENERATIVE_AI_API_KEY: "google-key",
};

describe("server environment", () => {
  it("accepts a complete configuration and defaults the provider to google", () => {
    const env = parseEnv(serverEnvSchema, valid);
    expect(env.LLM_PROVIDER).toBe("google");
    expect(env.LLM_MODEL).toBeUndefined();
  });

  it("rejects a missing service role key", () => {
    expect(() => parseEnv(serverEnvSchema, { ...valid, SUPABASE_SERVICE_ROLE_KEY: undefined })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("treats empty strings as missing", () => {
    expect(() => parseEnv(serverEnvSchema, { ...valid, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("rejects an invalid Supabase URL", () => {
    expect(() => parseEnv(serverEnvSchema, { ...valid, NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("requires the API key for the selected provider", () => {
    expect(() => parseEnv(serverEnvSchema, { ...valid, LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() =>
      parseEnv(serverEnvSchema, { ...valid, LLM_PROVIDER: "openai", OPENAI_API_KEY: "openai-key" }),
    ).not.toThrow();
  });

  it("rejects an unknown provider", () => {
    expect(() => parseEnv(serverEnvSchema, { ...valid, LLM_PROVIDER: "someone-else" })).toThrow(/LLM_PROVIDER/);
  });

  it("rejects a secret key placed in the public anon slot", () => {
    expect(() =>
      parseEnv(serverEnvSchema, { ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_leak" }),
    ).toThrow(/would leak to the browser/);
  });

  it("rejects a publishable key placed in the service role slot", () => {
    expect(() =>
      parseEnv(serverEnvSchema, { ...valid, SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_oops" }),
    ).toThrow(/publishable key/);
  });

  it("rejects the same key used for both anon and service role", () => {
    expect(() =>
      parseEnv(serverEnvSchema, { ...valid, SUPABASE_SERVICE_ROLE_KEY: valid.NEXT_PUBLIC_SUPABASE_ANON_KEY }),
    ).toThrow(/must not equal/);
  });

  it("never echoes secret values in the error message", () => {
    try {
      parseEnv(serverEnvSchema, { ...valid, LLM_PROVIDER: "anthropic" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(valid.SUPABASE_SERVICE_ROLE_KEY);
      expect(String(error)).not.toContain(valid.GOOGLE_GENERATIVE_AI_API_KEY);
    }
  });
});

describe("public environment", () => {
  it("only contains the two browser-safe variables", () => {
    const env = parseEnv(publicEnvSchema, valid);
    expect(Object.keys(env).sort()).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
  });
});
