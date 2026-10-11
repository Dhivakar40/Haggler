import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { JobDto } from '@haggler/shared';
import { Card, Text } from '../../components';
import { spacing } from '../../theme/tokens';

/** Sub-phase F: "what happened, when" — the job's own status history (JobDto.events), reusing
 * the same plain-language `job.status.*` labels the current-status headline already uses, so a
 * step here and the live status elsewhere never say the same thing two different ways. */
export function JobTimeline({ job }: { job: JobDto }) {
  const { t } = useTranslation();
  if (job.events.length === 0) return null;

  return (
    <Card testID="job-timeline">
      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('job.timelineTitle')}</Text>
        {job.events.map((e, i) => (
          <View
            key={`${e.toStatus}-${e.createdAt}`}
            style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}
          >
            <Text color={i === job.events.length - 1 ? 'text' : 'textMuted'}>•</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text color={i === job.events.length - 1 ? 'text' : 'textMuted'}>
                {t(`job.status.${e.toStatus}`)}
              </Text>
              <Text variant="caption" color="textMuted">
                {new Date(e.createdAt).toLocaleString()}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}
