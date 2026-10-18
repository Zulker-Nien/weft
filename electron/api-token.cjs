// Puts the launch's token on the board window's own requests to the local server (lib/guard.ts `sensitive`
// reads it), so a process that merely reaches the port can't read account, settings or services. The browser
// pane has its own session partition and never gets it, so a page a thread opens can't borrow it.
const API_TOKEN_HEADER = "x-weft-token";

function attachApiToken(session, serverUrl, token) {
  const origin = new URL(serverUrl).origin;
  session.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, [API_TOKEN_HEADER]: token } });
  });
}

module.exports = { attachApiToken, API_TOKEN_HEADER };
