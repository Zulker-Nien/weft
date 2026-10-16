// Thread-item types (what the chat panel shows, and the agent's questions).

import type { SecretAsk } from "./vault-view";

// A question the agent asked with its AskUserQuestion tool.
export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  // preview: a mockup or code snippet for the option, shown in the browser pane while it's highlighted.
  options: { label: string; description?: string; preview?: string }[];
}

// What goes back with a question's answers: notes on a pick (and the preview it showed), keyed by question,
// or, instead of answers, a message to talk it over ("Chat about this").
export interface QuestionReply {
  annotations?: Record<string, { notes?: string; preview?: string }>;
  chat?: string;
}

export type ThreadItem =
  // id is the uuid Weft sent the prompt to the CLI with, so ↑ can rewind its turn (lib/edit-last.ts).
  // page is what the card's browser pane showed as it was sent (lib/pane-page.ts), for the glance rail.
  | { kind: "user"; text: string; at: number; id?: string; page?: string }
  | { kind: "assistant"; text: string; at: number }
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      // What the call did, from format.ts toolAction (missing on threads saved before it existed).
      action?: string;
      at: number;
      result?: string;
      // Set when a long result was left out of the item (lib/cloud-sync-types.ts TOOL_RESULT_INLINE_MAX):
      // its length, so the row can say how much it holds before it's fetched.
      resultBytes?: number;
      // URLs of images the tool returned, like a screenshot.
      images?: string[];
      isError?: boolean;
      // An mcp__secrets__ask_add call: the thread shows an input for this key in its place (lib/vault-view.ts).
      ask?: SecretAsk;
    }
  | {
      kind: "permission";
      id: string;
      toolName: string;
      title: string;
      decision?: "allow" | "deny";
      // The user's answers, when the agent asked questions.
      answer?: string;
      at: number;
    }
  | { kind: "result"; text: string; costUsd?: number; isError: boolean; at: number }
  // A message you edited with ↑, and the turn it started, folded away when the edit went out.
  | { kind: "edited"; items: ThreadItem[]; at: number }
  // A "!" command you ran from the reply box (lib/shell.ts). ms is set once it ends; sent once its
  // output went to Claude with your next message.
  | {
      kind: "shell";
      command: string;
      at: number;
      output?: string;
      exitCode?: number | null;
      ms?: number;
      timedOut?: boolean;
      sent?: boolean;
    };
