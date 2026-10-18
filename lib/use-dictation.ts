"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "./client";

// The mic button. It records from the microphone and transcribes on this Mac with whisper.cpp (see
// lib/transcribe.ts). Without whisper, a normal Chrome tab falls back to the browser's own speech
// recognition; the desktop app's Chromium has none.

export type DictationState = "idle" | "recording" | "transcribing";

// Long enough for a rambling brief, short enough that a forgotten mic stops on its own.
const MAX_SECONDS = 10 * 60;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function browserRecognizer(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  // The desktop app's Chromium has the API but no service behind it.
  if (window.weft) return null;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Calls onTick with the whole seconds elapsed, four times a second, until the interval is cleared.
function startClock(onTick: (seconds: number) => void) {
  const began = Date.now();
  return setInterval(() => onTick(Math.floor((Date.now() - began) / 1000)), 250);
}

let whisper: Promise<{ available: boolean; reason?: string }> | undefined;

function whisperStatus() {
  whisper ??= api.dictation().catch((err: unknown) => {
    whisper = undefined;
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  });
  return whisper;
}

export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  // Mic loudness, 0 to 1, for the button's pulse.
  const [level, setLevel] = useState(0);
  const stopRef = useRef<((send: boolean) => void) | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  // Stop recording (and drop it) if the composer goes away mid-recording.
  useEffect(() => () => stopRef.current?.(false), []);

  async function start() {
    if (state !== "idle") return;
    setError(null);
    const status = await whisperStatus();
    if (!status.available) {
      const Recognizer = browserRecognizer();
      if (Recognizer) {
        startBrowser(Recognizer);
        return;
      }
      setError(status.reason ?? "Dictation isn't available here.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const name = (err as DOMException).name;
      setError(
        name === "NotAllowedError"
          ? "Weft can't use the microphone. Allow it in System Settings → Privacy & Security → Microphone."
          : `Couldn't open the microphone: ${(err as Error).message}`,
      );
      return;
    }

    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const meter = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const s of samples) peak = Math.max(peak, Math.abs(s - 128));
      setLevel(Math.min(1, peak / 64));
      frame = requestAnimationFrame(meter);
    };
    meter();

    const timer = startClock((elapsed) => {
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stopRef.current?.(true);
    });

    let send = true;
    const cleanup = () => {
      clearInterval(timer);
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((t) => t.stop());
      void audio.close();
      setLevel(0);
      stopRef.current = null;
    };
    recorder.onstop = async () => {
      cleanup();
      if (!send || !chunks.length) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const text = await api.transcribe(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        if (text) onTextRef.current(text);
        else setError("Didn't catch anything. Try again a little closer to the mic.");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setState("idle");
      }
    };
    stopRef.current = (keep) => {
      send = keep;
      if (recorder.state !== "inactive") recorder.stop();
    };
    recorder.start(1000);
    setSeconds(0);
    setState("recording");
  }

  function startBrowser(Recognizer: new () => SpeechRecognitionLike) {
    const recognizer = new Recognizer();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = navigator.language || "en-US";
    let send = true;
    recognizer.onresult = (e) => {
      if (!send) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result?.[0]?.transcript.trim();
        if (result?.isFinal && text) onTextRef.current(text);
      }
    };
    recognizer.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") setError(`Dictation stopped: ${e.error}`);
    };
    const timer = startClock(setSeconds);
    recognizer.onend = () => {
      clearInterval(timer);
      stopRef.current = null;
      setState("idle");
    };
    stopRef.current = (keep) => {
      send = keep;
      recognizer.stop();
    };
    recognizer.start();
    setSeconds(0);
    setState("recording");
  }

  return {
    state,
    error,
    seconds,
    level,
    clearError: () => setError(null),
    toggle: () => (state === "recording" ? stopRef.current?.(true) : void start()),
    // Stops without transcribing.
    cancel: () => stopRef.current?.(false),
  };
}
