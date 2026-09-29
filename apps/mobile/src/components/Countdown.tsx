import { formatCountdown, secondsUntil } from '../lib/job-status';
import { useNow } from '../lib/useNow';
import type { TextProps } from './Text';
import { Text } from './Text';

/** Ticking "m:ss" until an ISO timestamp. Announced politely, not on every tick. */
export function Countdown({
  until,
  testID,
  ...rest
}: { until: string | null } & Omit<TextProps, 'children'>) {
  const now = useNow(1000);
  return (
    <Text testID={testID} accessibilityLiveRegion="none" {...rest}>
      {formatCountdown(secondsUntil(until, now))}
    </Text>
  );
}
