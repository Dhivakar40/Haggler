import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { TokenBundleDto, TopupOrderDto } from '@haggler/shared';
import {
  createTopupOrder,
  sandboxPay,
  useBundles,
  useOrders,
  useWallet,
  walletKey,
} from '../../api/wallet';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

/** Buy tokens -> a payment order -> pay -> the wallet refetches. One order in flight at a time. */
export function WalletScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const wallet = useWallet();
  const bundles = useBundles();
  const orders = useOrders();
  const [order, setOrder] = useState<TopupOrderDto | null>(null);
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

  async function paySandbox() {
    if (!order) return;
    setBusy('pay');
    setError(undefined);
    try {
      await sandboxPay(order.orderId);
      setOrder(null);
      await qc.invalidateQueries({ queryKey: walletKey });
      await qc.invalidateQueries({ queryKey: ['wallet', 'orders'] });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  if (wallet.isLoading || bundles.isLoading)
    return (
      <Screen>
        <LoadingState />
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
          <Text variant="title" testID="balance-tokens" style={{ fontSize: 40 }}>
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
        <Card testID="checkout">
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading">{t('wallet.checkoutTitle')}</Text>
            <Text>
              {t('wallet.checkoutSummary', {
                tokens: order.tokens,
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
              <View style={{ gap: 2 }}>
                <Text variant="heading">{t('wallet.tokenCount', { count: b.tokens })}</Text>
                <Text color="textMuted">{formatRupees(b.pricePaise)}</Text>
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
        {orders.isLoading ? <LoadingState /> : null}
        {orders.data?.items.length === 0 ? <EmptyState message={t('wallet.noOrders')} /> : null}
        {orders.data?.items.map((o) => (
          <Card key={o.id} testID={`order-${o.id}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text>{t('wallet.tokenCount', { count: o.tokens })}</Text>
              <Text
                color={
                  o.status === 'PAID'
                    ? 'success'
                    : o.status === 'FAILED' || o.status === 'CANCELLED'
                      ? 'danger'
                      : 'textMuted'
                }
              >
                {t(`wallet.orderStatus.${o.status}`)}
              </Text>
            </View>
            <Text color="textMuted">{formatRupees(o.amountPaise)}</Text>
          </Card>
        ))}
      </View>

      <Button variant="secondary" title={t('common.back')} onPress={() => router.back()} />
    </Screen>
  );
}
