import { describe, expect, it } from "vitest";
import type { VaultSecret, VaultSummary } from "./vault-view";
import { matchesSecret, searchSecrets, vaultsWithMatches } from "./vault-search";

const secret = (name: string, hint?: string): VaultSecret => ({ name, environment: "development", missing: Boolean(hint), tail: "", updatedAt: "", hint });
const vault = (id: string, secrets: VaultSecret[]): VaultSummary => ({ id, label: id, folder: `/dev/${id}`, folders: [`/dev/${id}`], secrets, nudge: null });

describe("matchesSecret", () => {
  it("matches the name in any case", () => {
    expect(matchesSecret(secret("GITHUB_CLIENT_ID"), "github")).toBe(true);
    expect(matchesSecret(secret("GITHUB_CLIENT_ID"), "Client_Id")).toBe(true);
    expect(matchesSecret(secret("GITHUB_CLIENT_ID"), "resend")).toBe(false);
  });

  it("needs every word, and reads a blank's hint", () => {
    expect(matchesSecret(secret("STRIPE_WEBHOOK_SECRET"), "stripe hook")).toBe(true);
    expect(matchesSecret(secret("STRIPE_WEBHOOK_SECRET"), "stripe key")).toBe(false);
    expect(matchesSecret(secret("STRIPE_WEBHOOK_SECRET", "Stripe dashboard → Developers"), "dashboard")).toBe(true);
  });
});

describe("searchSecrets", () => {
  const all = [secret("PUKU_API_KEY"), secret("RESEND_API_KEY"), secret("SHARE_UNLOCK_PEPPER")];

  it("keeps everything for a blank query", () => {
    expect(searchSecrets(all, "")).toBe(all);
    expect(searchSecrets(all, "  _ ")).toBe(all);
  });

  it("keeps the matches", () => {
    expect(searchSecrets(all, "api").map((s) => s.name)).toEqual(["PUKU_API_KEY", "RESEND_API_KEY"]);
  });
});

describe("vaultsWithMatches", () => {
  const vaults = [vault("a", [secret("PUKU_API_KEY")]), vault("b", [secret("DATABASE_URL")]), vault("c", [])];

  it("keeps every vault for a blank query", () => {
    expect(vaultsWithMatches(vaults, "", null)).toBe(vaults);
  });

  it("drops vaults without a match, but keeps the one being edited", () => {
    expect(vaultsWithMatches(vaults, "puku", null).map((v) => v.id)).toEqual(["a"]);
    expect(vaultsWithMatches(vaults, "puku", "c").map((v) => v.id)).toEqual(["a", "c"]);
  });
});
