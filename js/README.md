# LangGraph JavaScript/TypeScript Essentials

This directory contains TypeScript implementations of the LangGraph examples from the Python notebooks (L1.ipynb and L2.ipynb). All examples demonstrate the same concepts as the Python versions but leverage TypeScript for type safety and modern JavaScript tooling.

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- npm
- OpenAI API key (for L2 email workflow)

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

Insert API keys directly into .env file, OpenAI (required) and [LangSmith](#getting-started-with-langsmith) (optional)

```bash
# Add OpenAI API key
OPENAI_API_KEY=your_openai_api_key_here

# Optional API key for LangSmith tracing
LANGSMITH_API_KEY=your_langsmith_api_key_here
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=langgraph-py-essentials
```

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

The graph pauses at the human review step and waits for a decision. Paste this
at the prompt to approve the draft and let it run through to `send_reply`:

```json
{"approved": true, "editedResponse": "We will be there soon"}
```

An `OPENAI_API_KEY` is **not** required to see the workflow run. Without one, the
LLM calls in `classify_intent` and `write_response` fail into their fallback
branches, so the graph still completes and you can follow the routing, the
interrupt, and the resume end to end.

```bash
# email processing in Langsmith Studio
npm run dev
```

## 📄 Docs

Authenticating to an LLM provider **without an API key**, using an org SSO login:

- [docs/gemini-adc-setup.md](docs/gemini-adc-setup.md) — Gemini on Vertex AI via Google
  Application Default Credentials (what the L2 email workflow currently uses)
- [docs/gemini-adc-architecture.md](docs/gemini-adc-architecture.md) — how that works internally
- [docs/claude-oauth-setup.md](docs/claude-oauth-setup.md) — Claude via an `ant auth login`
  OAuth profile (reusable recipe)
- [docs/claude-oauth-architecture.md](docs/claude-oauth-architecture.md) — how that works internally

## 🔗 Related Resources

- [LangGraph Documentation](https://docs.langchain.com/oss/python/langgraph/overview)
