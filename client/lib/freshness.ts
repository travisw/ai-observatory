/**
 * Pages that already load the freshness stamp hand it to the header, so the header does not open
 * a second subscription for the same number.
 */
import { useEffect, useState } from "preact/hooks";

const EVENT = "observatory:freshness";
let current: string | undefined;

export function provideFreshness(models: string | undefined) {
  if (models === current) return;
  current = models;
  window.dispatchEvent(new Event(EVENT));
}

export function clearFreshness() {
  current = undefined;
}

export function useProvidedFreshness(): string | undefined {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const sync = () => setValue(current);
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return value;
}
