import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { attempt, shell, text } from "./browser-tools";
import { asText } from "./format";

// A key a thread needs that isn't in the 🔐 vault yet (docs/architecture/secrets.md). By default the thread
// puts its name in as a blank (mcp__secrets__add_blank): the rail's 🔐 counts it and the user fills it in when
// they're ready. Blocked on it now, the thread asks (mcp__secrets__ask_add): Electron main adds the blank and
// opens the drawer on its Add form with the name filled in (the board's "add-secret" message, lib/use-vault.ts),
// so the user only pastes the value. The value never comes back to the thread.

export const ASK_PROMPT = `When the work needs a secret that isn't in the vault yet (code reads process.env.SOMETHING, an SDK or service wants a key, a dashboard step needs a client secret), put each name in the 🔐 vault as a blank right away with mcp__secrets__add_blank, with a hint for where to get its value. Do it as soon as you know the name, before you need the value, and keep going with what doesn't need it: the user sees the blanks counted on 🔐 and fills them in when they're ready. Never make up placeholder values or write keys into files. Only when you're blocked on a value right now, call mcp__secrets__ask_add with its name: it adds the blank too and opens the 🔐 Add form with the name filled in, so the user just pastes the value. Don't walk them through the drawer yourself.`;

const ENVIRONMENTS = ["development", "preview", "production"] as const;
type Environment = (typeof ENVIRONMENTS)[number];
const NAME = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Letters, digits and _, not starting with a digit");
const PROJECT = z.string().optional().describe("Absolute path of the project whose vault to use; defaults to this thread's folder");

// Opens the Add form for name; false when the board can't be reached (only the desktop app has one).
export async function askToAdd(folder: string, name: string, environment: Environment = "development"): Promise<boolean> {
  try {
    await shell("/secrets/ask-add", { folder, name, environment });
    return true;
  } catch {
    return false;
  }
}

// What a thread hears when names have no value: the Add form is open on the first of them, or, when it
// couldn't open, where the user adds them by hand.
export function missingText(names: string[], environment: string, vault: string, opened: boolean): string {
  const [first] = names;
  const lack = `${names.join(", ")} ${names.length > 1 ? "have" : "has"} no value in the ${vault} vault (${environment}).`;
  if (!opened) return `${lack} Ask the user to add ${names.length > 1 ? "them" : "it"} with 🔐 on the left rail.`;
  const rest = names.length > 1 ? ` After that, call mcp__secrets__ask_add for ${names.slice(1).join(", ")}.` : "";
  return `${lack} Weft opened the 🔐 Add form with ${first} filled in: ask the user to paste its value there and click Add to vault, then try again.${rest}`;
}

/** mcp__secrets__ask_add. folder is the card's project, read when the tool runs. */
export function askAddTool(folder: () => string) {
  return tool(
    "ask_add",
    "Add a secret's name to the 🔐 vault as a blank and open the Add form with it filled in, for a key you're blocked on right now. The user pastes the value there; you never see it. When you can carry on without the value, use add_blank instead.",
    {
      name: NAME.describe("The secret's name, e.g. SUPABASE_SECRET_KEY"),
      environment: z.enum(ENVIRONMENTS).optional().describe("Which environment it's for; defaults to development"),
      project: PROJECT,
    },
    ({ name, environment, project }) =>
      attempt(async () => {
        await shell("/secrets/ask-add", { folder: project ?? folder(), name, environment: environment ?? "development" });
        return text(`Opened the 🔐 Add form with ${name} (${environment ?? "development"}) filled in. Ask the user to paste its value there and click Add to vault; mcp__secrets__list shows it once it's in.`);
      }),
  );
}

/** mcp__secrets__add_blank: names into the vault with no value, nothing opens. folder is the card's project. */
export function addBlankTool(folder: () => string) {
  return tool(
    "add_blank",
    "Put secret names in the 🔐 vault as blanks (no value yet) for the user to fill in when they're ready: the default whenever the work needs a key that isn't in the vault. A name that already has a value keeps it. Nothing opens; you never see the values.",
    {
      names: z.array(NAME).min(1).max(20).describe("The secrets' names, e.g. [\"STRIPE_SECRET_KEY\", \"STRIPE_WEBHOOK_SECRET\"]"),
      hint: z.string().max(200).optional().describe("Where the user gets the values, shown under each blank, e.g. \"Stripe dashboard → Developers → API keys\""),
      environment: z.enum(ENVIRONMENTS).optional().describe("Which environment they're for; defaults to development"),
      project: PROJECT,
    },
    ({ names, hint, environment, project }) =>
      attempt(async () => {
        const env = environment ?? "development";
        const r = await shell("/secrets/add-blank", { folder: project ?? folder(), names, environment: env, hint });
        return text(blankText(names, env, asText(r.label, "this"), Array.isArray(r.filled) ? r.filled.map(String) : []));
      }),
  );
}

// What a thread hears after add_blank: which names are blanks now, and which already had a value.
export function blankText(names: string[], environment: string, vault: string, filled: string[]): string {
  const had = new Set(filled);
  const blank = names.filter((n) => !had.has(n));
  const parts: string[] = [];
  if (blank.length) parts.push(`${blank.join(", ")} ${blank.length > 1 ? "are blanks" : "is a blank"} in the ${vault} vault (${environment}) now; the user fills ${blank.length > 1 ? "them" : "it"} in from 🔐. Carry on with what doesn't need ${blank.length > 1 ? "them" : "it"}, and check mcp__secrets__list before you use ${blank.length > 1 ? "them" : "it"}.`);
  if (had.size) parts.push(`${[...had].join(", ")} already ${had.size > 1 ? "have values" : "has a value"} there.`);
  return parts.join(" ");
}
