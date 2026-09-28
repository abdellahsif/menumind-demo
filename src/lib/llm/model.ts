import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { DEFAULT_MODELS, type ServerEnv } from "@/lib/env/schema";
import { serverEnv } from "@/lib/env/server";

/**
 * Picks the chat model from LLM_PROVIDER (and optional LLM_MODEL). API keys are
 * read from the validated server environment and passed explicitly, so they never
 * leave the server.
 */
export function chatModel(env: ServerEnv = serverEnv()): LanguageModel {
  const modelId = env.LLM_MODEL ?? DEFAULT_MODELS[env.LLM_PROVIDER];
  switch (env.LLM_PROVIDER) {
    case "google":
      return createGoogle({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(modelId);
    case "openai": {
      const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL });
      // OpenAI-compatible gateways reliably support Chat Completions; the Responses API is OpenAI-only.
      return env.OPENAI_BASE_URL ? openai.chat(modelId) : openai(modelId);
    }
  }
}
