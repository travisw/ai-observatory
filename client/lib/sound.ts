/**
 * The board's click. Synthesised, not a file, and off by default: it only plays once the reader
 * has switched it on and interacted with the page, so a first visit is silent.
 */
import { useEffect, useState } from "preact/hooks";

import { readStorage, writeStorage } from "./util";

const KEY = "observatory.sound";
const EVENT = "observatory:sound";

let enabled = readStorage<boolean>(KEY, false);
let armed = false;
let context: AudioContext | null = null;
let last = 0;

function arm() {
  armed = true;
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", arm, { once: true });
  window.addEventListener("keydown", arm, { once: true });
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSound(on: boolean) {
  enabled = on;
  armed = true;
  writeStorage(KEY, on);
  window.dispatchEvent(new Event(EVENT));
  if (on) click(true);
}

/** One short mechanical tick. Throttled so a whole board flipping sounds like one board, not a hailstorm. */
export function click(force = false) {
  if (!enabled || !armed) return;
  const now = performance.now();
  if (!force && now - last < 28) return;
  last = now;
  try {
    context ??= new AudioContext();
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1400 + Math.random() * 600, t);
    gain.gain.setValueAtTime(0.025, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    osc.connect(gain).connect(context.destination);
    osc.start(t);
    osc.stop(t + 0.025);
  } catch {
    // No audio in this browser or context: the board still flips silently.
  }
}

export function useSound(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    const sync = () => setOn(enabled);
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [on, setSound];
}
