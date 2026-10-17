// The set of origins a user explicitly opened on each browser pane (L-5): one Set per pane key.
// A thread's control-server call can navigate only within an origin the user already opened, or
// the same origin the pane is on. file: and about: URLs have no remote origin and are always
// allowed; the first load (priorOrigin null) is the board's restore call.

function canThreadOpen(authorized, targetKey, origin, priorOrigin) {
  if (origin === null || origin === "null" || !priorOrigin || origin === priorOrigin) return true;
  return Boolean(authorized.get(targetKey)?.has(origin));
}

function rememberBoardOrigin(authorized, targetKey, origin) {
  if (origin === null || origin === "null") return;
  const set = authorized.get(targetKey) ?? new Set();
  set.add(origin);
  authorized.set(targetKey, set);
}

module.exports = { canThreadOpen, rememberBoardOrigin };
