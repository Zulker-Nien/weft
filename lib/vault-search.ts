import type { VaultSecret, VaultSummary } from "./vault-view";

// The 🔐 drawer's search box: a secret matches when its name, or a blank's hint, holds every word of the
// query in any case ("stripe hook" finds STRIPE_WEBHOOK_SECRET). A blank query matches everything.

const wordsOf = (query: string) => query.toLowerCase().split(/[\s_]+/).filter(Boolean);

export function matchesSecret(s: Pick<VaultSecret, "name" | "hint">, query: string): boolean {
  const text = `${s.name} ${s.hint ?? ""}`.toLowerCase();
  return wordsOf(query).every((w) => text.includes(w));
}

export function searchSecrets<T extends Pick<VaultSecret, "name" | "hint">>(secrets: T[], query: string): T[] {
  return wordsOf(query).length ? secrets.filter((s) => matchesSecret(s, query)) : secrets;
}

// The vaults worth a section while searching: those with a match, plus the one whose form is open.
export function vaultsWithMatches(vaults: VaultSummary[], query: string, editingVault: string | null): VaultSummary[] {
  if (!wordsOf(query).length) return vaults;
  return vaults.filter((v) => v.id === editingVault || searchSecrets(v.secrets, query).length > 0);
}
