// Main's side of a data mini app's reads: the two read kinds and their caps live in app-read-core.cjs,
// shared with the hosted route (app/api/a/[id]/read/route.ts), so a fix to one is a fix to both.
// Main calls runSupabase with the core's defaults (the manifest's args are sent unless the page overrides
// them) and hands runGa4 its own token Map; refusals come back as err.kind, which app-data.cjs passes to
// the page. app-data.cjs and app-data-frame.cjs keep requiring this module, so main has one front door.

module.exports = require("./app-read-core.cjs");
