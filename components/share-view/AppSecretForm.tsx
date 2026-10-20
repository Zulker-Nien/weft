// The portal a hosted mini app pops when its page calls weft.requestSecret(name) for a from:"viewer"
// secret. The parent (components/share-view/SharedApp.tsx) passes shareId, the secret's name, the hosts
// the value is allowed to reach and an onDone that resolves the bridge call. Save PUTs to /api/a/<id>/secret;
// Remove DELETEs the row; Cancel calls onDone(false) so the bridge promise still resolves. A failure surface
// the route returns as { error } is shown inline; success calls onDone(true) and the form unmounts itself.
"use client";

import { useEffect, useState } from "react";
import Modal from "../Modal";

// The bare metal: shareId, the secret name, where the value is allowed to go, and a callback the form calls
// when it's done (true when the value is now set, false on cancel / remove / error so the bridge promise still
// resolves).
export type AppSecretFormProps = {
  shareId: string;
  name: string;
  hosts: string[];
  onDone: (set: boolean) => void;
};

// Calls /api/a/<id>/secret with the given JSON body and parses { error?, set? } on the way back. A 2xx with
// a missing `set` field still resolves with the boolean; a non-2xx rejects with the route's error string so
// the form can show it. The page's same-origin cookie goes with the request, so the server's web session
// knows the visitor. GET and DELETE send the name in the URL (the route reads it from the query); PUT
// sends the name + value in the JSON body.
async function callSecret(method: "GET" | "PUT" | "DELETE", shareId: string, body?: { name: string; value?: string }): Promise<{ set: boolean }> {
  const name = body?.name ?? "";
  const base = `/api/a/${shareId}/secret`;
  const url = method === "PUT" ? base : `${base}?name=${encodeURIComponent(name)}`;
  const init: RequestInit = { method, credentials: "same-origin" };
  if (method === "PUT") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(typeof data.error === "string" ? data.error : `${method} ${res.status}`);
  }
  const data = (await res.json()) as { set?: unknown };
  return { set: Boolean(data.set) };
}

export default function AppSecretForm({ shareId, name, hosts, onDone }: AppSecretFormProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasValue, setHasValue] = useState(false);

  // On mount: ask the server if the viewer already has a value, so the form's primary reads Save or Remove.
  // The bridge's requestSecret already returned { set: bool } to the page; we re-check here because the form
  // is its own surface (it might be re-opened after a save) and a single GET is cheaper than threading the
  // boolean through. A GET that fails just leaves hasValue false; Save still works.
  useEffect(() => {
    let ignore = false;
    callSecret("GET", shareId, { name }).then(
      (out) => { if (!ignore) setHasValue(out.set); },
      () => { /* silent: a 401/403 lands as the form's "fill it in" path */ },
    );
    return () => { ignore = true; };
  }, [shareId, name]);

  // The primary Save: PUT the value. On success, set hasValue, clear the input, call onDone(true). The
  // parent unmounts the form by closing the modal; the onDone call is the bridge's resolve.
  async function save() {
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await callSecret("PUT", shareId, { name, value });
      setHasValue(true);
      setValue("");
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Remove: DELETE the row. onDone(false) so the app's weft.requestSecret can re-render with the form back
  // open, or surface a "no value" message; either way the bridge promise resolves.
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await callSecret("DELETE", shareId, { name });
      setHasValue(false);
      onDone(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={<span className="block truncate">Provide {name}</span>} placement="top" onClose={() => onDone(false)} className="w-full max-w-[420px]">
      <div className="flex flex-col gap-3 p-3">
        <p className="text-[12.5px] text-faint">
          This app uses <span className="font-medium text-ink">{name}</span> to talk to{" "}
          {hosts.length > 0 ? (
            <span className="font-medium text-ink">{hosts.join(", ")}</span>
          ) : (
            <span className="font-medium text-ink">its allowed hosts</span>
          )}
          . Weft stores your value encrypted and only sends it to those hosts.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">Value</span>
          <input
            autoFocus
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}
            disabled={busy}
            placeholder={hasValue ? "Replace the current value" : "Paste your key"}
            aria-label={`${name} value`}
            className="rounded-md border border-line bg-sunken px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-60"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[12px] text-red-300">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void save(); }}
            disabled={busy || !value}
            className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
          >
            {hasValue ? "Replace" : "Save"}
          </button>
          {hasValue && (
            <button type="button" onClick={() => { void remove(); }} disabled={busy} className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50">
              Remove
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={() => onDone(false)} disabled={busy} className="text-[12px] text-faint hover:text-ink disabled:opacity-50">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}