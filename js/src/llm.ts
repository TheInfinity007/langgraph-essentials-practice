// Provider selection for the L2 workflows.
//
// Set LLM_PROVIDER to choose which model backs the workflow:
//
//   LLM_PROVIDER=gemini   Gemini on Vertex AI, authenticated with Google Application
//                         Default Credentials — no API key. See docs/gemini-adc-setup.md.
//   LLM_PROVIDER=openai   OpenAI, authenticated with OPENAI_API_KEY.
//
// Defaults to gemini. Selection is explicit: if the chosen provider's credentials are
// missing, this fails rather than silently switching to the other one.

import { ChatVertexAI } from '@langchain/google-vertexai';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

const PROVIDERS = ['gemini', 'openai'] as const;
type Provider = (typeof PROVIDERS)[number];

const DEFAULT_PROVIDER: Provider = 'gemini';

// Model ids are overridable because Vertex model availability varies by region.
const GEMINI_MODEL = process.env.LLM_MODEL ?? 'gemini-2.5-pro';
const GEMINI_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
const OPENAI_MODEL = process.env.LLM_MODEL ?? 'gpt-5';

const isProvider = (value: string): value is Provider =>
  (PROVIDERS as readonly string[]).includes(value);

export const resolveProvider = (): Provider => {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (!raw) return DEFAULT_PROVIDER;
  if (!isProvider(raw)) {
    throw new Error(
      `Unknown LLM_PROVIDER "${raw}". Valid values: ${PROVIDERS.join(' | ')}.`
    );
  }
  return raw;
};

export const createLlm = (): BaseChatModel => {
  const provider = resolveProvider();

  if (provider === 'openai') {
    // Checked eagerly: ChatOpenAI would otherwise fail deep inside the first node.
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'LLM_PROVIDER=openai but OPENAI_API_KEY is not set.\n' +
        '  Note that `npx tsx` does NOT read .env. Either export the key, or run:\n' +
        '    node --env-file=.env --import tsx <file>'
      );
    }
    console.log(`[llm] provider=openai model=${OPENAI_MODEL}`);
    return new ChatOpenAI({ model: OPENAI_MODEL });
  }

  // Gemini credentials resolve asynchronously inside google-auth-library, so there is
  // nothing meaningful to check here. A missing ADC setup surfaces on the first call as
  // "Unable to detect a Project Id" or "Could not load the default credentials" —
  // both covered in docs/gemini-adc-setup.md.
  console.log(`[llm] provider=gemini model=${GEMINI_MODEL} location=${GEMINI_LOCATION}`);
  return new ChatVertexAI({ model: GEMINI_MODEL, location: GEMINI_LOCATION });
};
