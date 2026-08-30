# Using Gemini from LangChain without an API key (Google ADC / SSO)

A reusable recipe for authenticating a LangChain or LangGraph project to Gemini using
Application Default Credentials from a Google Cloud SSO login, instead of a `GOOGLE_API_KEY`.

Written to be copied into future projects. For *why* it works, see
[gemini-adc-architecture.md](./gemini-adc-architecture.md).

---

## Before you start: you must use Vertex AI, not AI Studio

Google serves Gemini through two products, and only one supports keyless auth:

| | Google AI Studio | **Vertex AI** ← use this |
|---|---|---|
| Package | `@langchain/google-genai` | `@langchain/google-vertexai` |
| Class | `ChatGoogleGenerativeAI` | `ChatVertexAI` |
| Auth | `GOOGLE_API_KEY` secret | Google IAM identity |
| Keyless / SSO | not possible | yes |

If you follow a Gemini tutorial that says `GOOGLE_API_KEY`, it is the AI Studio path and
will not work here. Everything below is Vertex AI.

### What you need from your organization

1. A **GCP project** you can access with your SSO identity.
2. The **Vertex AI API enabled** on that project.
3. The IAM role **`roles/aiplatform.user`** (or equivalent) on that project.

If you have Gemini through a company Google Cloud account, ask which project id to use.
Without a project id nothing works — Vertex AI requests are project-scoped, and this is the
most common thing people are missing.

---

## Step 1 — Install the gcloud CLI

Install the Google Cloud CLI following Google's current instructions for your platform,
then confirm:

```bash
gcloud --version
```

---

## Step 2 — Log in (the part everyone gets wrong)

There are two logins and you want the second one:

```bash
gcloud auth login                       # authenticates the gcloud CLI only
gcloud auth application-default login   # authenticates YOUR CODE  <-- this one
```

Run **both** if you also want to use `gcloud` commands, but the second is the one that
matters. It writes `~/.config/gcloud/application_default_credentials.json`, which is the
file every Google SDK reads.

Your org SSO happens in the browser flow — neither command has an SSO-specific mode; they
redirect to whatever identity provider your Google Workspace domain uses.

> If you only run `gcloud auth login`, your terminal will work perfectly and your code will
> fail with `Could not load the default credentials`. The error gives no hint that you ran
> the wrong login.

---

## Step 3 — Set the project

Credentials and project id resolve through *separate* chains, so being logged in is not
enough. Pick either:

```bash
# option A: gcloud config (persistent, applies to everything)
gcloud config set project YOUR_PROJECT_ID

# option B: environment variable (explicit, easy to switch per project)
export GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
```

Also set the quota project on the ADC file, which avoids billing being attributed to an
unexpected project:

```bash
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Verify:

```bash
gcloud config get-value project
gcloud auth application-default print-access-token   # should print a token
```

---

## Step 4 — Enable the API

**Check whether it is already enabled before trying to enable it:**

```bash
gcloud services list --enabled --filter="config.name:aiplatform.googleapis.com"
```

If it lists `aiplatform.googleapis.com`, you are done — skip this step entirely.

```bash
gcloud services enable aiplatform.googleapis.com   # only if the check came back empty
```

> **If this fails with `PERMISSION_DENIED ... AUTH_PERMISSION_DENIED` (reason:
> `serviceusage.googleapis.com`), do not stop.** That error means you lack
> `serviceusage.serviceUsageAdmin` — you cannot *enable* APIs. It says nothing about
> whether the API is already enabled. Organizations commonly pre-enable APIs centrally and
> withhold the admin role from individual developers, in which case there is nothing for
> you to do. Run the `services list` check above, and if that is also denied, just try a
> real request — it either works or returns a specific `403` naming the actual problem.

A genuinely disabled API produces a distinct `403` saying the API "has not been used in
project ... before or it is disabled" — that is the error to escalate to an admin.

---

## Step 5 — Install the package

```bash
npm install @langchain/google-vertexai
```

---

## Step 6 — The code

```ts
import { ChatVertexAI } from '@langchain/google-vertexai';

const llm = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  location: 'us-central1',   // region; model availability varies by region
  // project is picked up from ADC / GOOGLE_CLOUD_PROJECT; pass `project` to be explicit
});
```

That's it — genuinely. There is no credential check to work around and no client factory to
supply. `ChatVertexAI` delegates to `google-auth-library`, which walks the ADC chain and
attaches a bearer token to every request, refreshing it as needed.

Three notes:

- **Set `model` explicitly.** The package's built-in default is stale (`gemini-pro`).
  Confirm your chosen id is offered in your region.
- **`location` matters.** Model availability is per-region; `us-central1` has the widest
  selection. A wrong region shows up as a `404 Publisher Model ... not found`.
- **`withStructuredOutput` works**, so Zod-schema structured output carries over unchanged
  from an OpenAI or Anthropic implementation.

---

## Step 7 — Run it

```bash
npx tsx path/to/your-file.ts
```

With no `GOOGLE_API_KEY` set anywhere.

---

## Usage patterns

Two shapes you are likely to want. **Neither changes the credential setup** — ADC resolves
identically for both, and no API key is involved either way.

### A. The chat model directly

Reach for this when you want the model object itself: LangGraph nodes,
`withStructuredOutput`, custom chains.

```ts
import { ChatVertexAI } from '@langchain/google-vertexai';

const llm = new ChatVertexAI({ model: 'gemini-2.5-pro', location: 'us-central1' });
const response = await llm.invoke('Draft a reply to this email...');
console.log(response.text);   // .text flattens content blocks to a string
```

### B. An agent, with a provider-prefixed model string

`langchain` v1's `createAgent` accepts a `"provider:model"` string instead of a constructed
model, which is the shortest path to a working agent.

```ts
import { createAgent, HumanMessage } from 'langchain';

const agent = createAgent({
  model: 'google-vertexai:gemini-2.5-flash',
  systemPrompt: 'You are a full-stack comedian',
});

const result = await agent.invoke({ messages: [new HumanMessage('Hello, how are you?')] });
console.log(result.messages.at(-1).content);

// the whole conversation, including tool calls
for (const message of result.messages) console.log(message.type, message.content);
```

Three things worth knowing about the string form:

- **The `google-vertexai:` prefix still requires `@langchain/google-vertexai` to be
  installed**, even though you never import it. `langchain` resolves the provider at
  runtime; a missing package shows up as a resolution error, not an auth error.
- **`createAgent` is synchronous.** It returns the agent, not a promise, so `await` is
  unnecessary (harmless, but it reads as though it were async).
- **Auth is unchanged.** The prefix selects a provider; ADC does the rest.

### Switching providers in one line

Because the model is just a string, provider choice collapses to a variable:

```ts
const provider = 'gemini';

const model = provider === 'gemini'
  ? 'google-vertexai:gemini-2.5-flash'
  : 'anthropic:claude-sonnet-4-5-20250929';
```

Note the asymmetry this exposes: the `anthropic:` string needs an `ANTHROPIC_API_KEY` in the
environment, while the `google-vertexai:` string needs no secret at all. Keyless is a
property of the provider, not of LangChain.

### Adding tools

Auth plays no part here, but it is the usual next step after a bare agent:

```ts
import { createAgent, tool } from 'langchain';
import { z } from 'zod';

const checkHaikuLines = tool(
  ({ text }) => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length === 3
      ? 'Correct, this haiku has 3 lines.'
      : `Incorrect! This haiku has ${lines.length} lines.`;
  },
  {
    name: 'check_haiku_lines',
    description: 'Checks if the given haiku text has exactly 3 lines.',
    schema: z.object({ text: z.string().describe('The haiku text to check') }),
  }
);

const agent = createAgent({
  model: 'google-vertexai:gemini-2.5-flash',
  systemPrompt: 'You are a sports poet who only writes haiku. You always check your work.',
  tools: [checkHaikuLines],
});

const result = await agent.invoke({ messages: 'Please write me a poem' });
console.log(result.messages.length);   // > 2: the tool call and its result are in here
```

### Supplying the project id from `.env`

A convenient third way to satisfy the project-id chain, alongside `gcloud config set project`
and an exported variable:

```ts
import 'dotenv/config';   // reads GOOGLE_CLOUD_PROJECT from .env
```

```bash
# .env
GOOGLE_CLOUD_PROJECT=your-project-id
```

This is worth knowing because `npx tsx` does **not** read `.env` by itself — importing
`dotenv/config` from your code sidesteps that, with no change to how you invoke the script.
Keep `.env` gitignored: the project id is not secret, but the file tends to accumulate keys
that are.

---

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| `Unable to detect a Project Id in the current environment` | Credentials may be fine — the **project** chain came up empty. These resolve separately. | `gcloud config set project X` or `export GOOGLE_CLOUD_PROJECT=X`. |
| `Could not load the default credentials` | No ADC file. Almost always means `gcloud auth login` was run instead of the application-default variant. | `gcloud auth application-default login` |
| `403 Permission denied` on the model endpoint | Authenticated, not authorized. Your identity lacks `roles/aiplatform.user`. | Ask a project admin to grant it. |
| `403 ... API has not been used in project ... or it is disabled` | Vertex AI API genuinely not enabled. | `gcloud services enable aiplatform.googleapis.com` |
| `gcloud services enable` fails with `PERMISSION_DENIED` / `AUTH_PERMISSION_DENIED` | You lack `serviceusage.serviceUsageAdmin`. This is **not** evidence the API is disabled. | Check with `gcloud services list --enabled --filter=...`; if already enabled, ignore the error and proceed. |
| `404 Publisher Model ... not found` | Wrong model id, or not served in that region. | Check the id; try `location: 'us-central1'`. |
| Billing/quota errors naming an unexpected project | ADC `quota_project_id` differs from your intended project. | `gcloud auth application-default set-quota-project X` |
| Works locally, fails in CI | No ADC file in a headless environment. | Service account JSON via `GOOGLE_APPLICATION_CREDENTIALS`, or Workload Identity Federation. |

---

## Checklist for a new project

1. `gcloud auth application-default print-access-token` — confirms ADC works (once per machine).
2. `gcloud config get-value project` — confirms a project is set.
3. `gcloud services enable aiplatform.googleapis.com` — once per project.
4. `npm install @langchain/google-vertexai`.
5. `new ChatVertexAI({ model, location })` — set both explicitly.
6. No `GOOGLE_API_KEY` anywhere; don't commit `.env`.

---

## CI / headless environments

ADC has no browser, so use a service account:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

That's source #1 in the ADC chain, so it takes precedence over any ADC file. The
application code stays identical — which is the main practical benefit of ADC over
API keys: the same code runs locally under your SSO identity and in CI under a service
account, with no branching.

For GitHub Actions, prefer Workload Identity Federation over a downloaded key file; it
avoids a long-lived secret entirely and is also handled transparently by
`google-auth-library`.

---

## Scope and limits

- Vertex AI only. `@langchain/google-genai` (AI Studio) has no ADC path.
- Verified against `@langchain/google-vertexai` **2.3.0**.
- Billing is per **GCP project**, not per user. Your SSO identity authorizes the call; the
  project pays for it.
