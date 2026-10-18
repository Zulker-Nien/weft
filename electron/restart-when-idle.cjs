// Restart when idle from Electron's side: the app menu item and the updater's "Restart When Idle" arm the server's
// drain (lib/restart-when-idle.ts), and once its last running turn ends the server calls "POST /app/restart" on the
// control server (main.cjs), which runs restartFor here.

// Arms the server's restart; resolves to an error message, or null when it's armed.
async function armRestart(server, then = "relaunch", fetchImpl = fetch) {
  if (!server) return "Weft's server isn't running.";
  try {
    const res = await fetchImpl(`${server.url}/api/restart`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-weft-token": "1" },
      body: JSON.stringify({ then }),
    });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body.error || res.statusText || `HTTP ${res.status}`;
  } catch (err) {
    return String(err.message || err);
  }
}

// What the server's call does: install the downloaded update when that's what was armed and one is ready, otherwise
// relaunch. A moment's delay lets the control server answer before the app quits.
function restartFor({ then, updater, app, delay = 100 }) {
  setTimeout(() => {
    if (then === "update" && updater.installNow()) return;
    app.relaunch();
    app.quit();
  }, delay);
  return { ok: true };
}

module.exports = { armRestart, restartFor };
