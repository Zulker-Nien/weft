"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { mediaKind, mediaUrl } from "@/lib/media";
import { useOverlay } from "@/lib/overlay";
import { useEscape } from "@/lib/use-escape";

// An image, video, or sound in a thread message. Images open full size when clicked. Everything here is a
// span so it can sit inside a Markdown paragraph.
export default function MediaView({ src, alt = "", thumb = false }: { src: string; alt?: string; thumb?: boolean }) {
  const [zoomed, setZoomed] = useState(false);
  const [broken, setBroken] = useState(false);
  const url = mediaUrl(src);
  const kind = mediaKind(src);

  useEscape(zoomed, () => setZoomed(false));
  useOverlay(zoomed);

  if (!url || broken || kind === "file") {
    return (
      <span
        title={src}
        className="inline-flex max-w-full items-center gap-1 rounded border border-line bg-sunken px-1.5 py-0.5 align-middle font-mono text-[11.5px] text-muted"
      >
        <span className="truncate">{broken || !url ? `Can't show ${alt || src}` : alt || src}</span>
      </span>
    );
  }

  if (kind === "video") {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        onError={() => setBroken(true)}
        className={`my-1 block max-w-full rounded-lg bg-black ${thumb ? "max-h-28" : "max-h-72"}`}
      />
    );
  }

  if (kind === "audio") {
    // Labelled, so a set of sounds to compare reads as a list of named options.
    return (
      <span className="my-1 flex w-fit max-w-full flex-col gap-1 rounded-lg border border-line bg-sunken px-3 py-2">
        {alt && <span className="truncate text-[12.5px] text-ink">{alt}</span>}
        <audio src={url} controls preload="metadata" onError={() => setBroken(true)} className="h-8 w-[300px] max-w-full" />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        title={alt || "Open image"}
        className={`block max-w-full overflow-hidden rounded-lg border border-line bg-sunken hover:border-line-strong ${thumb ? "" : "my-1"}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local attachments, sized by the thread */}
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onError={() => setBroken(true)}
          className={`block max-w-full object-contain ${thumb ? "h-28 w-auto" : "max-h-72"}`}
        />
      </button>
      {zoomed &&
        createPortal(
          <div
            role="dialog"
            aria-label={alt || "Image"}
            onClick={() => setZoomed(false)}
            className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-8"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- full-size view of the same image */}
            <img src={url} alt={alt} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" />
          </div>,
          document.body,
        )}
    </>
  );
}
