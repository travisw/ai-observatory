import { Dialog, Kbd } from "@spacefast/zero/kit";

const ROWS: [string[], string][] = [
  [["⌘", "K"], "Find a model, provider or page"],
  [["/"], "Same as ⌘K"],
  [["j"], "Next change in a list"],
  [["k"], "Previous change in a list"],
  [["↵"], "Open the highlighted change"],
  [["g", "c"], "Go to Changes"],
  [["g", "m"], "Go to Models"],
  [["g", "s"], "Go to Status"],
  [["?"], "This sheet"],
];

export function ShortcutSheet(props: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Keyboard shortcuts">
      <ul class="flex flex-col gap-2 text-sm">
        {ROWS.map(([keys, what]) => (
          <li key={what} class="flex items-center justify-between gap-4">
            <span class="text-ink">{what}</span>
            <span class="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
