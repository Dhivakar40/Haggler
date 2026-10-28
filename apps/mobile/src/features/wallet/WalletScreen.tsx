import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { PaymentOrderStartDto, PlusPlanDto } from '@haggler/shared';
import {
  sandboxPay,
  subscribePlus,
  useOrders,
  usePlusMembership,
  usePlusPlans,
} from '../../api/wallet';
import { Button, Card, EmptyState, ErrorState, PriceTag, Screen, Skeleton, StatusPill, Text } from '../../components';
import type { StatusTone } from '../../components';
import { errorMessage } from '../../lib/errors';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

const ORDER_STATUS_TONE: Record<string, StatusTone> = {
  PAID: 'positive',
  FAILED: 'negative',
  CANCELLED: 'negative',
};

/** D-106: the token balance/top-up UI is gone — tokens stopped being used for anything the day
 * the platform fee replaced them (D-081), and leaving the purchase flow in the app kept inviting
 * a question about a feature that no longer does anything. Nothing about the token system was
 * deleted on the backend (existing balances are untouched, pending a product/finance decision on
 * what to do with them — see docs/DECISIONS.md D-081/D-106), this is purely the dead storefront
 * coming out of the app. What's left here — Haggler Plus and the purchase history behind it — is
 * the one thing on this screen that's still a real, working feature. */
export function WalletScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const orders = useOrders();
  const membership = usePlusMembership();
  const plans = usePlusPlans('CUSTOMER');
  const [order, setOrder] = useState<PaymentOrderStartDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();

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
      await qc.invalidateQueries({ queryKey: ['wallet', 'orders'] });
      await qc.invalidateQueries({ queryKey: ['plus', 'membership'] });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  if (membership.isLoading || plans.isLoading)
    return (
      <Screen>
        <View testID="wallet-skeleton" style={{ gap: spacing.lg }}>
          <Card>
            <Skeleton width="70%" height={20} />
          </Card>
          <Card>
            <Skeleton width="70%" height={20} />
          </Card>
        </View>
      </Screen>
    );
  if (membership.isError || plans.isError)
    return (
      <Screen>
        <ErrorState
          error={membership.error ?? plans.error}
          onRetry={() => {
            void membership.refetch();
            void plans.refetch();
          }}
        />
      </Screen>
    );

  return (
    <Screen scroll>
      <Text variant="title">{t('wallet.title')}</Text>

      {order ? (
        // Elevated: a payment awaiting confirmation is the most consequential moment on this
        // screen. Plans and history below are informational and stay flat.
        <Card testID="checkout" elevated>
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading">{t('wallet.checkoutTitle')}</Text>
            <Text>{t('wallet.checkoutSummaryPlus', { amount: formatRupees(order.amountPaise) })}</Text>
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
