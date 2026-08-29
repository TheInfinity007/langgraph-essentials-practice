# LangGraph JavaScript/TypeScript Essentials

This directory contains TypeScript implementations of the LangGraph examples from the Python notebooks (L1.ipynb and L2.ipynb). All examples demonstrate the same concepts as the Python versions but leverage TypeScript for type safety and modern JavaScript tooling.

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- npm
- For the L2 email workflow, one LLM provider — either a Google Cloud login (no API key
  needed, see [docs/gemini-adc-setup.md](docs/gemini-adc-setup.md)) or an OpenAI API key.
  The L1 examples make no LLM calls and need neither.

### Installation

Download the course repository

```bash
# Clone the repo, cd to 'python' directory
git clone https://github.com/langchain-ai/lca-langgraph-essentials.git
cd ./lca-langgraph-essentials/js
```

Make a copy of example.env

```bash
# Create .env file
cp example.env .env
```

Insert any API keys you need directly into the .env file. All of these are optional:

```bash
# Only needed for LLM_PROVIDER=openai. The default gemini provider uses a Google Cloud
# login instead and needs no key — see docs/gemini-adc-setup.md.
OPENAI_API_KEY=your_openai_api_key_here

# Optional API key for LangSmith tracing
LANGSMITH_API_KEY=your_langsmith_api_key_here
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=langgraph-py-essentials
```

> Note: `npx tsx` does **not** read `.env`. To pick up values from it, run
> `node --env-file=.env --import tsx <file>` instead.

build project

```bash
# Install dependencies
npm install
```


### Getting Started with LangSmith

- Create a [LangSmith](https://smith.langchain.com/) account
- Create a LangSmith API key
<img width="1196" height="693" alt="Screenshot 2025-10-16 at 8 28 03 AM" src="https://github.com/user-attachments/assets/e39b8364-c3e3-4c75-a287-d9d4685caad5" />
<img width="1196" height="468" alt="Screenshot 2025-10-16 at 8 29 57 AM" src="https://github.com/user-attachments/assets/2e916b2d-e3b0-4c59-a178-c5818604b8fe" />



## 📚 Tutorial Overview

This directory contains TypeScript implementations for Labs 1-5, and an additional email workflow example. These labs cover the foundations of LangGraph that will enable you to build any workflow or agent.

### `L1/` - LangGraph Essentials
TypeScript examples demonstrating all the core components of LangGraph:
- State and Nodes (`01-simple-node.ts`)
- Edges
    - Parallel execution (`02-parallel-execution.ts`)
    - Conditional routing (`03-conditional-edges.ts`, `03-conditional-edge-router.ts`)
- Memory (`04-memory.ts`)
- Interrupts/Human-In-The-Loop (`05-interrupts.ts`)

### `L2/` - Email Workflow
A structured workflow to process customer emails (`email-workflow-complete.ts`). This example utilizes all of the building blocks from L1:
- Task tracking with status management (pending/in_progress/completed)
- Intent classification and routing
- Documentation search and bug tracking
- Human review with interrupts  



## 🎯 Running Examples

### Individual L1 Examples

```bash
npx tsx src/L1/01-simple-node.ts
npx tsx src/L1/02-parallel-execution.ts
npx tsx src/L1/03-conditional-edges.ts
npx tsx src/L1/03-conditional-edge-router.ts
npx tsx src/L1/04-memory.ts
npx tsx src/L1/05-interrupts.ts
```
### 📧 L2 Email Workflow

```bash
npx tsx src/L2/email-workflow.ts
```

#### End-to-end sample run

Long output trimmed with `…`, otherwise verbatim:

```text
[llm] provider=gemini model=gemini-2.5-pro location=us-central1
Processing email from: infinity@gmail.com
Classifying email intent and urgency...
Classification {
  intent: 'bug',
  urgency: 'critical',
  topic: 'Car',
  summary: 'The user is reporting that their car has blown up.'
}
Creating bug tracking ticket...
Ticket Created: BUG_1788027088587
Searching documentation...
Found search results: 3 items
Writing response...
Human Review ...
Result: {"emailContent":"My Car has blown up","senderEmail":"infinity@gmail.com", … }

================================================================================
Please review and approve/edit this response
================================================================================

Draft response:
Subject: Re: My Car has blown up

Thank you for alerting us to this. We are very sorry to hear you're experiencing a
critical failure with the Car feature. …

Reply with a JSON object:
  approved        boolean, required - true to send the reply, false to discard it
  editedResponse  string, optional - replaces the draft when approved

Examples:
  {"approved": true}
  {"approved": true, "editedResponse": "We will be there soon"}
  {"approved": false}

decision (JSON): yes
  Invalid - input: Invalid input: expected object, received string
  Expected something like {"approved": true}

decision (JSON): {"approved": true, "editedResponse": "A technician is on the way."}
Human Review ...
Sending reply A technician is on the way....
--------------------------------------------------------------------------------
Final Result {
  emailContent: 'My Car has blown up',
  classification: { intent: 'bug', urgency: 'critical', topic: 'Car', … },
  ticketId: 'BUG_1788027088587',
  searchResults: [ … ],
  draftResponse: 'A technician is on the way.'
}
```

Three things that transcript shows:

- **You don't need to know the response format.** The prompt lists the fields and gives
  examples, because the expected shape travels inside the interrupt payload — so
  LangGraph Studio shows it too, not just the CLI.
- **A malformed answer is re-prompted, not accepted.** `yes` is rejected with the reason
  and an example. Nothing reaches the graph until the input validates, so a typo can never
  be misread as "reject and discard".
- **`Human Review ...` prints twice.** The node body re-runs from the top when the graph
  resumes; `interrupt()` returns your decision the second time instead of pausing. This is
  why code before an `interrupt()` must be safe to execute more than once.

#### Whether you get a review step

`write_response` routes to `human_review` when urgency is `high`/`critical` **or** intent is
`complex`, and straight to `send_reply` otherwise. The file defines two sample emails:

| Sample | Email | Path |
|---|---|---|
| `state1` (default) | "My Car has blown up" | classified critical → human review |
| `state2` | "I've bought a new car. What things should I do or modify?" | low urgency → straight to send |

Change `inputState` near the bottom of the file to try the other path.

#### Choosing a provider

`LLM_PROVIDER` selects the model backing the workflow, and defaults to `gemini`:

```bash
# gemini (default) — no API key, authenticates via Google ADC
npx tsx src/L2/email-workflow.ts

# openai — needs OPENAI_API_KEY; npx tsx does not read .env, hence --env-file
LLM_PROVIDER=openai node --env-file=.env --import tsx src/L2/email-workflow.ts
```

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | `gemini` or `openai`. Unknown values fail loudly. |
| `LLM_MODEL` | `gemini-2.5-pro` / `gpt-5` | Override the model id. |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` | Vertex region — model availability varies by region. |

Selection is explicit: if the chosen provider's credentials are missing, the run fails with
a specific message instead of silently switching to the other provider. For the one-time
`gcloud auth application-default login` that makes the keyless `gemini` path work, see
[docs/gemini-adc-setup.md](docs/gemini-adc-setup.md).

```bash
# email processing in Langsmith Studio
npm run dev
```

## 📄 Docs

Authenticating to an LLM provider **without an API key**, using an org SSO login:

- [docs/gemini-adc-setup.md](docs/gemini-adc-setup.md) — Gemini on Vertex AI via Google
  Application Default Credentials (what the L2 email workflow uses by default)
- [docs/gemini-adc-architecture.md](docs/gemini-adc-architecture.md) — how that works internally

## 🔗 Related Resources

- [LangGraph Documentation](https://docs.langchain.com/oss/python/langgraph/overview)
