// The vault's question to the user: Touch ID, or a plain confirmation dialog on a Mac that can't ask for it
// (electron/vault.cjs, and through it every reveal, copy, fill, run and push).

function touchIdPrompt({ systemPreferences, dialog, window }) {
  return async (reason) => {
    if (systemPreferences.canPromptTouchID?.()) {
      try {
        await systemPreferences.promptTouchID(reason);
        return true;
      } catch {
        return false;
      }
    }
    const { response } = await dialog.showMessageBox(window(), {
      type: "warning",
      buttons: ["Cancel", "Allow"],
      defaultId: 0,
      cancelId: 0,
      message: `Weft wants to ${reason}`,
      detail: "Touch ID isn't available, so confirm here.",
    });
    return response === 1;
  };
}

module.exports = { touchIdPrompt };
