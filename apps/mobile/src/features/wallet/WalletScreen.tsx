import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { PaymentOrderStartDto, PlusPlanDto, TokenBundleDto } from '@haggler/shared';
import {
  createTopupOrder,
  sandboxPay,
  subscribePlus,
  useBundles,
  useOrders,
  usePlusMembership,
  usePlusPlans,
  useWallet,
  walletKey,
} from '../../api/wallet';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PriceTag,
  Screen,
  Skeleton,
  StatusPill,
  Text,
} from '../../components';
import type { StatusTone } from '../../components';
import { errorMessage } from '../../lib/errors';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

const ORDER_STATUS_TONE: Record<string, StatusTone> = {
  PAID: 'positive',
  FAILED: 'negative',
  CANCELLED: 'negative',
};

/** Buy tokens or subscribe to Plus -> a payment order -> pay -> the relevant query refetches.
 * One order in flight at a time (D-069: Plus + rush + boost all share this same checkout flow). */
export function WalletScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const wallet = useWallet();
  const bundles = useBundles();
  const orders = useOrders();
  const membership = usePlusMembership();
  const plans = usePlusPlans('CUSTOMER');
  const [order, setOrder] = useState<PaymentOrderStartDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  async function buy(bundle: TokenBundleDto) {
    setError(undefined);
    setBusy(bundle.id);
    try {
      const o = await createTopupOrder({ bundleId: bundle.id });
      setOrder(o);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function subscribe(plan: PlusPlanDto) {
    setError(undefined);
    setBusy(plan.id);
    try {
      const o = await subscribePlus({ planId: plan.id });
      setOrder(o);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function paySandbox() {
    if (!order) return;
    setBusy('pay');
    setError(undefined);
    try {
      await sandboxPay(order.orderId);
      setOrder(null);
      await qc.invalidateQueries({ queryKey: walletKey });
      await qc.invalidateQueries({ queryKey: ['wallet', 'orders'] });
      await qc.invalidateQueries({ queryKey: ['plus', 'membership'] });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  if (wallet.isLoading || bundles.isLoading)
    return (
      <Screen>
        <View testID="wallet-skeleton" style={{ gap: spacing.lg }}>
          <Card>
            <View style={{ gap: spacing.sm, alignItems: 'center' }}>
              <Skeleton width="50%" height={16} />
              <Skeleton width="40%" height={48} />
            </View>
          </Card>
          <Card>
            <Skeleton width="70%" height={20} />
          </Card>
          <Card>
            <Skeleton width="70%" height={20} />
          </Card>
        </View>
      </Screen>
    );
  if (wallet.isError || !wallet.data)
    return (
      <Screen>
        <ErrorState onRetry={() => void wallet.refetch()} />
      </Screen>
    );

  return (
    <Screen scroll>
      <Text variant="title">{t('wallet.title')}</Text>

      <Card testID="wallet-balance">
        <View style={{ gap: spacing.xs, alignItems: 'center' }}>
          <Text color="textMuted">{t('wallet.balanceLabel')}</Text>
          <Text variant="display" testID="balance-tokens">
            {t('wallet.tokenCount', { count: wallet.data.balanceTokens })}
          </Text>
          {wallet.data.heldTokens > 0 ? (
            <Text testID="held-tokens" color="textMuted">
              {t('wallet.held', { count: wallet.data.heldTokens })}
            </Text>
          ) : null}
        </View>
      </Card>

      {order ? (
        // Elevated: a payment awaiting confirmation is the most consequential moment on this
        // screen. Balance, plans and history below are informational and stay flat.
        <Card testID="checkout" elevated>
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading">{t('wallet.checkoutTitle')}</Text>
            <Text>
              {order.purpose === 'PLUS_SUBSCRIPTION'
                ? t('wallet.checkoutSummaryPlus', { amount: formatRupees(order.amountPaise) })
                : t('wallet.checkoutSummary', {
                    tokens: order.tokens ?? 0,
                    amount: formatRupees(order.amountPaise),
                  })}
            </Text>
            {order.provider === 'sandbox' ? (
              <>
                <Text color="textMuted">{t('wallet.sandboxNote')}</Text>
                <Button
                  testID="sandbox-pay"
                  title={t('wallet.payNow')}
                  loading={busy === 'pay'}
                  onPress={() => void paySandbox()}
                />
              </>
            ) : (
              <Text testID="razorpay-pending" color="textMuted">
                {t('wallet.razorpayPending')}
              </Text>
            )}
            <Button
              variant="secondary"
              title={t('common.cancel')}
              onPress={() => setOrder(null)}
              disabled={busy === 'pay'}
            />
          </View>
        </Card>
      ) : null}

      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('wallet.plusTitle')}</Text>
        {membership.data?.active ? (
          <Card testID="plus-active">
            <Text>{t('wallet.plusActive', { name: membership.data.planName })}</Text>
            <Text color="textMuted">
              {t('wallet.plusExpires', {
                date: new Date(membership.data.expiresAt).toLocaleDateString(),
              })}
            </Text>
          </Card>
        ) : (
          (plans.data ?? []).map((p) => (
            <Card key={p.id} testID={`plus-plan-${p.slug}`}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: spacing.sm,
                }}
              >
                <View style={{ gap: spacing.xs }}>
                  <Text variant="heading">{p.name}</Text>
                  <Text color="textMuted">
                    {t('wallet.plusPrice', {
                      amount: formatRupees(p.pricePaise),
                      days: p.durationDays,
                    })}
                  </Text>
                </View>
                <Button
                  testID={`subscribe-${p.slug}`}
                  title={t('wallet.subscribe')}
                  loading={busy === p.id}
                  onPress={() => void subscribe(p)}
                />
              </View>
            </Card>
          ))
        )}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('wallet.buyTokens')}</Text>
        {(bundles.data ?? []).map((b) => (
          <Card key={b.id} testID={`bundle-${b.slug}`}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              <View style={{ gap: spacing.xs }}>
                <Text variant="heading">{t('wallet.tokenCount', { count: b.tokens })}</Text>
                <PriceTag paise={b.pricePaise} variant="muted" />
              </View>
              <Button
                testID={`buy-${b.slug}`}
                title={t('wallet.buy')}
                loading={busy === b.id}
                onPress={() => void buy(b)}
              />
            </View>
          </Card>
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('wallet.history')}</Text>
        {orders.isLoading ? (
          <View testID="orders-skeleton" style={{ gap: spacing.sm }}>
            {[0, 1].map((i) => (
              <Card key={i}>
                <View style={{ gap: spacing.xs }}>
                  <Skeleton width="60%" height={16} />
                  <Skeleton width="30%" height={14} />
                </View>
              </Card>
            ))}
          </View>
        ) : null}
        {orders.data?.items.length === 0 ? <EmptyState message={t('wallet.noOrders')} /> : null}
        {orders.data?.items.map((o) => (
          <Card key={o.id} testID={`order-${o.id}`}>
            <View style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text>{o.itemName}</Text>
                <StatusPill
                  label={t(`wallet.orderStatus.${o.status}`)}
                  tone={ORDER_STATUS_TONE[o.status] ?? 'neutral'}
                />
              </View>
              <PriceTag paise={o.amountPaise} variant="muted" />
            </View>
          </Card>
        ))}
      </View>

      <Button variant="secondary" title={t('common.back')} onPress={() => router.back()} />
    </Screen>
  );
}
