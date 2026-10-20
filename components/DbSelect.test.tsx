// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "./test-utils";
import DbSelect, { DbNewButton, BEST_FIT } from "./DbSelect";

type Row = { id: string; name: string; detail?: string };
const row = (over: Partial<Row>): Row => ({ id: "x", name: "x", ...over });

function setup(over: Partial<React.ComponentProps<typeof DbSelect<Row>>> = {}) {
  const onSearch = vi.fn();
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const rows = [
    { item: row({ id: "a", name: "weft-app", detail: "team-1" }), score: 2 },
    { item: row({ id: "b", name: "docs", detail: "team-2" }), score: 0 },
    { item: row({ id: "c", name: "Weft", detail: "team-3" }), score: 2 },
  ];
  render(
    <DbSelect<Row>
      title="Link weft to…"
      ariaLabel="Link weft to…"
      rows={rows}
      loading="Loading…"
      search=""
      onSearch={onSearch}
      searchLabel="Search projects"
      searchPlaceholder="Search projects"
      emptyText="No matches."
      rowKey={(r) => r.id}
      onPick={onPick}
      onCancel={onCancel}
      renderRow={(r) => (
        <>
          {r.name}
          {r.detail && <span> · {r.detail}</span>}
        </>
      )}
      {...over}
    />
  );
  return { onSearch, onPick, onCancel, user: userEvent.setup() };
}

describe("DbSelect", () => {
  it("renders the title and a Cancel button", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Link weft to…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("renders one button per row that calls onPick with the item", async () => {
    const { onPick, user } = setup();
    await user.click(screen.getByRole("button", { name: /weft-app/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "a", name: "weft-app" }));
  });

  it("disables every row button while `busy`", async () => {
    const { onPick, user } = setup({ busy: true });
    await user.click(screen.getByRole("button", { name: /weft-app/ }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("shows the loading note while rows is null", () => {
    setup({ rows: null });
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows the empty note when the rows are an empty array", () => {
    setup({ rows: [] });
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("types in the search box call onSearch", async () => {
    const { onSearch, user } = setup();
    await user.type(screen.getByLabelText("Search projects"), "weft");
    expect(onSearch).toHaveBeenCalledWith("w");
  });

  it("Escape in the search box calls onCancel", async () => {
    const { onCancel, user } = setup();
    await user.type(screen.getByLabelText("Search projects"), "{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("hides the search box and list when hideSearch is set", () => {
    setup({ hideSearch: true });
    expect(screen.queryByLabelText("Search projects")).not.toBeInTheDocument();
  });

  it("renders the extra slot (a + New project button) above the list", async () => {
    const onClick = vi.fn();
    const { user } = setup({ extra: <DbNewButton onClick={onClick} label="New project" /> });
    await user.click(screen.getByRole("button", { name: /New project/ }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("BEST_FIT", () => {
  it("is the score at which the badge kicks in", () => {
    expect(BEST_FIT).toBe(2);
  });
});