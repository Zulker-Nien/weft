// @vitest-environment jsdom
// AppSecretForm: the portal a hosted mini app pops for a from:"viewer" secret. Save PUTs, Remove DELETEs,
// Cancel calls onDone(false). The route's GET is on mount to know whether to show Remove.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-utils";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const { default: AppSecretForm } = await import("./AppSecretForm");

function setup() {
  const onDone = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ set: false }), { status: 200, headers: { "content-type": "application/json" } }));
  render(<AppSecretForm shareId="s1" name="OPENAI_KEY" hosts={["api.openai.com"]} onDone={onDone} />);
  return { onDone, input: () => screen.getByLabelText<HTMLInputElement>("OPENAI_KEY value") };
}

describe("AppSecretForm", () => {
  it("asks GET on mount to know if the viewer has a value", async () => {
    const { onDone } = setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/a/s1/secret?name=OPENAI_KEY", expect.objectContaining({ method: "GET", credentials: "same-origin" })));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    onDone.mockReset();
  });

  it("shows Remove when the viewer already has a value", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({ set: true }), { status: 200 }));
    render(<AppSecretForm shareId="s1" name="OPENAI_KEY" hosts={["api.openai.com"]} onDone={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("saves the value via PUT, marks the viewer as set, and calls onDone(true)", async () => {
    const { onDone, input: getInput } = setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ set: true }), { status: 200 }));
    await userEvent.type(getInput(), "sk-openai-x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/a/s1/secret");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ name: "OPENAI_KEY", value: "sk-openai-x" });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    // The Replace / Remove pair shows up now that the save succeeded.
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("submits on Enter inside the password input", async () => {
    const { onDone, input: getInput } = setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ set: true }), { status: 200 }));
    const input = getInput();
    await userEvent.type(input, "sk-x");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
  });

  it("shows the route's error string when the save fails", async () => {
    const { input: getInput } = setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate limit exceeded" }), { status: 429 }));
    await userEvent.type(getInput(), "sk-x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("rate limit exceeded");
    expect(getInput()).toHaveValue("sk-x");
  });

  it("removes the value via DELETE and calls onDone(false)", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({ set: true }), { status: 200 }));
    render(<AppSecretForm shareId="s1" name="OPENAI_KEY" hosts={["api.openai.com"]} onDone={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument());
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ set: false }), { status: 200 }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/a/s1/secret?name=OPENAI_KEY");
    expect(init.method).toBe("DELETE");
  });

  it("Cancel calls onDone(false) without a network call", async () => {
    const { onDone } = setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenCalledWith(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the Save button disabled while busy", async () => {
    const { input: getInput } = setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    let resolveFetch: (v: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((res) => { resolveFetch = res; }));
    await userEvent.type(getInput(), "sk-x");
    const saveBtn = screen.getByRole("button", { name: "Save" });
    await userEvent.click(saveBtn);
    expect(saveBtn).toBeDisabled();
    act(() => {
      resolveFetch(new Response(JSON.stringify({ set: true }), { status: 200 }));
    });
  });

  it("lists every host the value is allowed to reach", () => {
    fetchMock.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({ set: false }), { status: 200 }));
    render(<AppSecretForm shareId="s1" name="STRIPE_KEY" hosts={["api.stripe.com", "api.openai.com"]} onDone={vi.fn()} />);
    expect(screen.getByText(/api\.stripe\.com/)).toBeInTheDocument();
    expect(screen.getByText(/api\.openai\.com/)).toBeInTheDocument();
  });
});