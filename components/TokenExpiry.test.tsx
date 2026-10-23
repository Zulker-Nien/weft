// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import TokenExpiry from "./TokenExpiry";

const NOW = Date.UTC(2026, 9, 23, 12);
const DAY = 86_400_000;

const status = vi.hoisted(() => vi.fn());
const connect = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.clearAllMocks();
  // useNow reads Date.now(). Fake timers would freeze the promise resolution the row waits on, so the clock
  // is pinned directly and restored after.
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  window.weft = { blastcp: { status, connect } } as unknown as typeof window.weft;
});

// Only weft's own bridge goes; the rest of window is jsdom's and the next render needs it.
afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { weft?: unknown }).weft;
});

const signedIn = (expiresAt: number | null) =>
  status.mockResolvedValue({ signedIn: true, user: { email: "me@x.com" }, expiresAt, error: null, folders: [] });

describe("TokenExpiry", () => {
  it("says BlastCP isn't signed in when it isn't", async () => {
    status.mockResolvedValue({ signedIn: false, user: null, expiresAt: null, error: null, folders: [] });
    render(<TokenExpiry />);
    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
  });

  it("stays quiet about an expiry more than a week out", async () => {
    signedIn(NOW + 20 * DAY);
    render(<TokenExpiry />);
    expect(await screen.findByText("Signed in, no expiry")).toBeInTheDocument();
  });

  it("warns in the last week, reusing the drawer's own note", async () => {
    signedIn(NOW + 3 * DAY);
    render(<TokenExpiry />);
    expect(await screen.findByText("Sign-in runs out in 3 days")).toBeInTheDocument();
  });

  it("says it ran out once the sign-in is past", async () => {
    signedIn(NOW - DAY);
    render(<TokenExpiry />);
    expect(await screen.findByText("Sign-in ran out")).toBeInTheDocument();
  });

  it("lists the API-token providers as not expiring", async () => {
    signedIn(null);
    render(<TokenExpiry />);
    for (const name of ["Vercel", "Supabase", "Cloudflare"]) {
      expect(await screen.findByText(name)).toBeInTheDocument();
    }
    expect(screen.getAllByText("No expiry")).toHaveLength(3);
  });

  it("draws the row without asking Electron for anything when there's no bridge", () => {
    delete (window as { weft?: unknown }).weft;
    render(<TokenExpiry />);
    expect(status).not.toHaveBeenCalled();
    expect(screen.getByText("Not signed in")).toBeInTheDocument();
  });

  it("keeps the row when BlastCP can't be asked", async () => {
    status.mockRejectedValue(new Error("no handler"));
    render(<TokenExpiry />);
    await waitFor(() => expect(screen.getAllByText("No expiry")).toHaveLength(3));
    expect(screen.getByText("Not signed in")).toBeInTheDocument();
  });
});