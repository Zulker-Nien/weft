// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VercelBridge, VercelEnvStatus } from "@/lib/vercel-view";
import "./test-utils";
import VercelEnv from "./VercelEnv";

const STATUS: VercelEnvStatus = {
  label: "aimhuge/weft",
  project: "weft",
  rows: [
    { name: "SUPABASE_SECRET_KEY", environment: "production", inVault: true, onVercel: false },
    { name: "GITHUB_CLIENT_ID", environment: "production", inVault: true, onVercel: true },
    { name: "VERCEL_ONLY", environment: "preview", inVault: false, onVercel: true },
    { name: "TODO", environment: "development", inVault: false, onVercel: false },
  ],
};

function setup(over: Partial<VercelBridge> = {}) {
  const bridge = {
    envStatus: vi.fn(() => Promise.resolve(STATUS)),
    envPush: vi.fn(() => Promise.resolve({ pushed: true, project: "weft", label: "aimhuge/weft" })),
    ...over,
  } as unknown as VercelBridge;
  const notify = vi.fn();
  render(<VercelEnv folder="/dev/weft" bridge={bridge} notify={notify} />);
  return { bridge, notify };
}

describe("VercelEnv", () => {
  it("asks for a restart when main is older than env push", () => {
    setup({ envStatus: undefined });
    expect(screen.getByText("Restart Weft to push 🔐 secrets to Vercel")).toBeInTheDocument();
  });

  it("lists each vault name against Vercel, open when something's left to push", async () => {
    setup();
    expect(screen.getByText("Secrets: checking…")).toBeInTheDocument();
    expect(await screen.findByText("1 to push · 1 on Vercel")).toBeInTheDocument();
    expect(screen.getByText("Vercel only")).toBeInTheDocument();
    expect(screen.getByText("no value")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /1 to push/ }));
    expect(screen.queryByText("SUPABASE_SECRET_KEY")).not.toBeInTheDocument();
  });

  it("pushes one and reloads", async () => {
    const { bridge, notify } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Push" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Pushed SUPABASE_SECRET_KEY to weft (production). It's live from the next deploy"));
    expect(bridge.envPush).toHaveBeenCalledWith("/dev/weft", "SUPABASE_SECRET_KEY", "production");
    expect(bridge.envStatus).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "on Vercel · push again" }));
    await waitFor(() => expect(bridge.envPush).toHaveBeenCalledWith("/dev/weft", "GITHUB_CLIENT_ID", "production"));
  });

  it("toasts a failed push and shows a failed load", async () => {
    const { notify } = setup({ envPush: vi.fn(() => Promise.reject(new Error("Vercel answered 500."))) });
    await userEvent.click(await screen.findByRole("button", { name: "Push" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("Vercel answered 500.")));
  });

  it("shows why the variables couldn't be read", async () => {
    setup({ envStatus: vi.fn(() => Promise.reject(new Error("not linked"))) });
    expect(await screen.findByText("Secrets: not linked")).toBeInTheDocument();
  });

  it("starts closed when everything is on Vercel", async () => {
    setup({ envStatus: vi.fn(() => Promise.resolve({ ...STATUS, rows: [STATUS.rows[1]!] })) });
    expect(await screen.findByText("All 1 vault secret is on Vercel")).toBeInTheDocument();
    expect(screen.queryByText("GITHUB_CLIENT_ID")).not.toBeInTheDocument();
  });
});
