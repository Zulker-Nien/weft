// One invoice as a full page on weft.zip (/[orgSlug]/billing/invoices/[number]): the sheet behind a ticket on the
// Billing page. Presentational: the page reads the Invoice through the billing binding and hands it here with who
// it's for. Every figure is the invoice's own (frozen when it was issued); nothing is re-priced from the catalog.
// The scan stripe is decoration, so the only ways out are the real links: the provider's PDF and hosted page.
import { formatMoney, type Invoice, type InvoiceLine } from "@aimhuge/billing";
import { ScanCode } from "./ScanCode";

export type InvoiceSheetProps = {
  invoice: Invoice;
  billedTo: { name: string; email: string | null };
  /** "Visa ··4242" when the workspace has a card on file. */
  method: string | null;
  backHref: string;
};

// Dates are written in UTC so the server and the browser agree on the day.
export function sheetDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function sheetPeriod(from: string | null, to: string | null): string | null {
  const a = sheetDate(from);
  const b = sheetDate(to);
  return a && b ? `${a} – ${b}` : null;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="wz-sheetTile">
      <span className="wz-eyebrow">{label}</span>
      <b>{value}</b>
    </div>
  );
}

function LineRow({ line, currency }: { line: InvoiceLine; currency: string }) {
  const period = sheetPeriod(line.periodStart ?? null, line.periodEnd ?? null);
  return (
    <tr>
      <td>
        {line.description}
        {line.proration ? <span className="wz-sheetTag">Prorated</span> : null}
        {period ? <small>{period}</small> : null}
      </td>
      <td className="wz-sheetNum">{line.quantity}</td>
      <td className="wz-sheetNum">{formatMoney(line.amountCents, currency)}</td>
    </tr>
  );
}

export function InvoiceSheet({ invoice, billedTo, method, backHref }: InvoiceSheetProps) {
  const { currency } = invoice;
  const issued = sheetDate(invoice.issuedAt);
  const period = sheetPeriod(invoice.periodStart, invoice.periodEnd);
  const paid = sheetDate(invoice.paidAt);
  const due = sheetDate(invoice.dueAt);
  const owing = invoice.totalCents - invoice.amountPaidCents;
  return (
    <article className={`wz-sheet wz-sheet-${invoice.status}`}>
      <header className="wz-sheetTop">
        <a className="wz-sheetBack" href={backHref}>
          ← Billing
        </a>
        <span className="wz-sheetStamp">{invoice.status}</span>
        <div className="wz-sheetNo">
          <span className="wz-eyebrow">Invoice{issued ? ` · ${issued}` : ""}</span>
          <h1>{invoice.number}</h1>
        </div>
      </header>

      <div className="wz-sheetBody">
        <div className="wz-sheetRoute">
          <div>
            <span className="wz-eyebrow">Billed to</span>
            <b>{billedTo.name}</b>
            {billedTo.email ? <small>{billedTo.email}</small> : null}
          </div>
          <span className="wz-sheetTrace" aria-hidden="true" />
          <div className="wz-sheetTo">
            <span className="wz-eyebrow">From</span>
            <b>Weft</b>
            <small>weft.zip</small>
          </div>
        </div>

        <div className="wz-sheetMeta">
          {period ? <Tile label="Period" value={period} /> : null}
          {issued ? <Tile label="Issued" value={issued} /> : null}
          {paid ? <Tile label="Paid" value={paid} /> : due ? <Tile label="Due" value={due} /> : null}
          {method ? <Tile label="Method" value={method} /> : null}
        </div>

        <h2 className="wz-sheetHeading">{invoice.description ?? "What you flew"}</h2>
        {invoice.lines.length === 0 ? (
          <p className="wz-sheetEmpty">This invoice has no line items.</p>
        ) : (
          <table className="wz-sheetLines">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Qty</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, i) => (
                <LineRow key={`${i}-${line.description}`} line={line} currency={currency} />
              ))}
            </tbody>
          </table>
        )}

        <div className="wz-sheetSum">
          <dl className="wz-sheetTotals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatMoney(invoice.subtotalCents, currency)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{formatMoney(invoice.taxCents, currency)}</dd>
            </div>
            {invoice.amountPaidCents > 0 ? (
              <div>
                <dt>Paid</dt>
                <dd>{formatMoney(-invoice.amountPaidCents, currency)}</dd>
              </div>
            ) : null}
            {owing > 0 && invoice.status !== "void" ? (
              <div>
                <dt>Amount due</dt>
                <dd>{formatMoney(owing, currency)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="wz-sheetTotal">
            <span className="wz-eyebrow">Total, {currency.toUpperCase()}</span>
            <div className="wz-sheetBig">{formatMoney(invoice.totalCents, currency)}</div>
          </div>
        </div>
      </div>

      <footer className="wz-sheetFoot">
        <ScanCode seed={invoice.number} className="wz-sheetCode" />
        <code>{invoice.number}</code>
        <div className="wz-sheetActions">
          {invoice.hostedUrl ? (
            <a className="wz-sheetLink" href={invoice.hostedUrl} target="_blank" rel="noreferrer">
              Hosted page
            </a>
          ) : null}
          {invoice.pdfUrl ? (
            <a className="wz-sheetPdf" href={invoice.pdfUrl} target="_blank" rel="noreferrer">
              Download PDF
            </a>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
