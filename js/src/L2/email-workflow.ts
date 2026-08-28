// L2 Email Workflow - Complete email processing workflow

import { ChatOpenAI } from '@langchain/openai';
import z from 'zod';
import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph'

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

const graph = new StateGraph(EmailStateDefinition)
  // Add Nodes
  .addNode(NODES.READ_EMAIL, readEmail)
  .addNode(NODES.CLASSIFY_INTENT, classifyIntent)
  .addNode(NODES.BUG_TRACKING, bugTracking)
  .addNode(NODES.SEARCH_DOCUMENTATION, searchDocumentation)
  .addNode(NODES.WRITE_RESPONSE, writeResponse)
  .addNode(NODES.HUMAN_REVIEW, humanReview)
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
