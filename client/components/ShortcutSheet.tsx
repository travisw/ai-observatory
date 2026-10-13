/**
 * The keyboard sheet: a small dialog listing the shortcuts.
 */
import { useEffect } from "preact/hooks";

import { Chip } from "./Wire";

const ROWS: [string[], string][] = [
  [["⌘", "K"], "Find a model, provider or page"],
  [["/"], "Same as ⌘K"],
  [["j"], "Next row in a table"],
  [["k"], "Previous row"],
  [["↵"], "Open the highlighted row"],
  [["g", "h"], "Go to today"],
  [["g", "c"], "Go to changes"],
  [["g", "m"], "Go to models"],
  [["g", "s"], "Go to status"],
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
    <div class="dialog" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" style={{ maxWidth: 440 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #2c2d29" }}>
          <h2 style={{ margin: 0 }}>Keyboard</h2>
          <Chip onClick={props.onClose} ariaLabel="Close">Close</Chip>
        </div>
        <div style={{ padding: "4px 14px 10px", overflow: "auto" }}>
          <table aria-label="Shortcuts">
            <tbody>
              {ROWS.map(([keys, what]) => (
                <tr key={what}>
                  <td>{what}</td>
                  <td class="n">{keys.map((k, i) => <span key={k}>{i ? " " : ""}<kbd>{k}</kbd></span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
