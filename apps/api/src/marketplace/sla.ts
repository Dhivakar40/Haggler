export interface SlaEstimate {
  minutes: number;
  source: 'LOCAL' | 'CATEGORY' | 'DEFAULT';
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/**
 * "Usually accepted in ~N min here" (D3). Uses the median seconds-to-accept of recent jobs:
 * local (same category and PIN cluster) if there are enough, else the whole category, else a default.
 * Rounded UP so we under-promise. Trace: local [120, 300, 180, 240, 600] -> median 240 s -> 4 min.
 */
export function estimateAcceptMinutes(input: {
  localSeconds: number[];
  categorySeconds: number[];
  minSamples: number;
  defaultMinutes: number;
}): SlaEstimate {
  const toMinutes = (secs: number[]) => Math.max(1, Math.ceil(median(secs) / 60));
  if (input.localSeconds.length >= input.minSamples)
    return { minutes: toMinutes(input.localSeconds), source: 'LOCAL' };
  if (input.categorySeconds.length >= input.minSamples)
    return { minutes: toMinutes(input.categorySeconds), source: 'CATEGORY' };
  return { minutes: input.defaultMinutes, source: 'DEFAULT' };
}
