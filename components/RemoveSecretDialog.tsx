"use client";

import { useState } from "react";
import { useCountdown } from "@/lib/use-countdown";
import type { VaultEnvironment } from "@/lib/vault-view";
import CountdownButton, { CONFIRM_WAIT_MS } from "./CountdownButton";
import Modal from "./Modal";
import { EnvironmentPicker } from "./VaultParts";

// Removing a secret that's in more than one environment, or from its right-click menu: which of its
// environments to take it out of (the one you clicked is ticked), then the same countdown as the row's
// 🗑 before it goes. Changing the picks calls the countdown off.
export default function RemoveSecretDialog({
  name,
  environments,
  initial,
  busy,
  onRemove,
  onClose,
}: {
  name: string;
  // The environments the name is in.
  environments: VaultEnvironment[];
  initial: VaultEnvironment;
  busy: boolean;
  onRemove: (picked: VaultEnvironment[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<VaultEnvironment[]>([initial]);
  const { left, arm, disarm } = useCountdown(CONFIRM_WAIT_MS);
  const label = picked.length > 1 ? (picked.length === environments.length ? `Remove from all ${picked.length}` : `Remove from ${picked.length}`) : "Remove";
  const button = "rounded-md px-3 py-1 text-[12px]";
  return (
    <Modal title={`Remove ${name}`} onClose={onClose} className="w-full max-w-[340px]">
      <div className="flex flex-col gap-3 px-4 pb-4 pt-1 text-[12.5px]">
        <p className="text-muted">{environments.length > 1 ? `It's in ${environments.length} environments. Remove it from:` : "Remove it from:"}</p>
        <EnvironmentPicker
          value={picked}
          only={environments}
          onChange={(next) => {
            disarm();
            setPicked(next);
          }}
        />
        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={onClose} className={`${button} text-muted hover:bg-sunken hover:text-ink`}>
            Cancel
          </button>
          {left === null ? (
            <button type="button" onClick={arm} disabled={!picked.length || busy} className={`${button} bg-danger font-medium text-white disabled:opacity-50`}>
              {label}
            </button>
          ) : (
            <CountdownButton
              left={left}
              label={label}
              ariaLabel={`Confirm removing ${name}`}
              title={`Remove ${name} from ${picked.join(", ")}`}
              onConfirm={() => onRemove(picked)}
              className={button}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
