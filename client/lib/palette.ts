import type { PaletteMode } from "../components/Palette";

/** Pages ask the shell to open the palette (for example, in "pick a model" mode) through one event. */
export const PALETTE_EVENT = "observatory:palette";

export function openPalette(mode: PaletteMode = { kind: "navigate" }) {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: mode }));
}
