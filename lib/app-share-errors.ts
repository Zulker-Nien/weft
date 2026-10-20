// A refusal the route turns into its status (a missing app is a 404, a bad request a 400).
// Lives in its own module so app-share.ts and its split-out files (app-share-owners.ts,
// app-share-page.ts) share the same error type without a cycle.
export class AppShareError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
