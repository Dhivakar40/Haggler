import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { OTHER_CATEGORY_SLUG, type IncomingRequest } from '@haggler/shared';
import {
  acceptRequest,
  declineRequest,
  goOffline,
  goOnline,
  sendQuote,
  useIncoming,
  useJobs,
  usePresence,
} from '../../api/market';
import { useSession } from '../../auth/session';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Countdown,
  EmptyState,
  Screen,
  Skeleton,
  Text,
  TextField,
} from '../../components';
import { errorMessage } from '../../lib/errors';
import { isActive } from '../../lib/job-status';
import { firstName } from '../../lib/name';
import { formatRupees, parseRupeesToPaise } from '../../lib/money';
import { ensureForegroundPermission } from '../../location/tracker';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

type DashboardTab = 'new' | 'ongoing' | 'completed';

const distanceLabel = (m: number): string =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

function IncomingCard({
  item,
  onAccept,
  onDecline,
  onQuote,
  busy,
}: {
  item: IncomingRequest;
  onAccept: () => void;
  onDecline: () => void;
  onQuote: (amountPaise: number) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isOther = item.categorySlug === OTHER_CATEGORY_SLUG;
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteInvalid, setQuoteInvalid] = useState(false);

  function submitQuote() {
    const paise = parseRupeesToPaise(quoteAmount);
    if (paise === null || paise < 100) return setQuoteInvalid(true);
    setQuoteInvalid(false);
    onQuote(paise);
  }

  const attachments = [
    item.photoCount > 0 ? t('work.photos', { count: item.photoCount }) : null,
    item.hasVoiceNote ? t('work.voiceNote') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card testID={`incoming-${item.requestId}`} elevated style={styles.incomingCard}>
      <View style={styles.incomingContent}>
        <View style={styles.incomingHeader}>
          <View style={[styles.categoryIcon, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons
              name="construct-outline"
              size={25}
              color={colors.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </View>
          <View style={styles.incomingTitle}>
            <Text variant="heading">{t(`categories.${item.categorySlug}`)}</Text>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={16} color={colors.textMuted} />
              <Text variant="caption" color="textMuted" style={styles.flexText}>
                {t('work.away', { distance: distanceLabel(item.distanceM) })}
              </Text>
            </View>
            <Text variant="caption" color="textMuted">
              {item.city} {item.pincode}
            </Text>
          </View>
        </View>

        <Text>{item.description}</Text>

        <View style={[styles.pricePanel, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="cash-outline" size={20} color={colors.primary} />
          <View style={styles.priceDetails}>
            {isOther ? (
              <Text testID={`band-${item.requestId}`} variant="caption" color="textMuted">
                {t('work.noPriceGuide')}
              </Text>
            ) : (
              <>
                <Text testID={`band-${item.requestId}`} variant="heading">
                  {formatRupees(item.listedPricePaise ?? 0)}
                </Text>
                {item.isInspectionCharge ? (
                  <Text variant="caption" color="textMuted">
                    {t('work.inspectionCharge')}
                  </Text>
                ) : null}
                <Text variant="caption" color="textMuted">
                  {t('work.budgetRange', {
                    min: formatRupees(item.band.minPaise),
                    max: formatRupees(item.band.maxPaise),
                  })}
                </Text>
              </>
            )}
          </View>
        </View>

        {attachments ? (
          <View style={styles.infoRow}>
            <Ionicons name="attach-outline" size={17} color={colors.textMuted} />
            <Text variant="caption" color="textMuted">
              {attachments}
            </Text>
          </View>
        ) : null}

        {item.scheduledFor ? (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={17} color={colors.textMuted} />
            <Text variant="caption" color="textMuted" style={styles.flexText}>
              {t('work.scheduledFor', { when: new Date(item.scheduledFor).toLocaleString() })}
            </Text>
          </View>
        ) : null}

        <View style={[styles.deadlinePanel, { borderColor: colors.border }]}>
          <Ionicons name="time-outline" size={18} color={colors.warning} />
          <Countdown until={item.deadline} variant="label" testID={`countdown-${item.requestId}`} />
        </View>

        {isOther ? (
          <View style={styles.actionSection}>
            <TextField
              testID={`quote-amount-${item.requestId}`}
              label={t('work.yourQuote')}
              value={quoteAmount}
              onChangeText={setQuoteAmount}
              keyboardType="decimal-pad"
              maxLength={9}
              prefix="₹"
              error={quoteInvalid ? t('job.invalidAmount') : undefined}
            />
            <View style={styles.actionRow}>
              <View style={styles.actionButton}>
                <Button
                  testID={`send-quote-${item.requestId}`}
                  title={t('work.sendQuote')}
                  onPress={submitQuote}
                  loading={busy}
                />
              </View>
              <View style={styles.actionButton}>
                <Button
                  testID={`decline-${item.requestId}`}
                  variant="secondary"
                  title={t('work.decline')}
                  onPress={onDecline}
                  disabled={busy}
                />
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.actionRow}>
            <View style={styles.actionButton}>
              <Button
                testID={`accept-${item.requestId}`}
                title={t('work.accept')}
                onPress={onAccept}
                loading={busy}
              />
            </View>
            <View style={styles.actionButton}>
              <Button
                testID={`decline-${item.requestId}`}
                variant="secondary"
                title={t('work.decline')}
                onPress={onDecline}
                disabled={busy}
              />
            </View>
          </View>
        )}
      </View>
    </Card>
  );
}

/** The Ranger's home: go online/offline, see requests as they arrive, accept the one they want. */
export function WorkScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const tier = useSession((s) => s.user?.workerKycTier ?? 0);
  const name = useSession((s) => firstName(s.user?.fullName));
  const avatarName = useSession((s) => s.user?.fullName ?? null);
  const photoUrl = useSession((s) => s.user?.photoUrl ?? null);
  const refreshMe = useSession((s) => s.refreshMe);
  // KYC approval happens on the admin side, asynchronously — the session's cached
  // workerKycTier only updates when we ask, so ask every time this tab gains focus (e.g. a
  // Ranger who just got approved and switches back to the app sees it without signing out).
  useFocusEffect(
    useCallback(() => {
      void refreshMe();
    }, [refreshMe]),
  );
  const presence = usePresence(true);
  const online = presence.data?.isOnline === true;
  const incoming = useIncoming(online);
  const jobs = useJobs('WORKER');
  const activeJob = jobs.data?.items.find((j) => isActive(j.status));
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  // D-078 Part G: lets a Ranger see just the "Other" requests, or everything (the default).
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | typeof OTHER_CATEGORY_SLUG>('ALL');
  const visibleIncoming = incoming.data?.filter(
    (item) => categoryFilter === 'ALL' || item.categorySlug === categoryFilter,
  );

  // D-115: the dashboard tabs below are purely a second way to browse jobs already fetched by
  // `jobs` (useJobs('WORKER')) — the "new" tab's content is untouched from before this tab bar
  // existed (same activeJob/incoming blocks, same conditions), so none of the existing behaviour
  // around it (e.g. an active job hiding new requests) changes just because tabs were added.
  const [tab, setTab] = useState<DashboardTab>('new');
  const allJobs = jobs.data?.items ?? [];
  const ongoingJobs = allJobs.filter((j) => isActive(j.status));
  const completedJobs = allJobs.filter((j) => j.status === 'CONFIRMED_BY_CUSTOMER');
  const cancelledCount = allJobs.filter((j) => j.status === 'CANCELLED').length;

  async function toggle() {
    setError(undefined);
    setToggling(true);
    try {
      if (online) {
        await goOffline();
      } else {
        if (!(await ensureForegroundPermission())) return setError(t('work.gpsNeeded'));
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        await goOnline(pos.coords.latitude, pos.coords.longitude);
      }
      await qc.invalidateQueries({ queryKey: ['presence'] });
      await qc.invalidateQueries({ queryKey: ['incoming'] });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setToggling(false);
    }
  }

  async function accept(item: IncomingRequest) {
    setError(undefined);
    setBusyId(item.requestId);
    try {
      const res = await acceptRequest(item.requestId);
      await qc.invalidateQueries({ queryKey: ['incoming'] });
      await qc.invalidateQueries({ queryKey: ['jobs'] });
      router.push({ pathname: '/job/[id]', params: { id: res.jobId } });
    } catch (err) {
      setError(errorMessage(err, t)); // e.g. "That request was already taken."
      await qc.invalidateQueries({ queryKey: ['incoming'] });
    } finally {
      setBusyId(null);
    }
  }

  async function quote(item: IncomingRequest, amountPaise: number) {
    setError(undefined);
    setBusyId(item.requestId);
    try {
      await sendQuote(item.jobId, { amountPaise });
      await qc.invalidateQueries({ queryKey: ['incoming'] });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusyId(null);
    }
  }

  async function decline(item: IncomingRequest) {
    setBusyId(item.requestId);
    try {
      await declineRequest(item.requestId);
    } catch {
      /* it will disappear on refresh anyway */
    } finally {
      await qc.invalidateQueries({ queryKey: ['incoming'] });
      setBusyId(null);
    }
  }

  if (tier < 2) {
    return (
      <Screen scroll>
        <View style={styles.screenHeader}>
          <View style={[styles.headerIcon, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="briefcase-outline" size={25} color={colors.primary} />
          </View>
          <View style={styles.headerText}>
            <Text variant="title">{t('work.title')}</Text>
          </View>
        </View>

        <Card style={styles.verificationCard}>
          <View style={styles.verificationContent}>
            <View style={[styles.verificationIcon, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="shield-checkmark-outline" size={34} color={colors.warning} />
            </View>
            <Text testID="needs-verification" variant="heading" color="warning">
              {t('work.needVerification')}
            </Text>
            <Button
              testID="open-verification"
              title={t('work.verify')}
              onPress={() => router.push('/ranger')}
            />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.topBar}>
        <Text variant="heading" color="primary">
          {t('app.name')}
        </Text>
        <View style={styles.topBarActions}>
          <Pressable
            testID="work-notifications"
            accessibilityRole="button"
            accessibilityLabel={t('settings.notifications')}
            onPress={() => router.push('/settings')}
            style={[styles.iconButton, { backgroundColor: colors.surfaceAlt }]}
            hitSlop={8}
          >
            <Ionicons name="notifications-outline" size={20} color={colors.text} />
          </Pressable>
          <Pressable
            testID="work-account"
            accessibilityRole="button"
            accessibilityLabel={t('account.title')}
            onPress={() => router.push('/account')}
            hitSlop={8}
          >
            <Avatar name={avatarName} photoUrl={photoUrl} size={36} />
          </Pressable>
        </View>
      </View>

      <View style={styles.screenHeader}>
        <View style={[styles.headerIcon, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="briefcase-outline" size={25} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text variant="title">{t('work.dashboardTitle')}</Text>
          <Text color="textMuted">
            {name ? t('work.titleNamed', { name }) : t('work.title')}
          </Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statTile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.statIcon, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="clipboard-outline" size={20} color={colors.primary} />
          </View>
          <Text variant="heading">{allJobs.length}</Text>
          <Text variant="caption" color="textMuted">
            {t('work.statTotal')}
          </Text>
        </View>
        <View style={[styles.statTile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.statIcon, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="time-outline" size={20} color={colors.warning} />
          </View>
          <Text variant="heading">{ongoingJobs.length}</Text>
          <Text variant="caption" color="textMuted">
            {t('work.statOngoing')}
          </Text>
        </View>
        <View style={[styles.statTile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.statIcon, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
          </View>
          <Text variant="heading">{completedJobs.length}</Text>
          <Text variant="caption" color="textMuted">
            {t('work.statCompleted')}
          </Text>
        </View>
        <View style={[styles.statTile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.statIcon, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="close-circle-outline" size={20} color={colors.danger} />
          </View>
          <Text variant="heading">{cancelledCount}</Text>
          <Text variant="caption" color="textMuted">
            {t('work.statCancelled')}
          </Text>
        </View>
      </View>

      <Card style={styles.presenceCard}>
        <View style={styles.presenceContent}>
          <View style={styles.presenceHeader}>
            <View style={styles.presenceLabel}>
              <View
                style={[
                  styles.presenceDot,
                  { backgroundColor: online ? colors.success : colors.textMuted },
                ]}
              />
              <Text variant="heading" color={online ? 'success' : 'text'} testID="presence-label">
                {online ? t('work.online') : t('work.offline')}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons
                name={online ? 'radio-outline' : 'moon-outline'}
                size={16}
                color={online ? colors.success : colors.textMuted}
              />
              <Text variant="caption" color="textMuted">
                {online ? t('work.online') : t('work.offline')}
              </Text>
            </View>
          </View>

          <Button
            testID="toggle-online"
            variant={online ? 'secondary' : 'primary'}
            title={online ? t('work.goOffline') : t('work.goOnline')}
            onPress={() => void toggle()}
            loading={toggling}
          />

          {online ? (
            <Text variant="caption" color="textMuted">
              {t('work.keepOpen')}
            </Text>
          ) : null}
        </View>
      </Card>

      {error ? (
        <Card style={styles.errorCard}>
          <View style={styles.infoRow}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            <Text
              color="danger"
              accessibilityRole="alert"
              testID="work-error"
              style={styles.flexText}
            >
              {error}
            </Text>
          </View>
        </Card>
      ) : null}

      <View style={styles.tabRow}>
        <Pressable
          testID="dashboard-tab-new"
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'new' }}
          onPress={() => setTab('new')}
          style={[styles.tab, tab === 'new' && { backgroundColor: colors.primary }]}
        >
          {incoming.data && incoming.data.length > 0 ? (
            <View style={[styles.tabBadge, { backgroundColor: colors.danger }]}>
              <Text variant="caption" style={{ color: colors.onDanger }}>
                {incoming.data.length}
              </Text>
            </View>
          ) : null}
          <Text
            variant="label"
            style={{ color: tab === 'new' ? colors.onPrimary : colors.text }}
            numberOfLines={1}
          >
            {t('work.incoming')}
          </Text>
        </Pressable>
        <Pressable
          testID="dashboard-tab-ongoing"
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'ongoing' }}
          onPress={() => setTab('ongoing')}
          style={[styles.tab, tab === 'ongoing' && { backgroundColor: colors.primary }]}
        >
          <Text style={{ color: tab === 'ongoing' ? colors.onPrimary : colors.text }}>
            {t('work.statOngoing')} {ongoingJobs.length}
          </Text>
        </Pressable>
        <Pressable
          testID="dashboard-tab-completed"
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'completed' }}
          onPress={() => setTab('completed')}
          style={[styles.tab, tab === 'completed' && { backgroundColor: colors.primary }]}
        >
          <Text style={{ color: tab === 'completed' ? colors.onPrimary : colors.text }}>
            {t('work.statCompleted')} {completedJobs.length}
          </Text>
        </Pressable>
      </View>

      {tab === 'new' ? (
        <>
          {activeJob ? (
            <Card testID="active-job" elevated style={styles.activeJobCard}>
              <View style={styles.activeJobContent}>
                <View style={styles.sectionHeadingRow}>
                  <View style={[styles.smallIcon, { backgroundColor: colors.surfaceAlt }]}>
                    <Ionicons name="construct-outline" size={22} color={colors.primary} />
                  </View>
                  <View style={styles.headerText}>
                    <Text variant="heading">{t('work.activeJob')}</Text>
                    <Text variant="caption" color="textMuted">
                      {t(`categories.${activeJob.categorySlug}`)} ·{' '}
                      {t(`job.status.${activeJob.status}`)}
                    </Text>
                  </View>
                </View>
                <Button
                  testID="open-active-job"
                  title={t('work.openJob')}
                  onPress={() =>
                    router.push({ pathname: '/job/[id]', params: { id: activeJob.id } })
                  }
                />
              </View>
            </Card>
          ) : null}

          {online && !activeJob ? (
            <View style={styles.incomingSection} testID="incoming-section">
              <View style={styles.sectionHeadingRow}>
                <View style={styles.headerText}>
                  <Text variant="heading">{t('work.incoming')}</Text>
                  <Text variant="caption" color="textMuted">
                    {incoming.data?.length ?? 0}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: colors.surfaceAlt }]}>
                  <View style={[styles.presenceDot, { backgroundColor: colors.success }]} />
                  <Text variant="caption" color="success">
                    {t('work.online')}
                  </Text>
                </View>
              </View>

              {incoming.data && incoming.data.length > 0 ? (
                <View style={styles.filterRow}>
                  <Chip
                    testID="filter-all"
                    label={t('work.filterAll')}
                    selected={categoryFilter === 'ALL'}
                    onPress={() => setCategoryFilter('ALL')}
                  />
                  <Chip
                    testID="filter-other"
                    label={t('work.filterOther')}
                    selected={categoryFilter === OTHER_CATEGORY_SLUG}
                    onPress={() => setCategoryFilter(OTHER_CATEGORY_SLUG)}
                  />
                </View>
              ) : null}

              {incoming.isLoading ? (
                <View testID="incoming-skeleton" style={styles.loadingList}>
                  {[0, 1].map((i) => (
                    <Card key={i} elevated>
                      <View style={styles.loadingContent}>
                        <Skeleton width="50%" height={20} />
                        <Skeleton width="90%" height={16} />
                        <Skeleton width="40%" height={14} />
                      </View>
                    </Card>
                  ))}
                </View>
              ) : null}

              {incoming.data && incoming.data.length === 0 ? (
                <EmptyState message={t('work.waiting')} />
              ) : null}

              {visibleIncoming?.map((item) => (
                <IncomingCard
                  key={item.requestId}
                  item={item}
                  busy={busyId === item.requestId}
                  onAccept={() => void accept(item)}
                  onDecline={() => void decline(item)}
                  onQuote={(amountPaise) => void quote(item, amountPaise)}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {tab === 'ongoing' ? (
        <View style={styles.incomingSection} testID="dashboard-ongoing-list">
          {ongoingJobs.length === 0 ? (
            <EmptyState />
          ) : (
            ongoingJobs.map((job) => (
              <Card
                key={job.id}
                testID={`ongoing-job-${job.id}`}
                onPress={() => router.push({ pathname: '/job/[id]', params: { id: job.id } })}
              >
                <View style={styles.sectionHeadingRow}>
                  <View style={[styles.smallIcon, { backgroundColor: colors.surfaceAlt }]}>
                    <Ionicons name="construct-outline" size={22} color={colors.primary} />
                  </View>
                  <View style={styles.headerText}>
                    <Text variant="heading">{t(`categories.${job.categorySlug}`)}</Text>
                    <Text variant="caption" color="textMuted">
                      {t(`job.status.${job.status}`)}
                    </Text>
                  </View>
                </View>
              </Card>
            ))
          )}
        </View>
      ) : null}

      {tab === 'completed' ? (
        <View style={styles.incomingSection} testID="dashboard-completed-list">
          {completedJobs.length === 0 ? (
            <EmptyState />
          ) : (
            completedJobs.map((job) => (
              <Card
                key={job.id}
                testID={`completed-job-${job.id}`}
                onPress={() => router.push({ pathname: '/job/[id]', params: { id: job.id } })}
              >
                <View style={styles.sectionHeadingRow}>
                  <View style={[styles.smallIcon, { backgroundColor: colors.surfaceAlt }]}>
                    <Ionicons name="checkmark-circle-outline" size={22} color={colors.success} />
                  </View>
                  <View style={styles.headerText}>
                    <Text variant="heading">{t(`categories.${job.categorySlug}`)}</Text>
                    {job.agreedPricePaise !== null ? (
                      <Text variant="caption" color="textMuted">
                        {formatRupees(job.agreedPricePaise)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Card>
            ))
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenHeader: {
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
  headerText: { flex: 1, gap: spacing.xs },
  verificationCard: {
    borderRadius: radii.lg,
    padding: spacing.xl,
  },
  verificationContent: {
    alignItems: 'center',
    gap: spacing.md,
  },
  verificationIcon: {
    width: 76,
    height: 76,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceCard: { borderRadius: radii.lg },
  presenceContent: { gap: spacing.md },
  presenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  presenceLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  presenceDot: {
    width: 9,
    height: 9,
    borderRadius: radii.pill,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  errorCard: { borderColor: '#B3261E' },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flexText: { flex: 1 },
  activeJobCard: { borderRadius: radii.lg },
  activeJobContent: { gap: spacing.md },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  smallIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  incomingSection: { gap: spacing.md },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  loadingList: { gap: spacing.md },
  loadingContent: { gap: spacing.md },
  incomingCard: { borderRadius: radii.lg },
  incomingContent: { gap: spacing.md },
  incomingHeader: {
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
  incomingTitle: { flex: 1, gap: spacing.xs },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pricePanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  priceDetails: { flex: 1, gap: spacing.xs },
  deadlinePanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  actionSection: { gap: spacing.md },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionButton: { flex: 1, minWidth: 130 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  topBarActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  statTile: {
    width: '23.5%',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
  },
  tabBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
});
