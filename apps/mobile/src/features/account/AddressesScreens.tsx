import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { addressInputSchema } from '@haggler/shared';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
} from '../../api/endpoints';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../components';
import { errorMessage } from '../../lib/errors';
import { spacing } from '../../theme/tokens';
import { useAddressLocation } from './useAddressLocation';

const KEY = ['addresses'];

export function AddressesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: KEY,
    queryFn: listAddresses,
  });
  const makeDefault = useMutation({
    mutationFn: setDefaultAddress,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const remove = useMutation({
    mutationFn: deleteAddress,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const [removeId, setRemoveId] = useState<string | null>(null);

  return (
    <Screen scroll>
      <Button
        testID="add-address"
        title={t('addresses.add')}
        onPress={() => router.push('/address-new')}
      />
      {isLoading && <LoadingState />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data?.length === 0 && <EmptyState message={t('addresses.empty')} />}
      {data?.map((a) => (
        <Card key={a.id} testID={`address-${a.label}`}>
          <View style={{ gap: spacing.xs }}>
            <Text variant="heading">
              {a.label}
              {a.isDefault ? ` · ${t('addresses.default')}` : ''}
            </Text>
            <Text>{[a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ')}</Text>
            <View
              style={{
                flexDirection: 'row',
                gap: spacing.sm,
                flexWrap: 'wrap',
                marginTop: spacing.sm,
              }}
            >
              <Button
                testID={`edit-address-${a.label}`}
                variant="secondary"
                title={t('addresses.edit')}
                onPress={() => router.push({ pathname: '/address-new', params: { id: a.id } })}
              />
              {!a.isDefault && (
                <Button
                  variant="secondary"
                  title={t('addresses.makeDefault')}
                  onPress={() => makeDefault.mutate(a.id)}
                />
              )}
              <Button
                variant="danger"
                title={t('addresses.remove')}
                onPress={() => setRemoveId(a.id)}
              />
            </View>
          </View>
        </Card>
      ))}

      <Dialog
        testID="remove-address-dialog"
        visible={!!removeId}
        title={t('addresses.removeConfirm')}
        confirmLabel={t('addresses.remove')}
        onConfirm={() => {
          if (removeId) remove.mutate(removeId);
          setRemoveId(null);
        }}
        cancelLabel={t('common.cancel')}
        onCancel={() => setRemoveId(null)}
        destructive
      />
    </Screen>
  );
}

export function NewAddressScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = typeof id === 'string';
  const existing = useQuery({ queryKey: KEY, queryFn: listAddresses, enabled: editing });
  const [f, setF] = useState({ label: '', line1: '', line2: '', city: '', state: '', pincode: '' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const { coords, status, locating, useMyLocation } = useAddressLocation((place) =>
    setF((cur) => ({
      ...cur,
      city: cur.city || place.city || '',
      state: cur.state || place.region || '',
      pincode: cur.pincode || place.postalCode || '',
    })),
  );

  // Fill the form once the existing address arrives — not on every refetch, so edits in progress
  // aren't clobbered by a background refresh.
  useEffect(() => {
    if (!editing || prefilled) return;
    const a = existing.data?.find((x) => x.id === id);
    if (!a) return;
    setF({
      label: a.label,
      line1: a.line1,
      line2: a.line2 ?? '',
      city: a.city,
      state: a.state,
      pincode: a.pincode,
    });
    setPrefilled(true);
  }, [editing, prefilled, existing.data, id]);

  async function save() {
    const parsed = addressInputSchema.safeParse({
      label: f.label,
      line1: f.line1,
      ...(f.line2.trim() ? { line2: f.line2 } : {}),
      city: f.city,
      state: f.state,
      pincode: f.pincode.trim(),
      ...(coords ?? {}),
    });
    if (!parsed.success) return setError(t('addresses.invalid'));
    setError(undefined);
    setBusy(true);
    try {
      if (typeof id === 'string') await updateAddress(id, parsed.data);
      else await createAddress(parsed.data);
      await qc.invalidateQueries({ queryKey: KEY });
      router.back();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      {editing ? (
        <Text variant="heading">{t('addresses.editTitle')}</Text>
      ) : null}
      <Button
        testID="use-location"
        variant="secondary"
        title={locating ? t('addresses.locating') : t('addresses.useLocation')}
        onPress={() => void useMyLocation()}
        disabled={locating}
      />
      {status ? <Text color={coords ? 'success' : 'warning'}>{status}</Text> : null}
      <TextField
        testID="label"
        label={t('addresses.label')}
        value={f.label}
        onChangeText={set('label')}
        maxLength={30}
      />
      <TextField
        testID="line1"
        label={t('addresses.line1')}
        value={f.line1}
        onChangeText={set('line1')}
        maxLength={120}
      />
      <TextField
        testID="line2"
        label={t('addresses.line2')}
        value={f.line2}
        onChangeText={set('line2')}
        maxLength={120}
      />
      <TextField
        testID="city"
        label={t('addresses.city')}
        value={f.city}
        onChangeText={set('city')}
        maxLength={60}
      />
      <TextField
        testID="state"
        label={t('addresses.state')}
        value={f.state}
        onChangeText={set('state')}
        maxLength={60}
      />
      <TextField
        testID="pincode"
        label={t('addresses.pincode')}
        value={f.pincode}
        onChangeText={set('pincode')}
        keyboardType="number-pad"
        maxLength={6}
      />
      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        testID="save-address"
        title={t('addresses.save')}
        onPress={() => void save()}
        loading={busy}
      />
    </Screen>
  );
}
