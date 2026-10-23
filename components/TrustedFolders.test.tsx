// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import TrustedFolders from "./TrustedFolders";

const api = vi.hoisted(() => ({
  allowFolder: vi.fn(() => Promise.resolve({ ok: true as const })),
  unallowFolder: vi.fn(() => Promise.resolve({ ok: true as const })),
}));
vi.mock("@/lib/client", () => ({ api }));

const DOWNLOADS = "/Users/me/Downloads";
const MUSIC = "/Users/me/Music";
const openFolder = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
// Each button names the folder it takes back, so a test asks for that one rather than counting buttons.
const stopTrusting = (folder: string) => screen.getByRole("button", { name: `Stop trusting ${folder}` });

beforeEach(() => {
  vi.clearAllMocks();
  api.allowFolder.mockResolvedValue({ ok: true });
  api.unallowFolder.mockResolvedValue({ ok: true });
  openFolder.mockResolvedValue(null);
  window.weft = { dialog: { openFolder } } as unknown as typeof window.weft;
});

afterEach(() => {
  delete (window as { weft?: unknown }).weft;
});

describe("TrustedFolders", () => {
  it("says nothing is trusted when the list is empty", () => {
    render(<TrustedFolders folders={[]} />);
    expect(screen.getByText(/None\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stop trusting/ })).not.toBeInTheDocument();
  });

  it("adds the folder the OS dialog picked", async () => {
    openFolder.mockResolvedValue(DOWNLOADS);
    render(<TrustedFolders folders={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /Add folder/ }));

    expect(openFolder).toHaveBeenCalled();
    // The same call the "Always" button on a folder-guard prompt makes, so both doors land in one place.
    expect(api.allowFolder).toHaveBeenCalledWith(DOWNLOADS);
    expect(await screen.findByText("Downloads")).toBeInTheDocument();
    expect(stopTrusting(DOWNLOADS)).toBeInTheDocument();
  });

  it("adds nothing when the dialog is cancelled", async () => {
    openFolder.mockResolvedValue(null);
    render(<TrustedFolders folders={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /Add folder/ }));

    expect(api.allowFolder).not.toHaveBeenCalled();
    expect(screen.getByText(/None\./)).toBeInTheDocument();
  });

  it("keeps the list unchanged and says why when the grant fails", async () => {
    openFolder.mockResolvedValue(DOWNLOADS);
    api.allowFolder.mockRejectedValue(new Error("server down"));
    render(<TrustedFolders folders={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /Add folder/ }));

    expect(await screen.findByText("server down")).toBeInTheDocument();
    expect(screen.queryByText("Downloads")).not.toBeInTheDocument();
  });

  it("points at the folder prompt when there's no Electron bridge to pick with", async () => {
    delete (window as { weft?: unknown }).weft;
    render(<TrustedFolders folders={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /Add folder/ }));

    expect(await screen.findByText(/Weft can't pick a folder here/)).toBeInTheDocument();
    expect(api.allowFolder).not.toHaveBeenCalled();
  });

  it("doesn't list the same folder twice when one is already trusted", async () => {
    openFolder.mockResolvedValue(DOWNLOADS);
    render(<TrustedFolders folders={[DOWNLOADS]} />);
    await userEvent.click(screen.getByRole("button", { name: /Add folder/ }));

    expect(api.allowFolder).toHaveBeenCalledWith(DOWNLOADS);
    expect(screen.getAllByText("Downloads")).toHaveLength(1);
  });

  it("lists each folder by name, with the whole path on hover", () => {
    render(<TrustedFolders folders={[DOWNLOADS, MUSIC]} />);
    expect(screen.getByText("Downloads")).toBeInTheDocument();
    expect(screen.getByText("Music")).toBeInTheDocument();
    expect(screen.getByTitle(DOWNLOADS)).toBeInTheDocument();
    expect(stopTrusting(DOWNLOADS)).toBeInTheDocument();
    expect(stopTrusting(MUSIC)).toBeInTheDocument();
  });

  it("revokes the folder that was removed and leaves the rest", async () => {
    render(<TrustedFolders folders={[DOWNLOADS, MUSIC]} />);
    await userEvent.click(stopTrusting(DOWNLOADS));

    expect(api.unallowFolder).toHaveBeenCalledWith(DOWNLOADS);
    await waitFor(() => expect(screen.queryByText("Downloads")).not.toBeInTheDocument());
    expect(screen.getByText("Music")).toBeInTheDocument();
    expect(stopTrusting(MUSIC)).toBeInTheDocument();
  });

  it("keeps the row and says why when the revoke fails", async () => {
    api.unallowFolder.mockRejectedValue(new Error("server down"));
    render(<TrustedFolders folders={[DOWNLOADS]} />);
    await userEvent.click(stopTrusting(DOWNLOADS));

    expect(await screen.findByText("server down")).toBeInTheDocument();
    expect(screen.getByText("Downloads")).toBeInTheDocument();
  });

  it("can't revoke twice at once while the first is in flight", async () => {
    let release: (v: { ok: true }) => void = () => {};
    api.unallowFolder.mockReturnValue(new Promise((r) => (release = r)));
    render(<TrustedFolders folders={[DOWNLOADS, MUSIC]} />);

    await userEvent.click(stopTrusting(DOWNLOADS));
    // Both buttons are disabled while the first revoke is still out, so a second revoke can't race it.
    expect(stopTrusting(DOWNLOADS)).toBeDisabled();
    expect(stopTrusting(MUSIC)).toBeDisabled();
    expect(api.unallowFolder).toHaveBeenCalledTimes(1);

    release({ ok: true });
    // The revoked folder goes once the server answers; the other one is still trusted.
    await waitFor(() => expect(screen.queryByText("Downloads")).not.toBeInTheDocument());
    expect(stopTrusting(MUSIC)).toBeEnabled();
  });
});