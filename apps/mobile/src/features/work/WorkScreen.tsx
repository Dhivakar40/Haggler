import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { IncomingRequest } from '@haggler/shared';
import {
  acceptRequest,
  declineRequest,
  goOffline,
  goOnline,
  useIncoming,
  useJobs,
  usePresence,
} from '../../api/market';
import { useSession } from '../../auth/session';
import { Button, Countdown, EmptyState, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { isActive } from '../../lib/job-status';
import { formatRupees } from '../../lib/money';
import { ensureForegroundPermission } from '../../location/tracker';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';
import { draftDarkColors, draftElevated, draftLightColors } from '../../theme/tokens.draft';

const distanceLabel = (m: number): string =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

/**
 * DRAFT redesign (Part 2 checkpoint): an incoming request is the single most time-pressured
 * surface a Ranger sees — a countdown, real money, a decision in seconds — so it's the clearest
 * case for the elevation policy in tokens.draft.ts: genuinely raised above the page, unlike the
 * flat presence-toggle control below it. Functionally unchanged from the live WorkScreen (same
 * props, same testIDs, same accept/decline calls).
 */
function IncomingCard({
  item,
  onAccept,
  onDecline,
  busy,
}: {
  item: IncomingRequest;
  onAccept: () => void;
  onDecline: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { scheme } = useTheme();
  const c = scheme === 'dark' ? draftDarkColors : draftLightColors;
  return (
    <View
      testID={`incoming-${item.requestId}`}
      style={[
        styles.elevatedCard,
        { backgroundColor: c.surface, borderColor: c.warning },
        draftElevated,
      ]}
    >
      <View style={{ gap: spacing.sm }}>
        <Text variant="heading" style={{ color: c.text }}>
          {t(`categories.${item.categorySlug}`)}
        </Text>
        <Text style={{ color: c.text }}>{item.description}</Text>
        <Text style={{ color: c.textMuted }}>
          {t('work.away', { distance: distanceLabel(item.distanceM) })} · {item.city} {item.pincode}
        </Text>
        <Text testID={`band-${item.requestId}`} style={{ color: c.textMuted }}>
          {formatRupees(item.band.minPaise)} – {formatRupees(item.band.maxPaise)}
        </Text>
        {item.photoCount > 0 || item.hasVoiceNote ? (
          <Text style={{ color: c.textMuted }}>
            {[
              item.photoCount > 0 ? t('work.photos', { count: item.photoCount }) : null,
              item.hasVoiceNote ? t('work.voiceNote') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
        {item.scheduledFor ? (
          <Text style={{ color: c.textMuted }}>
            {t('work.scheduledFor', { when: new Date(item.scheduledFor).toLocaleString() })}
          </Text>
        ) : null}
        <Countdown until={item.deadline} variant="label" testID={`countdown-${item.requestId}`} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            testID={`accept-${item.requestId}`}
            title={t('work.accept')}
            onPress={onAccept}
            loading={busy}
          />
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
  );
}

/** The Ranger's home: go online/offline, see requests as they arrive, accept the one they want. */
export function WorkScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { scheme } = useTheme();
  const c = scheme === 'dark' ? draftDarkColors : draftLightColors;
  const qc = useQueryClient();
  const tier = useSession((s) => s.user?.workerKycTier ?? 0);
  const presence = usePresence(true);
  const online = presence.data?.isOnline === true;
  const incoming = useIncoming(online);
  const jobs = useJobs('WORKER');
  const activeJob = jobs.data?.items.find((j) => isActive(j.status));
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

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
      <Screen>
        <Text variant="title">{t('work.title')}</Text>
        <Text testID="needs-verification" color="warning">
          {t('work.needVerification')}
        </Text>
        <Button
          testID="open-verification"
          title={t('work.verify')}
          onPress={() => router.push('/ranger')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll style={{ backgroundColor: c.background }}>
      <Text variant="title" style={{ color: c.text }}>
        {t('work.title')}
      </Text>
      {/* A flat, bordered control — not elevated. Going online/offline is a standing status, not
          a decision the page is asking the Ranger to make right now, so it stays flat per the
          elevation policy (see IncomingCard below for the contrast). */}
      <View style={[styles.flatCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={{ gap: spacing.sm }}>
          <Text
            variant="heading"
            testID="presence-label"
            style={{ color: online ? c.success : c.textMuted }}
          >
            {online ? t('work.online') : t('work.offline')}
          </Text>
          <Button
            testID="toggle-online"
            variant={online ? 'secondary' : 'primary'}
            title={online ? t('work.goOffline') : t('work.goOnline')}
            onPress={() => void toggle()}
            loading={toggling}
          />
          {online ? (
            <Text variant="caption" style={{ color: c.textMuted }}>
              {t('work.keepOpen')}
            </Text>
          ) : null}
        </View>
      </View>

      {error ? (
        <Text style={{ color: c.danger }} accessibilityRole="alert" testID="work-error">
          {error}
        </Text>
      ) : null}

      {activeJob ? (
        <View
          testID="active-job"
          style={[
            styles.elevatedCard,
            { backgroundColor: c.surface, borderColor: c.primary },
            draftElevated,
          ]}
        >
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading" style={{ color: c.text }}>
              {t('work.activeJob')}
            </Text>
            <Text style={{ color: c.textMuted }}>
              {t(`categories.${activeJob.categorySlug}`)} · {t(`job.status.${activeJob.status}`)}
            </Text>
            <Button
              testID="open-active-job"
              title={t('work.openJob')}
              onPress={() => router.push({ pathname: '/job/[id]', params: { id: activeJob.id } })}
            />
          </View>
        </View>
      ) : null}

      {online && !activeJob ? (
        <View style={{ gap: spacing.md }}>
          <Text variant="heading" style={{ color: c.text }}>
            {t('work.incoming')}
          </Text>
          {incoming.data && incoming.data.length === 0 ? (
            <EmptyState message={t('work.waiting')} />
          ) : null}
          {incoming.data?.map((item) => (
            <IncomingCard
              key={item.requestId}
              item={item}
              busy={busyId === item.requestId}
              onAccept={() => void accept(item)}
              onDecline={() => void decline(item)}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flatCard: { borderRadius: 12, borderWidth: 1, padding: spacing.lg },
  elevatedCard: { borderRadius: 12, borderWidth: 1, padding: spacing.lg },
});
