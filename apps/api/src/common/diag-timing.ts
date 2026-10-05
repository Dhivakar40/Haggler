// TEMPORARY — D-078 confirm() latency accounting only. Not part of the product. Removed once the
// diagnosis is complete — see docs/DECISIONS.md. Module-level singleton: safe only because Render
// runs a single process (WEB_CONCURRENCY=1) and this traces one request at a time by design.
const TRIGGER_HEADER = 'x-diag-run';
const TRIGGER_VALUE = 'd078-confirm-trace';

let marks: { label: string; t: number }[] = [];
let active = false;

export function diagShouldTrace(headerValue: string | string[] | undefined): boolean {
  return headerValue === TRIGGER_VALUE;
}

export function diagReset(): void {
  marks = [];
  active = true;
}

export function diagMark(label: string): void {
  if (active) marks.push({ label, t: Date.now() });
}

export function diagStop(): void {
  active = false;
}

export function diagGet(): { label: string; t: number }[] {
  return marks;
}

export { TRIGGER_HEADER };
