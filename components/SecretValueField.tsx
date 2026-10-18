"use client";

import { useState } from "react";
import { randomSecret } from "@/lib/random-secret";
import Icon from "./Icon";

// The value input of the 🔐 drawer's form (components/VaultParts.tsx SecretForm): hidden unless you show
// it, with a dice that fills in a random string (lib/random-secret.ts) for the CRON_SECRETs and signing
// secrets you make up yourself.
export function SecretValueField({
  value,
  fixed,
  autoFocus,
  className,
  onChange,
}: {
  value: string;
  fixed: boolean;
  autoFocus: boolean;
  className: string;
  onChange: (value: string) => void;
}) {
  const [show, setShow] = useState(false);
  const button = "rounded p-0.5 text-muted hover:text-ink";
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        placeholder={fixed ? "New value" : "Value"}
        aria-label="Value"
        data-secret
        spellCheck={false}
        autoComplete="off"
        className={`${className} pr-11 font-mono`}
      />
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
        <button type="button" onClick={() => onChange(randomSecret())} aria-label="Generate random value" title="Generate a random string" className={button}>
          <Icon name="dice" size={12} />
        </button>
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide value" : "Show value"} title={show ? "Hide" : "Show"} className={button}>
          <Icon name="eye" size={12} />
        </button>
      </div>
    </div>
  );
}
