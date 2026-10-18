// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPeople } from "./ProjectPeople";
import type { TeamClientActions } from "@/lib/team-types";
import "../test-utils";

const callMock = vi.fn();
vi.mock("@/lib/client-api", () => ({ call: (...a: unknown[]) => callMock(...a) as unknown }));

const person = (login: string, email: string | null) => ({ login, avatarUrl: "", email, repos: ["a/b"] });
const roleOptions = [{ role: "member" as const, label: "Member", description: "" }];
let actions: TeamClientActions;

beforeEach(() => {
  callMock.mockReset();
  actions = { invite: vi.fn().mockResolvedValue({ ok: true, message: "Invited ada." }) } as unknown as TeamClientActions;
});

const view = (repos = ["a/b"], extra: Partial<Parameters<typeof ProjectPeople>[0]> = {}) =>
  render(<ProjectPeople repos={repos} members={[]} pending={[]} actions={actions} roleOptions={roleOptions} {...extra} />);

describe("ProjectPeople", () => {
  it("renders nothing without repos", () => {
    const { container } = view([]);
    expect(container).toBeEmptyDOMElement();
    expect(callMock).not.toHaveBeenCalled();
  });

  it("invites a person with a known email directly", async () => {
    callMock.mockResolvedValue({ people: [person("ada", "ada@x.co")], error: null });
    view();
    await userEvent.click(await screen.findByRole("button", { name: "Invite" }));
    expect(actions.invite).toHaveBeenCalledWith("ada@x.co", "member");
    expect(await screen.findByText("Invited ada.")).toBeInTheDocument();
  });

  it("asks for an email first when none is known", async () => {
    callMock.mockResolvedValue({ people: [person("bob", null)], error: null });
    view();
    await userEvent.click(await screen.findByRole("button", { name: "Invite" }));
    expect(actions.invite).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Email for bob"), "bob@x.co");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(actions.invite).toHaveBeenCalledWith("bob@x.co", "member");
  });

  it("hides members and shows five, then all", async () => {
    const many = Array.from({ length: 7 }, (_, i) => person(`u${i}`, `u${i}@x.co`));
    callMock.mockResolvedValue({ people: many, error: null });
    view(["a/b"], { members: [{ email: "U0@x.co" }] });
    await screen.findByText("u1");
    expect(screen.queryByText("u0")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Invite" })).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: "Show all 6" }));
    expect(screen.getAllByRole("button", { name: "Invite" })).toHaveLength(6);
  });

  it("shows one muted line when gh errors, nothing when no people", async () => {
    callMock.mockResolvedValue({ people: [], error: "not logged in" });
    const { unmount } = view();
    expect(await screen.findByText(/not logged in/)).toBeInTheDocument();
    unmount();
    callMock.mockResolvedValue({ people: [], error: null });
    const { container } = view();
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(2));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a request failure as the muted line", async () => {
    callMock.mockRejectedValue(new Error("offline"));
    view();
    expect(await screen.findByText(/offline/)).toBeInTheDocument();
  });
});
