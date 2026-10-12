// Picks the weft:// link out of an argv array, the way the dev wrapper (~/Applications/Weft Dev.app,
// scripts/dev-protocol.cjs) hands it to the running dev Electron on a second-instance launch.
// We accept two shapes: a raw `weft://…` arg (the wrapper's default) and the explicit
// `--weft-link=weft://…` form (used when a script wants to be obvious about the intent).
// Returns null for any argv that has no link — handleLink itself is what dispatches it.
function argvLink(argv, protocol = "weft") {
  if (!Array.isArray(argv)) return null;
  const raw = argv.find((arg) => typeof arg === "string" && arg.startsWith(`${protocol}://`));
  if (raw) return raw;
  const explicit = argv
    .map((arg) => (typeof arg === "string" ? /^--weft-link=(.+)$/.exec(arg)?.[1] : undefined))
    .find(Boolean);
  return explicit ?? null;
}

module.exports = { argvLink };
