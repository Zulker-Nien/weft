// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import TrustedFolders from "./TrustedFolders";

const api = vi.hoisted(() => ({ unallowFolder: vi.fn(() => Promise.resolve({ ok: true as const })) }));
vi.mock("@/lib/client", () => ({ api }));

const DOWNLOADS = "/Users/me/Downloads";
const MUSIC = "/Users/me/Music";
// Each button names the folder it takes back, so a test asks for that one rather than counting buttons.
const stopTrusting = (folder: string) => screen.getByRole("button", { name: `Stop trusting ${folder}` });

beforeEach(() => {
  vi.clearAllMocks();
  api.unallowFolder.mockResolvedValue({ ok: true });
});

describe("TrustedFolders", () => {
  it("says nothing is trusted when the list is empty", () => {
    render(<TrustedFolders folders={[]} />);
    expect(screen.getByText(/None\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stop trusting/ })).not.toBeInTheDocument();
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