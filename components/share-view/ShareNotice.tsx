// One line of why a share link shows nothing (not deployed, private, not set up), on weft.zip's sign-in card.
import type { ReactNode } from "react";

export function ShareNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="wz-app">
      <div className="wz-authCard">
        <h1 className="wz-authTitle">{title}</h1>
        <p className="wz-authSub">{children}</p>
      </div>
    </main>
  );
}
