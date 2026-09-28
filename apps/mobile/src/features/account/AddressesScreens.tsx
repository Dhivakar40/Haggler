import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';
import { addressInputSchema } from '@haggler/shared';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
} from '../../api/endpoints';
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
import { spacing } from '../../theme/tokens';

const KEY = ['addresses'];

export function AddressesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: KEY, queryFn: listAddresses });
  const makeDefault = useMutation({
    mutationFn: setDefaultAddress,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const remove = useMutation({
    mutationFn: deleteAddress,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const confirmRemove = (id: string) =>
    Alert.alert(t('addresses.removeConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('addresses.remove'), style: 'destructive', onPress: () => remove.mutate(id) },
    ]);

  return (
    <Screen scroll>
      <Button
        testID="add-address"
        title={t('addresses.add')}
        onPress={() => router.push('/address-new')}
      />
      {isLoading && <LoadingState />}
      {isError && <ErrorState onRetry={() => void refetch()} />}
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
                onPress={() => confirmRemove(a.id)}
              />
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

export function NewAddressScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState({ label: '', line1: '', line2: '', city: '', state: '', pincode: '' });
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));

  /** Real GPS, foreground only. Coordinates go to the server, which validates they are in India. */
  async function useMyLocation() {
    setStatus(undefined);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return setStatus(t('addresses.locationDenied'));
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setStatus(t('addresses.locationCaptured'));
      // Best-effort autofill from the phone's own geocoder (no key, no third-party billing).
      try {
        const [place] = await Location.reverseGeocodeAsync(pos.coords);
        if (place) {
          setF((cur) => ({
            ...cur,
            city: cur.city || place.city || place.subregion || '',
            state: cur.state || place.region || '',
            pincode: cur.pincode || (place.postalCode ?? ''),
          }));
        }
      } catch {
        /* autofill is a nicety; the person can type it */
      }
    } catch {
      setStatus(t('addresses.locationDenied'));
    } finally {
      setLocating(false);
    }
  }

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
      await createAddress(parsed.data);
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
        error={error}
      />
      <Button
        testID="save-address"
        title={t('addresses.save')}
        onPress={() => void save()}
        loading={busy}
      />
    </Screen>
  );
}
