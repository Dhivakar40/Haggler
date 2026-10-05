import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { type KycCheckDto, MAX_WORKER_CATEGORIES } from '@haggler/shared';
import { useCategories } from '../../api/hooks';
import { getKycStatus, getWorkerProfile, updateWorkerProfile } from '../../api/endpoints';
import { Button, Card, Chip, ErrorState, LoadingState, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { spacing } from '../../theme/tokens';

export const KYC_STATUS_KEY = ['kyc-status'];

function TierCard({
  tier,
  check,
  verified,
  locked,
}: {
  tier: 1 | 2;
  check?: KycCheckDto;
  verified: boolean;
  locked: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const status = verified ? 'APPROVED' : (check?.status ?? 'none');
  const open = check && (check.status === 'DRAFT' || check.status === 'NEEDS_INFO');
  const action =
    verified || check?.status === 'PENDING_REVIEW'
      ? null
      : open
        ? t('ranger.continue')
        : check
          ? t('ranger.startAgain')
          : t('ranger.start');

  return (
    <Card testID={`tier-${tier}`}>
      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t(`ranger.tier${tier}`)}</Text>
        <Text color="textMuted">{t(`ranger.tier${tier}Desc`)}</Text>
        <Text
          color={
            verified
              ? 'success'
              : status === 'REJECTED' || status === 'NEEDS_INFO'
                ? 'warning'
                : 'text'
          }
          testID={`tier-${tier}-status`}
        >
          {t(`ranger.status.${status}`)}
        </Text>
        {!verified && check?.reviewerMessage ? (
          <View accessibilityRole="alert">
            <Text variant="label">{t('ranger.messageFromTeam')}</Text>
            <Text testID={`tier-${tier}-message`}>{check.reviewerMessage}</Text>
          </View>
        ) : null}
        {locked ? <Text color="warning">{t('ranger.needTier1')}</Text> : null}
        {action && !locked ? (
          <Button
            testID={`tier-${tier}-action`}
            title={action}
            onPress={() => router.push({ pathname: '/kyc/[tier]', params: { tier: String(tier) } })}
          />
        ) : null}
      </View>
    </Card>
  );
}

export function RangerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: KYC_STATUS_KEY, queryFn: getKycStatus });
  const profile = useQuery({ queryKey: ['worker-profile'], queryFn: getWorkerProfile });
  const categories = useCategories();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (profile.data) setPicked(profile.data.categorySlugs);
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => updateWorkerProfile({ categorySlugs: picked }),
    onSuccess: async () => {
      setError(undefined);
      await qc.invalidateQueries({ queryKey: ['worker-profile'] });
    },
    onError: (err) => setError(errorMessage(err, t)),
  });

  const toggle = (slug: string) =>
    setPicked((cur) =>
      cur.includes(slug)
        ? cur.filter((s) => s !== slug)
        : cur.length < MAX_WORKER_CATEGORIES
          ? [...cur, slug]
          : cur,
    );

  if (status.isLoading || profile.isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (status.isError || !status.data)
    return (
      <Screen>
        <ErrorState onRetry={() => void status.refetch()} />
      </Screen>
    );

  const tier = status.data.tier;
  const latest = (n: number) => status.data.checks.find((c) => c.tier === n);

  return (
    <Screen scroll>
      <Text color="textMuted">{t('ranger.intro')}</Text>
      <Button testID="open-league" variant="secondary" title={t('league.title')} onPress={() => router.push('/league')} />
      <TierCard tier={1} check={latest(1)} verified={tier >= 1} locked={false} />
      <TierCard tier={2} check={latest(2)} verified={tier >= 2} locked={tier < 1} />

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('ranger.categories')}</Text>
        <Text color="textMuted">{t('ranger.categoriesHint')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {categories.data?.map((c) => (
            <Chip
              key={c.slug}
              testID={`cat-${c.slug}`}
              label={t(c.nameKey)}
              selected={picked.includes(c.slug)}
              onPress={() => toggle(c.slug)}
            />
          ))}
        </View>
        {error ? (
          <Text color="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button
          testID="save-categories"
          title={t('ranger.saveCategories')}
          onPress={() => save.mutate()}
          loading={save.isPending}
          disabled={picked.length === 0}
        />
      </View>
    </Screen>
  );
}
