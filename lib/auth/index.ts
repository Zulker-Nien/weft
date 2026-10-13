// The single import surface for the local auth seam. When the upstream tag
// lands, this file becomes `export * from "@aimhuge/auth"` (with our
// `desktop` re-exported from `./desktop.ts`) and the rest of the app doesn't
// change.
export { safeNextPath } from "./next-path";
export { identityFromUser, type SessionIdentity } from "./identity";
export { createAuthCallback, readSessionIdentity, signOutAction } from "./server";
export { useAuth, type AuthProvider, type AuthBusy, type AuthState, type AuthWaiting, type UseAuthOptions } from "./hooks";
export { LoginForm, type LoginFormProps } from "./login-form";
export { SignedInPrompt } from "./signed-in-prompt";
export { desktop, type DesktopAuth, openExternal, isDesktop, authRedirectTo } from "./desktop";
