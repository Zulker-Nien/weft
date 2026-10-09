import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// The desktop shell (electron/main.cjs) passes these when it starts the Next server.
const SHELL_URL = process.env.THREADBOARD_SHELL_URL;
const SHELL_TOKEN = process.env.THREADBOARD_SHELL_TOKEN;

export const BROWSER_PROMPT = `You are running inside Weft, a desktop app with a browser pane beside the user's board.
Use the mcp__browser__* tools to open pages there (for example a dev server you started), read them, take screenshots, and click or type. The user can see that pane.
Your replies are shown as Markdown. To show the user an image or video file (a screenshot you saved, a chart, a generated picture), put it in your reply as ![what it shows](/absolute/path/to/file.png) and it appears inline in the thread. Screenshots from your tools are shown to the user automatically.`;

type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
};

function text(value: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: value }], isError };
}

async function shell(route: string, body?: Record<string, unknown>) {
  if (!SHELL_URL) throw new Error("The browser pane only exists in the desktop app (npm run desktop).");
  const res = await fetch(`${SHELL_URL}${route}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SHELL_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.error ?? res.statusText));
  return data;
}

async function attempt(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (err) {
    return text(err instanceof Error ? err.message : String(err), true);
  }
}

// A fresh server per query: an MCP server instance serves one connection. Each card drives its own
// browser, named by its id.
// A spare thread has no card until one takes it over, so the id is read when a tool runs.
export function browserMcpServer(cardId: () => string | undefined) {
  return createSdkMcpServer({
    name: "browser",
    version: "0.1.0",
    // Keep the tools in the prompt instead of behind tool search, so agents see them up front.
    alwaysLoad: true,
    tools: [
      tool("open_url", "Open a URL in the browser pane beside the board and show the pane.", { url: z.string() }, ({ url }) =>
        attempt(async () => {
          const page = await shell("/browser/open", { url, key: cardId() });
          return text(`Opened ${page.url} — ${page.title}`);
        }),
      ),
      tool("read_page", "Return the URL, title, and visible text of the page in the browser pane.", {}, () =>
        attempt(async () => {
          const page = await shell("/browser/text", { key: cardId() });
          return text(`URL: ${page.url}\nTitle: ${page.title}\n\n${page.text}`);
        }),
      ),
      tool("screenshot", "Take a screenshot of the browser pane.", {}, () =>
        attempt(async () => {
          const shot = await shell("/browser/screenshot", { key: cardId() });
          return { content: [{ type: "image", data: String(shot.png), mimeType: "image/png" }] };
        }),
      ),
      tool("click", "Click the first element matching a CSS selector in the browser pane.", { selector: z.string() }, ({ selector }) =>
        attempt(async () => {
          const r = await shell("/browser/click", { selector, key: cardId() });
          return r.found ? text(`Clicked ${selector}`) : text(`No element matches ${selector}`, true);
        }),
      ),
      tool(
        "type_text",
        "Replace the contents of the input matching a CSS selector in the browser pane with text.",
        { selector: z.string(), text: z.string() },
        ({ selector, text: value }) =>
          attempt(async () => {
            const r = await shell("/browser/type", { selector, text: value, key: cardId() });
            return r.found ? text(`Typed into ${selector}`) : text(`No element matches ${selector}`, true);
          }),
      ),
    ],
  });
}
