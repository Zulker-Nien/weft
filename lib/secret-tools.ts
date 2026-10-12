import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { attempt, shell, text } from "./browser-tools";
import { asText } from "./format";

// The vault for threads (docs/architecture/secrets.md): names only, and values typed into a pane field by
// Electron main after the user's Touch ID. A value never comes back through these tools.
export const SECRETS_PROMPT = `When a task needs a secret value the user keeps in Weft's 🔐 vault (an API key, an OAuth client secret, a password): don't ask them to paste it, don't read .env files, and never try to see the value. Call mcp__secrets__list for the names, open the page with the field in the browser pane, and call mcp__secrets__fill_field; the user approves with Touch ID and the value goes straight into the field.`;

const ENVIRONMENTS = ["development", "preview", "production"] as const;

type Listed = { name: string; environment: string; missing: boolean };

function describeList(label: string, secrets: Listed[]) {
  if (!secrets.length) return `The ${label} vault has no secrets yet. Ask the user to add them with 🔐 on the left rail.`;
  const lines = secrets.map((s) => `- ${s.name} (${s.environment})${s.missing ? ": missing, no value yet" : ""}`);
  return `Secrets in the ${label} vault (names only):\n${lines.join("\n")}`;
}

// A fresh server per query, like the browser's. folder is the card's project, read when a tool runs.
export function secretsMcpServer(cardId: () => string | undefined, folder: () => string) {
  const project = z.string().optional().describe("Absolute path of the project whose vault to use; defaults to this thread's folder");
  return createSdkMcpServer({
    name: "secrets",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      tool("list", "List the names in a project's 🔐 vault, with their environment and whether each has a value. Never values.", { project }, ({ project: p }) =>
        attempt(async () => {
          const r = await shell("/secrets/list", { folder: p ?? folder() });
          return text(describeList(asText(r.label), (r.secrets as Listed[] | undefined) ?? []));
        }),
      ),
      tool(
        "fill_field",
        "Type a secret from the 🔐 vault into the field matching a CSS selector in the browser pane (https pages only). The user approves with Touch ID; you never see the value, and read_page shows it as ‹NAME›.",
        {
          name: z.string().describe("The secret's name, e.g. GITHUB_CLIENT_SECRET"),
          selector: z.string().describe("CSS selector of the input to fill"),
          environment: z.enum(ENVIRONMENTS).optional().describe("Which value to use; defaults to development"),
          project,
        },
        ({ name, selector, environment, project: p }) =>
          attempt(async () => {
            const r = await shell("/secrets/fill", { key: cardId(), folder: p ?? folder(), name, environment: environment ?? "development", selector });
            const vault = asText(r.label, "this");
            if (r.denied) return text(`The user didn't approve ${name}. Ask before trying again.`, true);
            if (r.missing) return text(`${name} (${environment ?? "development"}) has no value in the ${vault} vault. Ask the user to add it with 🔐 on the left rail.`, true);
            if (!r.found) return text(`No element matches ${selector}`, true);
            return text(`Typed ${name} from the ${vault} vault into ${selector}.`);
          }),
      ),
    ],
  });
}
