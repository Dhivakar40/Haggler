import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { settleDues, useWorkerWallet, withdraw, workerWalletKey } from '../../api/wallet';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../components';
import { errorMessage } from '../../lib/errors';
import { formatRupees, parseRupeesToPaise } from '../../lib/money';
import { spacing } from '../../theme/tokens';

/** A Ranger's earnings (Phase Commerce B3/B4/B6): balance, dues owed, settle dues, withdraw —
 * all sandbox, same checkout-pattern conventions as the customer WalletScreen. */
export function WorkerWalletScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const wallet = useWorkerWallet();
  const [action, setAction] = useState<'settle' | 'withdraw' | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function open(which: 'settle' | 'withdraw', defaultPaise: number) {
    setAction(which);
    setError(undefined);
    setAmountInput(String(defaultPaise / 100));
  }

  async function submit() {
    const paise = parseRupeesToPaise(amountInput);
    if (paise === null || paise <= 0) return setError(t('job.cashCollectedInvalid'));
    setBusy(true);
    setError(undefined);
    try {
      if (action === 'settle') await settleDues(paise);
      else await withdraw(paise);
      setAction(null);
      await qc.invalidateQueries({ queryKey: workerWalletKey });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (wallet.isLoading)
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

  const { balancePaise, duesPaise, recentLedger } = wallet.data;

  return (
    <Screen scroll>
      <Text variant="title">{t('workerWallet.title')}</Text>

      <Card testID="worker-balance">
        <View style={{ gap: spacing.xs, alignItems: 'center' }}>
          <Text color="textMuted">{t('workerWallet.balanceLabel')}</Text>
          <Text variant="display" testID="balance-paise">
            {formatRupees(balancePaise)}
          </Text>
        </View>
      </Card>

      {duesPaise > 0 ? (
        <Card testID="worker-dues" elevated>
          <View style={{ gap: spacing.sm }}>
            <Text color="textMuted">{t('workerWallet.duesLabel')}</Text>
            <Text variant="heading" testID="dues-paise">
              {formatRupees(duesPaise)}
            </Text>
            <Text color="danger">{t('workerWallet.duesWarning')}</Text>
            <Button
              testID="open-settle-dues"
              title={t('workerWallet.settleDues')}
              onPress={() => open('settle', duesPaise)}
            />
          </View>
        </Card>
      ) : null}

      {action ? (
        <Card testID="worker-wallet-form" elevated>
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading">
              {action === 'settle' ? t('workerWallet.settleDuesTitle') : t('workerWallet.withdrawTitle')}
            </Text>
            <Text color="textMuted">
              {action === 'settle' ? t('workerWallet.settleDuesHelp') : t('workerWallet.withdrawHelp')}
            </Text>
            <TextField
              testID="worker-wallet-amount"
              label={t('workerWallet.amountLabel')}
              value={amountInput}
              onChangeText={setAmountInput}
              keyboardType="decimal-pad"
            />
            {error ? (
              <Text color="danger" accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            <Button
              testID="worker-wallet-submit"
              title={t('workerWallet.confirm')}
              loading={busy}
              onPress={() => void submit()}
            />
            <Button
              variant="secondary"
              title={t('workerWallet.cancel')}
              disabled={busy}
              onPress={() => setAction(null)}
            />
          </View>
        </Card>
      ) : (
        <Button
          testID="open-withdraw"
          variant="secondary"
          title={t('workerWallet.withdraw')}
          disabled={balancePaise <= 0}
          onPress={() => open('withdraw', balancePaise)}
        />
      )}

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('workerWallet.history')}</Text>
        {recentLedger.length === 0 ? <EmptyState message={t('workerWallet.noHistory')} /> : null}
        {recentLedger.map((l) => (
          <Card key={l.id} testID={`ledger-${l.id}`}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text>{t(`workerWallet.ledgerType.${l.type}`)}</Text>
              <Text color={l.amountPaise < 0 ? 'danger' : 'success'}>
                {formatRupees(l.amountPaise)}
              </Text>
            </View>
          </Card>
        ))}
      </View>

      <Button variant="secondary" title={t('common.back')} onPress={() => router.back()} />
    </Screen>
  );
}
