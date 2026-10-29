import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useJobs } from '../../api/market';
import { useSession } from '../../auth/session';
import { Card, Chip, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { formatRupees } from '../../lib/money';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

function getStatusColor(status: string, colors: ReturnType<typeof useTheme>['colors']) {
  const normalized = status.toUpperCase();
  if (normalized.includes('COMPLET')) return colors.success;
  if (
    normalized.includes('CANCEL') ||
    normalized.includes('DECLIN') ||
    normalized.includes('REJECT')
  ) {
    return colors.danger;
  }
  if (
    normalized.includes('PENDING') ||
    normalized.includes('QUOTE') ||
    normalized.includes('WAIT')
  ) {
    return colors.warning;
  }
  return colors.primary;
}

/** My requests as a customer, and (for Rangers) my jobs. Tapping one opens it. */
export function ActivityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const isRanger = useSession((s) => s.user?.roles.includes('WORKER') ?? false);
  const [role, setRole] = useState<'CUSTOMER' | 'WORKER'>('CUSTOMER');
  const { data, isLoading, isError, error, refetch } = useJobs(role);

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="time-outline" size={25} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text variant="title">{t('activity.title')}</Text>
        </View>
      </View>

      {isRanger ? (
        <View style={styles.roleSection}>
          <Text variant="caption" color="textMuted">
            {t('activity.title')}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.roleSelector}>
            <Chip
              testID="role-customer"
              label={t('activity.asCustomer')}
              selected={role === 'CUSTOMER'}
              onPress={() => setRole('CUSTOMER')}
            />
            <Chip
              testID="role-ranger"
              label={t('activity.asRanger')}
              selected={role === 'WORKER'}
              onPress={() => setRole('WORKER')}
            />
          </View>
        </View>
      ) : null}

      {isLoading && <LoadingState />}

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {data?.items.length === 0 && <EmptyState message={t('activity.empty')} />}

      {data?.items.map((job) => {
        const statusColor = getStatusColor(job.status, colors);
        return (
          <Card
            key={job.id}
            testID={`job-${job.id}`}
            accessibilityLabel={t(`categories.${job.categorySlug}`)}
            onPress={() => router.push({ pathname: '/job/[id]', params: { id: job.id } })}
            style={styles.jobCard}
          >
            <View style={styles.jobContent}>
              <View style={[styles.categoryIcon, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons
                  name="construct-outline"
                  size={25}
                  color={colors.primary}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              </View>

              <View style={styles.jobDetails}>
                <View style={styles.titleRow}>
                  <Text variant="heading" style={styles.categoryTitle} numberOfLines={2}>
                    {t(`categories.${job.categorySlug}`)}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={19}
                    color={colors.textMuted}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                </View>

                {job.description ? (
                  <Text color="textMuted" numberOfLines={3} style={styles.description}>
                    {job.description}
                  </Text>
                ) : null}

                <View style={styles.metadataRow}>
                  <View style={[styles.statusBadge, { backgroundColor: colors.surfaceAlt }]}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                    <Text variant="caption" style={{ color: statusColor }}>
                      {t(`job.status.${job.status}`)}
                    </Text>
                  </View>

                  {job.agreedPricePaise != null ? (
                    <Text variant="label" style={styles.price}>
                      {formatRupees(job.agreedPricePaise)}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  roleSection: { gap: spacing.sm },
  roleSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  jobCard: {
    padding: spacing.md,
    borderRadius: radii.lg,
  },
  jobContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobDetails: { flex: 1, gap: spacing.sm },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  categoryTitle: { flex: 1, lineHeight: 24 },
  description: { lineHeight: 20 },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
  },
  price: { flexShrink: 0 },
});
