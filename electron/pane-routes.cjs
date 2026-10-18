// The browser pane's control-server routes (electron/control-server.cjs): what threads and Weft's server ask
// Electron main for. main.cjs passes getters, since the vault, Vercel and Supabase are set up after the pane.
const { createBoardView, boardViewRoutes } = require("./board-view.cjs");
const { createFolderAccess } = require("./folder-access.cjs");
const { accountRoutesFor } = require("./account-store.cjs");
const { vaultRoutes } = require("./vault-routes.cjs");
const { envRoutes } = require("./vercel-env.cjs");
const { restartFor } = require("./restart-when-idle.cjs");

// The copilot's chips (lib/copilot-sources.ts): a linked service's state per folder, read-only.
function statusRoute(api) {
  return ({ folders }) => api()?.status((folders ?? []).map(String)) ?? { folders: [] };
}

function paneRoutes({ dataDir, app, dialog, shell, window, board, sendMenu, updater, vault, vercelEnv, vercelApi, supabaseApi }) {
  return {
    // The Weft account's session, sealed by safeStorage; the server reads it here instead of a plain file.
    ...accountRoutesFor(dataDir),
    // mcp__secrets__add_blank and set_value: blanks into the card's vault, and a value a thread generated into one.
    ...vaultRoutes(vault),
    // mcp__secrets__ask_add, and a fill or run that found a key missing: the name goes in as a blank
    // (lib/secret-ask.ts). The ask's input shows in the thread itself (components/SecretAskInput.tsx).
    "POST /secrets/ask-add": async ({ folder, name, environment }) => {
      const env = String(environment || "development");
      await vault()?.addBlanks(String(folder), [String(name)], [env], { source: "a thread" }).catch(() => null);
      return { added: true };
    },
    // mcp__board__request_folder_access: a thread that got "Operation not permitted" on Downloads asks;
    // macOS prompts, or a dialog opens Settings.
    "POST /folder-access/ask": ({ folder }) => createFolderAccess({ app, dialog, shell, window }).ask(folder),
    // The server's restart when idle, once nothing runs.
    "POST /app/restart": ({ then }) => restartFor({ then, updater: updater(), app }),
    // mcp__webhooks__ask_add: the board opens 🪝 on a recorded webhook.
    "POST /webhooks/ask-add": ({ folder, id }) => {
      sendMenu("add-webhook", JSON.stringify({ folder, id }));
      return { ok: true };
    },
    // mcp__secrets__push_to_vercel: a vault value onto the card's linked Vercel project, after Touch ID.
    ...envRoutes(vercelEnv),
    // The latest deploy and the unapplied migrations, per folder.
    "POST /vercel/status": statusRoute(vercelApi),
    "POST /supabase/status": statusRoute(supabaseApi),
    // mcp__board_view__*: threads see and drive the board itself, secrets redacted (electron/board-view.cjs).
    ...boardViewRoutes(createBoardView({ board })),
  };
}

module.exports = { paneRoutes, statusRoute };
