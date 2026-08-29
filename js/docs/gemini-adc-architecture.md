# Architecture: authenticating LangChain to Gemini without an API key

How the Application Default Credentials (ADC) setup works for Gemini on Vertex AI.
For step-by-step instructions, see [gemini-adc-setup.md](./gemini-adc-setup.md).

The headline point: **Gemini needs no workaround.** Some LangChain integrations gate their
constructor on an API key and have to be worked around; the Google integration was built
around ADC from the start.

---

## 1. First decision: AI Studio or Vertex AI

Google ships Gemini through two different products with two different auth models. Picking
the wrong one makes a keyless setup impossible.

| | Google AI Studio | **Vertex AI** |
|---|---|---|
| LangChain package | `@langchain/google-genai` | `@langchain/google-vertexai` |
| Class | `ChatGoogleGenerativeAI` | `ChatVertexAI` |
| Credential | `GOOGLE_API_KEY` — a long-lived secret | Google IAM identity via ADC |
| Keyless / SSO possible | No | **Yes** |
| Billing | personal / project API key | GCP project |

If you have org Gemini access through Google Cloud and no API key, **Vertex AI is the only
path**. That choice — not any code trick — is what makes this work.

---

## 2. The layers

```
  your node function
        │
        ▼
  ┌────────────────────────────────┐
  │  ChatVertexAI                  │  @langchain/google-vertexai
  │  (LangChain chat model)        │  no API-key check at all
  └────────────────────────────────┘
        │
        ▼
  ┌────────────────────────────────┐
  │  GAuthClient                   │  @langchain/google-gauth
  │  (thin adapter)                │  wraps GoogleAuth, signs every fetch
  └────────────────────────────────┘
        │
        ▼
  ┌────────────────────────────────┐
  │  GoogleAuth                    │  google-auth-library
  │  (ADC resolution + refresh)    │  walks the ADC chain, mints access tokens
  └────────────────────────────────┘
        │  HTTPS + Authorization: Bearer <token>
        ▼
   Vertex AI endpoint
```

The whole adapter is about 30 lines. From `node_modules/@langchain/google-gauth/dist/auth.js`:

```js
var GAuthClient = class extends GoogleAbstractedFetchClient {
  constructor(fields) {
    const options = ensureAuthOptionScopes(fields?.authOptions, "scopes", fields?.platformType);
    this.gauth = new GoogleAuth(options);
    this._fetch = async (...args) => {
      const url = args[0];
      const opts = args[1] ?? {};
      opts.responseType = "stream";
      return await this.gauth.fetch(url, opts);   // <-- token attached here, per request
    };
  }
  async getProjectId() { return this.gauth.getProjectId(); }
};
```

Two things to notice:

- **`this.gauth.fetch(...)` per request.** The token is attached at call time, not baked
  into a client at construction. Expiry and refresh are handled inside
  `google-auth-library` — your code never sees a token.
- **`getProjectId()`** is a separate resolution from credentials. Vertex AI requests are
  project-scoped, so ADC must supply *both* an identity and a project. Most first-run
  failures are the project half, not the identity half.

### Scopes

`ensureAuthOptionScopes` fills in a default scope unless you passed one
(`@langchain/google-common/dist/auth.js`):

```js
function aiPlatformScope(platform) {
  switch (platform) {
    case "gai": return ["https://www.googleapis.com/auth/generative-language"];
    default:    return ["https://www.googleapis.com/auth/cloud-platform"];
  }
}
```

Vertex AI uses the `gcp` branch, so requests are made with
`https://www.googleapis.com/auth/cloud-platform`. Your ADC credentials must have been
issued with that scope — which is what `gcloud auth application-default login` grants.

---

## 3. Why no `createClient` equivalent is needed

Compare the two constructors.

`ChatAnthropic` gates on a key and throws before doing anything
(`@langchain/anthropic`, line 672):

```js
if (!this.anthropicApiKey && !fields?.createClient) throw new Error("Anthropic API key not found");
```

`ChatVertexAI` has no such check. Verified locally with no credentials of any kind present:

```
new ChatVertexAI({ model: 'gemini-2.5-pro' })
  -> constructed OK; model = gemini-2.5-pro
  -> withStructuredOutput available: true
```

Then, on first invoke:

```
invoke failed: Unable to detect a Project Id in the current environment.
```

That error comes from `google-auth-library`, not from LangChain — proof the request got all
the way down to ADC resolution. Nothing needed bypassing; there was simply nothing for ADC
to find yet.

Consequence for your code: the only change is which class you construct.

```ts
const llm = new ChatVertexAI({ model: 'gemini-2.5-pro' });
```

No factory, no options juggling, no `apiKey` stripping.

---

## 4. What ADC actually resolves

`GoogleAuth` resolves **credentials** and **project id** through separate chains, each
first-match-wins.

### Credentials

| # | Source | Typical use |
|---|--------|-------------|
| 1 | `GOOGLE_APPLICATION_CREDENTIALS` — path to a service-account JSON | CI, servers |
| 2 | The gcloud ADC file, `~/.config/gcloud/application_default_credentials.json` | **local dev — this is our path** |
| 3 | Metadata server (GCE, GKE, Cloud Run, Cloud Functions) | running inside GCP |

### Project id

| # | Source |
|---|--------|
| 1 | `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT` env var |
| 2 | `quota_project_id` inside the ADC file |
| 3 | The active gcloud config (`gcloud config get-value project`) |
| 4 | Metadata server |

Because these are independent, you can be perfectly authenticated and still fail — which
is exactly the `Unable to detect a Project Id` error above. Identity was not the problem.

---

## 5. The trap: two different gcloud logins

These commands look interchangeable and are not:

| Command | Writes | Used by |
|---|---|---|
| `gcloud auth login` | gcloud's own credential store | the `gcloud` CLI only |
| `gcloud auth application-default login` | `~/.config/gcloud/application_default_credentials.json` | **SDKs and libraries** — your code |

Running only the first gives you a working `gcloud` command line and an application that
still cannot authenticate. This is the single most common failure in this setup, and the
symptom (`Could not load the default credentials`) gives no hint that the wrong login was
used.

Your org SSO happens during the browser flow of either command. Neither has SSO-specific
logic; they redirect to whatever identity provider your Google Workspace domain uses.

---

## 6. End-to-end flow

```
  gcloud auth application-default login       (once, interactive, org SSO)
        │
        └──> ~/.config/gcloud/application_default_credentials.json
                    │  user credentials + refresh token
                    ▼
  new ChatVertexAI({ model })                 no key, no gate
        │
        ▼  per request
  GoogleAuth.fetch(url, opts)
        │  resolve credentials (chain above)
        │  resolve project id (separate chain)
        │  mint / refresh access token, scope cloud-platform
        ▼
  Authorization: Bearer <token>
        │
        ▼
  https://<region>-aiplatform.googleapis.com/.../projects/<project>/...
```

---

## 7. Failure modes

| Symptom | Layer | Cause |
|---|---|---|
| `Unable to detect a Project Id in the current environment` | google-auth-library | Project-id chain came up empty. Set `GOOGLE_CLOUD_PROJECT` or `gcloud config set project`. Independent of whether credentials exist. |
| `Could not load the default credentials` | google-auth-library | Credentials chain empty — usually `gcloud auth login` was run instead of `gcloud auth application-default login`. |
| `403 Permission denied` on the model endpoint | Vertex AI | Authenticated, but the identity lacks `roles/aiplatform.user` on the project. Authorization, not authentication. |
| `403 ... API has not been used in project ... before or it is disabled` | Vertex AI | `aiplatform.googleapis.com` not enabled on the project. |
| `404 Publisher Model ... not found` | Vertex AI | Model id wrong, or not offered in that region. Model availability is per-region. |
| Works locally, fails in CI | ADC | No ADC file in CI. Use a service account via `GOOGLE_APPLICATION_CREDENTIALS`, or Workload Identity Federation. |
| Quota / billing errors naming an unexpected project | ADC | `quota_project_id` in the ADC file differs from the project you meant. Fix with `gcloud auth application-default set-quota-project`. |

---

## 8. Comparison with the Claude setup

| | Claude (Anthropic) | Gemini (Vertex AI) |
|---|---|---|
| Keyless credential store | `~/.config/anthropic/` profile via `ant auth login` | `~/.config/gcloud/application_default_credentials.json` via `gcloud auth application-default login` |
| LangChain cooperates? | No — constructor throws without a key | Yes — no key check |
| Workaround required | `createClient` factory, strip `apiKey` | none |
| Extra required config | none | **project id** and region |
| Token refresh | inside `@anthropic-ai/sdk` | inside `google-auth-library` |
| Wire format | `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20` | `Authorization: Bearer` |
| Billing unit | Anthropic org credits | GCP project |

The structural lesson generalizes: keyless auth is available whenever a provider models
access as *an identity in a directory* rather than *possession of a secret*. Vertex AI does
this natively because it inherits GCP IAM; Anthropic's OAuth profiles do it too, but the
LangChain wrapper predates that and assumes a key.

---

## 9. Version scope

Verified against `@langchain/google-vertexai` **2.3.0** (which pulls
`@langchain/google-gauth` 2.3.0 and `google-auth-library`). ADC behaviour is a
`google-auth-library` contract and is stable; the LangChain adapter is a thin shim over it.

Note that the package's own default model is stale (`modelName = "gemini-pro"` in
`@langchain/google-common`, and `gemini-1.5-pro` in the doc comment) — always set `model`
explicitly and confirm the id is offered in your region.
