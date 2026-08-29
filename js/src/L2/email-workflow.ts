// L2 Email Workflow - Complete email processing workflow

import z from 'zod';
import { Command, END, interrupt, MemorySaver, START, StateGraph } from '@langchain/langgraph'
import { getUserInput } from '../utils.js';
import { createLlm } from '../llm.js';

// Provider is chosen with LLM_PROVIDER (gemini | openai); defaults to gemini, which
// authenticates via Google ADC and needs no API key. See src/llm.ts.
const llm = createLlm();

export const EmailClassificationSchema = z.object({
  intent: z.enum(['question', 'bug', 'billing', 'feature', 'complex']),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  topic: z.string(),
  summary: z.string(),
});

export const EmailStateDefinition = z.object({
  emailContent: z.string(),
  senderEmail: z.string(),
  emailId: z.string(),
  classification: EmailClassificationSchema.optional(),
  ticketId: z.string().optional(),
  searchResults: z.array(z.string()).optional(),
  customerHistory: z.record(z.string(), z.any()).optional(),
  draftResponse: z.string().optional(),
});

export type EmailAgentState = z.infer<typeof EmailStateDefinition>;

// The contract for resuming a human_review interrupt. Shared by the node and any client
// (CLI, LangGraph Studio) so both agree on the shape. Being a Zod schema, it provides
// .safeParse() for validation - used in humanReview and in the CLI driver below.
export const HumanDecisionSchema = z.object({
  approved: z.boolean(),
  editedResponse: z.string().optional(),
});

export type HumanDecision = z.infer<typeof HumanDecisionSchema>;

// Sent as part of the interrupt payload so the client can tell the human what to type,
// instead of the human having to read the source to discover the format.
const REVIEW_REQUEST = {
  action: 'Please review and approve/edit this response',
  responseFormat: 'JSON object',
  fields: {
    approved: 'boolean, required - true to send the reply, false to discard it',
    editedResponse: 'string, optional - replaces the draft when approved',
  },
  examples: [
    '{"approved": true}',
    '{"approved": true, "editedResponse": "We will be there soon"}',
    '{"approved": false}',
  ],
};

const tryJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const memory = new MemorySaver();

const NODES = {
  READ_EMAIL: 'read_email',
  CLASSIFY_INTENT: 'classify_intent',
  BUG_TRACKING: 'bug_tracking',
  SEARCH_DOCUMENTATION: 'search_documentation',
  WRITE_RESPONSE: 'write_response',
  HUMAN_REVIEW: 'human_review',
  SEND_REPLY: 'send_reply'
}
// Purpose: Fetch the email from prod email server
const readEmail = (state: EmailAgentState) => {
  console.log(`Processing email from: ${state.senderEmail}`);
  return {};
}

const classifyIntent = async (state: EmailAgentState) => {
  console.log(`Classifying email intent and urgency...`);

  const structuredLlm = llm.withStructuredOutput(EmailClassificationSchema);

  const classificationPrompt = `
      Analyse the customer email and classify it:
      
      Email: ${state.emailContent}
      From: ${state.senderEmail}

      Provide classification, including intent, urgency, topic and summary.
  `;

  try {
    const classification = await structuredLlm.invoke(classificationPrompt);  // Error Prone as it is outbound call
    console.log('Classification', classification)
    return { classification }
  } catch (err) {
    console.log('Error in classifying the email:', err instanceof Error ? err.message : err);
    return {
      intent: "question",
      urgency: "medium",
      topic: "general inquiry",
      summary: "Unable to classify email automatically"
    }
  }
}

const bugTracking = (state: EmailAgentState) => {
  console.log('Creating bug tracking ticket...');

  const ticketId = `BUG_${Date.now()}`;

  console.log(`Ticket Created: ${ticketId}`);
  return { ticketId }
}

const searchDocumentation = (state: EmailAgentState) => {
  console.log(`Searching documentation...`);

  const classification = state.classification ?? {
    intent: "question",
    urgency: "medium",
    topic: "general",
    summary: "Unable to classify email automatically"
  }

  try {
    const searchResults = [
      `Documentation for ${classification.intent}: Basic information about ${classification.topic}`,
      `FAQ Entry: Common Questions Related to ${classification.topic}`,
      `Knowledge base article: How to handle ${classification.intent} requests`
    ];

    console.log("Found search results:", searchResults.length, 'items');

    return { searchResults }
  } catch (err) {
    console.log("Search error:", err);
    return {
      searchResults: [`Search temporarily unavailable: ${err}`]
    }
  }
}

const writeResponse = async (state: EmailAgentState) => {
  console.log('Writing response...');

  const classification = state.classification ?? {
    intent: "question",
    urgency: "medium",
    topic: "general",
    summary: "Unable to classify email automatically"
  }

  const contextSessions: string[] = [];

  if (state.searchResults) {
    const formattedDocs = state.searchResults.map((doc) => `- ${doc}`).join('\n');
    contextSessions.push(`Relevant Documentation: \n${formattedDocs}`);
  }

  if (state.customerHistory) {
    contextSessions.push(
      `Customer tier: ${state.customerHistory.tier} ?? 'standard'`
    )
  }

  const draftPrompt = `
    Draft a response to this customer email:

    Email: ${state.emailContent}
    Email intent: ${classification.intent}
    Urgency level: ${classification.urgency}

    ${contextSessions.join('\n\n')}

    Guidelines:
    - Be professional and helpful
    - Address their specific concern
    - Be brief
    - Use the provided context when relevant
  `

  try {
    const response = await llm.invoke(draftPrompt);

    const needsReview = classification.urgency === 'high' || classification.urgency === 'critical' || classification.intent === 'complex'
    const goto = needsReview ? NODES.HUMAN_REVIEW : NODES.SEND_REPLY;

    return new Command({
      // .text, not the message itself: draftResponse is a string, while `content` can be
      // an array of content blocks depending on the provider. .text flattens it.
      update: { draftResponse: response.text },
      goto
    })
  } catch (err) {
    console.log('Error writing response:', err instanceof Error ? err.message : err);
    return new Command({
      update: { draftResponse: "Error generating response. Please try again." },
      goto: NODES.HUMAN_REVIEW
    })
  }

}

const humanReview = (state: EmailAgentState) => {

  console.log("Human Review ...")

  const classification = state.classification ?? {
    intent: "question",
    urgency: "medium",
    topic: "general",
    summary: "Unable to classify email automatically"
  }

  // The payload carries the expected response shape, so any client can show the human
  // what to type rather than leaving them to guess.
  const raw = interrupt({
    ...REVIEW_REQUEST,
    draftResponse: state.draftResponse,
    intent: classification.intent,
    urgency: classification.urgency,
  });

  // Zod's safeParse validates without throwing. It returns a discriminated union:
  //   { success: true,  data: HumanDecision }
  //   { success: false, error: ZodError }
  // `success` is the discriminant, so checking it is what makes `.data` reachable below.
  const decision = HumanDecisionSchema.safeParse(
    typeof raw === 'string' ? tryJson(raw) : raw
  );

  if (!decision.success) {
    // Loud, not silent: an unreadable decision used to fall through to END as though the
    // reviewer had rejected the draft.
    console.log(
      `Could not read the review decision. Expected ${REVIEW_REQUEST.responseFormat} ` +
      `such as ${REVIEW_REQUEST.examples[1]}, received: ${JSON.stringify(raw)}`
    );
    return new Command({ update: {}, goto: END });
  }

  if (!decision.data.approved) {
    console.log('Reviewer rejected the draft - not sending.');
    return new Command({ update: {}, goto: END });
  }

  return new Command({
    update: { draftResponse: decision.data.editedResponse ?? state.draftResponse },
    goto: NODES.SEND_REPLY
  })
}

// Purpose: Send the email
const sendReply = (state: EmailAgentState) => {
  const preview = state.draftResponse?.substring(0, 60) + "...";
  console.log(`Sending reply ${preview}`)
  return {}
}


export const graph = new StateGraph(EmailStateDefinition)
  // Add Nodes
  .addNode(NODES.READ_EMAIL, readEmail)
  .addNode(NODES.CLASSIFY_INTENT, classifyIntent)
  .addNode(NODES.BUG_TRACKING, bugTracking)
  .addNode(NODES.SEARCH_DOCUMENTATION, searchDocumentation)
  .addNode(NODES.WRITE_RESPONSE, writeResponse, { ends: [NODES.HUMAN_REVIEW, NODES.SEND_REPLY] })
  .addNode(NODES.HUMAN_REVIEW, humanReview, { ends: [NODES.SEND_REPLY, END] })
  .addNode(NODES.SEND_REPLY, sendReply)

  // Add Edges
  .addEdge(START, NODES.READ_EMAIL)
  .addEdge(NODES.READ_EMAIL, NODES.CLASSIFY_INTENT)
  .addEdge(NODES.CLASSIFY_INTENT, NODES.BUG_TRACKING)
  .addEdge(NODES.CLASSIFY_INTENT, NODES.SEARCH_DOCUMENTATION)
  .addEdge(NODES.BUG_TRACKING, NODES.WRITE_RESPONSE)
  .addEdge(NODES.SEARCH_DOCUMENTATION, NODES.WRITE_RESPONSE)
  // .addConditionalEdges(NODES.WRITE_RESPONSE, NODES.HUMAN_REVIEW)
  // .addConditionalEdges(NODES.WRITE_RESPONSE, NODES.SEND_REPLY)
  // .addConditionalEdges(NODES.HUMAN_REVIEW, NODES.SEND_REPLY)
  // .addConditionalEdges(NODES.HUMAN_REVIEW, END)
  // Instead of conditional Edges, we will be using the send commands instead
  .addEdge(NODES.SEND_REPLY, END)

  .compile({ checkpointer: memory })



const state1 = {
  emailContent: "My Car has blown up",
  senderEmail: "infinity@gmail.com",
  emailId: 'emailid'
}

const state2 = {
  emailContent: "I've bought a new car. What things that i should do or modify ?",
  senderEmail: "infinity@gmail.com",
  emailId: 'emailid'
}


const inputState: EmailAgentState = state1;
const config = {
  configurable: { thread_id: 'T1' }
}
const result = await graph.invoke(inputState, config);
console.log(`Result: ${JSON.stringify(result)}`)


// __interrupt__ is injected at runtime, so it is not part of the inferred state type
type InterruptedResult = {
  __interrupt__: {
    value?: {
      action?: string;
      responseFormat?: string;
      fields?: Record<string, string>;
      examples?: string[];
      draftResponse?: string;
    };
  }[];
};

const hasInterrupt = (value: unknown): value is InterruptedResult =>
  Array.isArray((value as InterruptedResult)?.__interrupt__);

if (hasInterrupt(result)) {
  const request = result.__interrupt__.at(-1)?.value;

  // Show the human the draft and the exact shape of the expected answer.
  console.log(`\n${'='.repeat(80)}`);
  console.log(request?.action ?? 'Review required');
  console.log(`${'='.repeat(80)}`);
  console.log(`\nDraft response:\n${request?.draftResponse ?? '(none)'}\n`);
  console.log(`Reply with a ${request?.responseFormat ?? 'JSON object'}:`);
  for (const [field, description] of Object.entries(request?.fields ?? {})) {
    console.log(`  ${field.padEnd(15)} ${description}`);
  }
  console.log('\nExamples:');
  for (const example of request?.examples ?? []) {
    console.log(`  ${example}`);
  }
  console.log('');

  // Validate before resuming: a malformed answer is re-prompted rather than sent to the
  // graph, where it would be treated as a rejection and discard the reply.
  let decision: HumanDecision | undefined;
  while (decision === undefined) {
    const answer = await getUserInput('decision (JSON): ');

    // safeParse -> { success: true, data } | { success: false, error } (see humanReview).
    // safeParse rather than parse: no try/catch, and the failure branch gives structured
    // field-level errors instead of a thrown exception to unwrap.
    const parsed = HumanDecisionSchema.safeParse(tryJson(answer));

    if (parsed.success) {
      decision = parsed.data;
      break;
    }

    // ZodError.issues holds one entry per validation failure. issue.path locates the
    // offending field, e.g. ['approved'] -> "approved". An empty path means the value
    // itself was wrong shape (typing `yes` gives a string where an object was expected),
    // so fall back to "input".
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('; ');
    console.log(`  Invalid - ${problems}`);
    console.log(`  Expected something like ${request?.examples?.[0] ?? '{"approved": true}'}\n`);
  }

  const result2 = await graph.invoke(new Command({ resume: decision }), config)
  console.log(`${'-'.repeat(80)}`);

  console.log('Final Result', result2)
} else {
  console.log('Final Result without interrupt', result)
}


