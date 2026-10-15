// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultOverview } from "@/lib/vault-view";
import type { ThreadItem } from "@/lib/types";
import "./test-utils";
import SecretAskInput from "./SecretAskInput";
import { ThreadEntries, groupThread } from "./ThreadItems";

const ask = { folder: "/dev/web", name: "SUPABASE_SECRET_KEY", environment: "preview" as const };

function overview(missing: boolean): VaultOverview {
  return {
    unlocked: false,
    vaults: [{ id: "v", label: "o/web", folder: "/dev/web", folders: ["/dev/web"], nudge: null, secrets: [{ name: ask.name, environment: "preview", missing, tail: "", updatedAt: "" }] }],
  };
}

function shell(missing = true) {
  const vault = { overview: vi.fn(() => Promise.resolve(overview(missing))), set: vi.fn(() => Promise.resolve({ saved: true })) };
  (window as unknown as { threadboard: unknown }).threadboard = { vault };
  return vault;
}

afterEach(() => {
  delete (window as unknown as { threadboard?: unknown }).threadboard;
});

describe("SecretAskInput", () => {
  it("takes the value in the thread, puts it in the vault, and tells the thread", async () => {
    const vault = shell();
    const onAdded = vi.fn();
    render(<SecretAskInput ask={ask} onAdded={onAdded} />);
    const value = await screen.findByLabelText("Value");
    expect(value).toHaveFocus();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Add to vault" })).toBeDisabled();
    await userEvent.type(value, "sb_secret_x");
    await userEvent.click(screen.getByRole("button", { name: "Production" }));
    await userEvent.click(screen.getByRole("button", { name: "Add to 2 environments" }));
    expect(vault.set).toHaveBeenCalledWith("/dev/web", ask.name, "preview", "sb_secret_x");
    expect(vault.set).toHaveBeenCalledWith("/dev/web", ask.name, "production", "sb_secret_x");
    expect(onAdded).toHaveBeenCalledWith("I added SUPABASE_SECRET_KEY (preview, production) to the 🔐 vault.");
    expect(onAdded.mock.calls[0]?.[0]).not.toContain("sb_secret_x");
    expect(screen.getByText(/is in the 🔐 vault/)).toBeInTheDocument();
  });

  it("shows a ✓ when the vault already has it, and the vault's error when a save fails", async () => {
    shell(false);
    const { unmount } = render(<SecretAskInput ask={ask} />);
    expect(await screen.findByText(/is in the 🔐 vault/)).toBeInTheDocument();
    unmount();

    const vault = shell();
    vault.set.mockRejectedValueOnce(new Error("Vault is locked"));
    render(<SecretAskInput ask={ask} />);
    await userEvent.type(await screen.findByLabelText("Value"), "x{Enter}");
    expect(await screen.findByText("Vault is locked")).toBeInTheDocument();
  });

  it("points at the rail outside the desktop app", () => {
    render(<SecretAskInput ask={ask} />);
    expect(screen.getByText(/add it with 🔐 on the board's left rail/)).toBeInTheDocument();
  });

  it("stands on its own in a thread instead of folding into the tool run", async () => {
    shell();
    const items: ThreadItem[] = [
      { kind: "tool", id: "1", name: "Bash", summary: "ls", at: 0 },
      { kind: "tool", id: "2", name: "mcp__secrets__ask_add", summary: "", at: 0, ask },
      { kind: "tool", id: "3", name: "Bash", summary: "pwd", at: 0 },
    ];
    const entries = groupThread(items);
    expect(entries.map((e) => e.kind)).toEqual(["tools", "item", "tools"]);
    const onSend = vi.fn(() => Promise.resolve());
    render(<ThreadEntries entries={entries} live={false} streaming="" onSend={onSend} cardId="x" />);
    await waitFor(() => expect(screen.getByRole("form", { name: "Add SUPABASE_SECRET_KEY to the vault" })).toBeInTheDocument());
  });
});
