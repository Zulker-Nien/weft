import { query } from "@anthropic-ai/claude-agent-sdk";

// One plain Haiku completion through a CLI with nothing loaded: no settings, hooks, MCP, tools or session file.
// Haiku with a bare CLI measured ~8-15s, steadier than puku-ai-2.8 (docs/ROADMAP.md).
export async function complete(prompt: string) {
  let text = "";
  for await (const msg of query({
    prompt,
    options: { model: "haiku", tools: [], settingSources: [], strictMcpConfig: true, persistSession: false, maxTurns: 1 },
  })) {
    if (msg.type === "result" && msg.subtype === "success") text = msg.result;
  }
  return text;
}
