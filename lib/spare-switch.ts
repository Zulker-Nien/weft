import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { signAsWeft } from "./attribution";
import type { Backend, Card, Effort, PermissionMode } from "./types";

interface SpareSpec {
  backend: Backend;
  copilot: boolean;
  permissionMode: PermissionMode;
  model?: string;
  effort?: Effort;
}

// A spare CLI taking over a card switches to the card's mode, model and effort, and signs commits as that model.
export function switchSpare(q: Query | undefined, spec: SpareSpec, card: Pick<Card, "permissionMode" | "model" | "effort">): void {
  if (card.permissionMode !== spec.permissionMode) {
    spec.permissionMode = card.permissionMode;
    void q?.setPermissionMode(card.permissionMode).catch(() => {});
  }
  if (card.model && card.model !== spec.model) {
    spec.model = card.model;
    void q?.setModel(card.model).catch(() => {});
    signAsWeft(q, spec, card.model);
  }
  if (card.effort && card.effort !== spec.effort) {
    spec.effort = card.effort;
    void q?.applyFlagSettings({ effortLevel: card.effort }).catch(() => {});
  }
}
