// Swaps vault values for ‹NAME› in text a thread or the board will see (docs/architecture/secrets.md): a
// command's output, a dev server's log, a stored tool result. Catches the value as written and the forms
// programs print it in: JSON-escaped, URL-encoded (as in a connection string or a query), and base64 (a
// Basic auth header, a token), including base64 of the value sitting inside a longer string.

// Shorter derived forms would match ordinary text.
const MIN_FORM = 8;
// Shorter values are left alone: redacting "1" or "dev" everywhere would garble every line.
const MIN_VALUE = 4;

function base64Forms(value) {
  const bytes = Buffer.from(value, "utf8");
  const forms = [];
  for (let k = 0; k < 3; k++) {
    const encoded = Buffer.concat([Buffer.alloc(k), bytes]).toString("base64");
    // The first chars carry the k padding bytes; the last group mixes with whatever follows the value.
    const start = k === 0 ? 0 : k + 1;
    const end = 4 * Math.floor((k + bytes.length) / 3);
    if (k === 0) forms.push(encoded, encoded.replace(/=+$/, ""));
    forms.push(encoded.slice(start, end));
  }
  return forms.flatMap((f) => [f, f.replace(/\+/g, "-").replace(/\//g, "_")]);
}

/** Every form of a value worth hiding, longest first. */
function formsOf(value) {
  if (typeof value !== "string" || value.length < MIN_VALUE) return [];
  const uri = encodeURIComponent(value);
  const derived = [
    JSON.stringify(value).slice(1, -1),
    uri,
    uri.replace(/%20/g, "+"),
    uri.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()),
    ...base64Forms(value),
  ].filter((f) => f !== value && f.length >= MIN_FORM);
  return [...new Set([value, ...derived])].sort((a, b) => b.length - a.length);
}

/**
 * A function that redacts the given secrets. entries: [{ name, value }].
 * @returns {(text: string) => string}
 */
function redactor(entries) {
  const pairs = entries.flatMap(({ name, value }) => formsOf(value).map((form) => [form, `‹${name}›`]));
  pairs.sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    let out = String(text ?? "");
    for (const [form, label] of pairs) if (out.includes(form)) out = out.split(form).join(label);
    return out;
  };
}

module.exports = { redactor, formsOf };
