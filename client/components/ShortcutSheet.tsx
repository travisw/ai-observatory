/**
 * The keyboard sheet: a small black board with amber rules.
 */
import { useEffect } from "preact/hooks";
import { Kbd } from "@spacefast/zero/kit";

import { Sign } from "./Flap";

const ROWS: [string[], string][] = [
  [["⌘", "K"], "Find a model, provider or page"],
  [["/"], "Same as ⌘K"],
  [["j"], "Next row in a board or log"],
  [["k"], "Previous row"],
  [["↵"], "Open the highlighted row"],
  [["g", "c"], "Go to the hall"],
  [["g", "m"], "Go to Models"],
  [["g", "s"], "Go to Status"],
  [["?"], "This sheet"],
];

export function ShortcutSheet(props: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return (
    <div class="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[12vh]" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="w-full max-w-md overflow-hidden rounded-md border border-line bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.7)]" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <header class="flex items-center justify-between border-b border-line bg-flap px-3 py-2">
          <h2 class="text-sm font-bold uppercase tracking-[0.4em] text-accent [text-shadow:0_0_14px_rgba(255,176,0,0.45)]">Keyboard</h2>
          <Sign onClick={props.onClose} ariaLabel="Close">Close</Sign>
        </header>
        <ul class="flex flex-col px-3 py-2">
          {ROWS.map(([keys, what]) => (
            <li key={what} class="flex items-center justify-between gap-4 border-b border-dotted border-line py-2 text-sm last:border-0">
              <span class="text-ink">{what}</span>
              <span class="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
