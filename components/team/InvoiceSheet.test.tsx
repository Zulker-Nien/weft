// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Invoice } from "@aimhuge/billing";
import { InvoiceSheet, sheetDate } from "./InvoiceSheet";
import "../test-utils";

function makeInvoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "i1",
    orgId: "o1",
    number: "WEFT-2026-0007",
    status: "paid",
    currency: "usd",
    subtotalCents: 2000,
    taxCents: 0,
    totalCents: 2000,
    amountPaidCents: 2000,
    periodStart: "2026-10-14T00:00:00Z",
    periodEnd: "2026-11-14T00:00:00Z",
    issuedAt: "2026-10-14T09:00:00Z",
    paidAt: "2026-10-14T09:00:01Z",
    dueAt: null,
    description: null,
    lines: [{ description: "Weft Pro", quantity: 1, unitAmountCents: 2000, amountCents: 2000 }],
    hostedUrl: "https://stripe.test/inv",
    pdfUrl: "https://stripe.test/inv.pdf",
    ...over,
  };
}

const billedTo = { name: "AimHuge", email: "billing@aimhuge.com" };

describe("sheetDate", () => {
  it("writes the day in UTC, and nothing for a missing or bad date", () => {
    expect(sheetDate("2026-10-14T23:59:00Z")).toBe("Oct 14, 2026");
    expect(sheetDate(null)).toBeNull();
    expect(sheetDate("not a date")).toBeNull();
  });
});

describe("InvoiceSheet", () => {
  it("shows the number, status stamp, route, line items and total", () => {
    render(<InvoiceSheet invoice={makeInvoice()} billedTo={billedTo} method="Visa ··4242" backHref="/ada/billing" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("WEFT-2026-0007");
    expect(document.querySelector(".wz-sheetStamp")).toHaveTextContent("paid");
    expect(screen.getByText("AimHuge")).toBeInTheDocument();
    expect(screen.getByText("billing@aimhuge.com")).toBeInTheDocument();
    expect(screen.getByText("Weft Pro")).toBeInTheDocument();
    expect(document.querySelector(".wz-sheetBig")).toHaveTextContent("$20");
    expect(screen.getByText("Visa ··4242")).toBeInTheDocument();
    expect(screen.getByText("Oct 14, 2026 – Nov 14, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Billing" })).toHaveAttribute("href", "/ada/billing");
  });

  it("links the provider's PDF and hosted page, and only when it has them", () => {
    const { unmount } = render(<InvoiceSheet invoice={makeInvoice()} billedTo={billedTo} method={null} backHref="/b" />);
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "https://stripe.test/inv.pdf");
    expect(screen.getByRole("link", { name: "Hosted page" })).toHaveAttribute("href", "https://stripe.test/inv");
    unmount();
    render(<InvoiceSheet invoice={makeInvoice({ hostedUrl: null, pdfUrl: null })} billedTo={billedTo} method={null} backHref="/b" />);
    expect(screen.queryByRole("link", { name: "Download PDF" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Hosted page" })).not.toBeInTheDocument();
  });

  it("labels a prorated line and a credit's minus sign, and prints each line's own period", () => {
    const invoice = makeInvoice({
      subtotalCents: 1200,
      totalCents: 1200,
      amountPaidCents: 0,
      status: "open",
      paidAt: null,
      dueAt: "2026-10-28T00:00:00Z",
      lines: [
        { description: "Pro, 2 seats", quantity: 2, unitAmountCents: 1000, amountCents: 1400, proration: true, periodStart: "2026-10-20T00:00:00Z", periodEnd: "2026-11-14T00:00:00Z" },
        { description: "Credit", quantity: 1, unitAmountCents: -200, amountCents: -200 },
      ],
    });
    render(<InvoiceSheet invoice={invoice} billedTo={billedTo} method={null} backHref="/b" />);
    expect(screen.getByText("Prorated")).toBeInTheDocument();
    expect(screen.getByText("Oct 20, 2026 – Nov 14, 2026")).toBeInTheDocument();
    expect(screen.getByText("−$2")).toBeInTheDocument();
    expect(document.querySelector(".wz-sheetStamp")).toHaveTextContent("open");
    expect(screen.getByText("Due")).toBeInTheDocument();
    const totals = within(document.querySelector(".wz-sheetTotals") as HTMLElement);
    expect(totals.getByText("Amount due")).toBeInTheDocument();
  });

  it("shows what was paid, and no amount due once it's settled", () => {
    render(<InvoiceSheet invoice={makeInvoice()} billedTo={billedTo} method={null} backHref="/b" />);
    const totals = within(document.querySelector(".wz-sheetTotals") as HTMLElement);
    expect(totals.getByText("Paid")).toBeInTheDocument();
    expect(totals.queryByText("Amount due")).not.toBeInTheDocument();
  });

  it("copes with no email, no card, no period and no lines", () => {
    const invoice = makeInvoice({ lines: [], periodStart: null, periodEnd: null, paidAt: null, amountPaidCents: 0, status: "void", totalCents: 0, subtotalCents: 0, description: "Void note" });
    render(<InvoiceSheet invoice={invoice} billedTo={{ name: "AimHuge", email: null }} method={null} backHref="/b" />);
    expect(screen.getByText("This invoice has no line items.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Void note" })).toBeInTheDocument();
    expect(screen.queryByText("Period")).not.toBeInTheDocument();
    expect(screen.queryByText("Method")).not.toBeInTheDocument();
    expect(document.querySelector(".wz-sheet-void")).not.toBeNull();
  });
});
