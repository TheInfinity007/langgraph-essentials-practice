// L2 Email Workflow - Complete email processing workflow

import { ChatOpenAI } from '@langchain/openai';
import z from 'zod';
import { Command, END, interrupt, MemorySaver, START, StateGraph } from '@langchain/langgraph'
import { getUserInput } from '../utils.js';

const llm = new ChatOpenAI({ model: 'gpt-5' });

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
    console.log('Error in classifying the email:', err.message);
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
      update: { draftResponse: response },
      goto
    })
  } catch (err) {
    console.log('Error writing response:', err.message);
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

  let humanDecision = interrupt({
    ...state,
    action: 'Please review and approve/edit this response'
  });
try {
  humanDecision = JSON.parse(humanDecision);
} catch (err) {
  // silent
}

  console.log(humanDecision, humanDecision, humanDecision.approved)
  if (humanDecision.approved) {
    const editedResponse = humanDecision.editedResponse ?? state.draftResponse;
    return new Command({
      update: { draftResponse: editedResponse },
      goto: NODES.SEND_REPLY
    })
  }

  return new Command({
    update: {},
    goto: END
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


const inputState: EmailAgentState = {
  emailContent: "My Car has blown up",
  senderEmail: "infinity@gmail.com",
  emailId: 'emailid'
};
const config = {
  configurable: { thread_id: 'T1' }
}
const result = await graph.invoke(inputState, config);
console.log(`Result: ${JSON.stringify(result)}`)


if (result.__interrupt__ && Array.isArray(result.__interrupt__)) {
  console.log("\nInterrupt:");
  const interruptMessage = result.__interrupt__.at(-1);
  const msg = interruptMessage.value?.action || ""
  const human = await getUserInput(msg);

  const result2 = await graph.invoke(new Command({ resume: human }), config)
  console.log(`${'-'.repeat(80)}`);

  console.log('Final Result', result2)
}


