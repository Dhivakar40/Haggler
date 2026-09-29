import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { type CreateRequestInput, MAX_REQUEST_PHOTOS } from '@haggler/shared';
import { listAddresses } from '../../api/endpoints';
import { createRequest, getPriceBand } from '../../api/market';
import { Button, Card, Chip, LoadingState, Screen, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';
import { VoiceNoteRecorder, type VoiceNote } from '../media/VoiceNoteRecorder';
import { uploadRequestMedia } from '../media/upload';

interface Photo {
  key: string;
  uri: string;
  mediaId?: string;
  status: 'uploading' | 'done' | 'error';
}
type When = 'NOW' | 'IN1H' | 'IN2H' | 'TOMORROW';

export function scheduledIso(when: When, now = new Date()): string | undefined {
  if (when === 'NOW') return undefined;
  const d = new Date(now);
  if (when === 'IN1H') d.setHours(d.getHours() + 1, d.getMinutes() + 5); // a little over 1 h: the server needs 30+ min
  if (when === 'IN2H') d.setHours(d.getHours() + 2);
  if (when === 'TOMORROW') {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  }
  return d.toISOString();
}

export function NewRequestScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { category = 'electrician' } = useLocalSearchParams<{ category: string }>();
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: listAddresses });

  const [description, setDescription] = useState('');
  const [addressId, setAddressId] = useState<string | null>(null);
  const [when, setWhen] = useState<When>('NOW');
  const [gender, setGender] = useState<'ANY' | 'FEMALE' | 'MALE'>('ANY');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [voice, setVoice] = useState<VoiceNote | null>(null);
  const [voiceId, setVoiceId] = useState<string | undefined>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const list = addresses.data ?? [];
  const selected = list.find(
    (a) => a.id === (addressId ?? list.find((x) => x.isDefault)?.id ?? list[0]?.id),
  );

  const band = useQuery({
    queryKey: ['band', category, selected?.pincode, selected?.city],
    queryFn: () => getPriceBand(category, selected!.pincode, selected!.city),
    enabled: !!selected,
  });

  async function addPhoto(source: 'camera' | 'library') {
    if (photos.length >= MAX_REQUEST_PHOTOS) return setError(t('request.photoLimit'));
    setError(undefined);
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(t('kyc.permissionDenied'));
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = res.canceled ? undefined : res.assets?.[0];
    if (!asset) return;
    const key = `${Date.now()}-${photos.length}`;
    setPhotos((cur) => [...cur, { key, uri: asset.uri, status: 'uploading' }]);
    try {
      const mediaId = await uploadRequestMedia({
        kind: 'PHOTO',
        uri: asset.uri,
        width: asset.width,
      });
      setPhotos((cur) => cur.map((p) => (p.key === key ? { ...p, mediaId, status: 'done' } : p)));
    } catch {
      setPhotos((cur) => cur.map((p) => (p.key === key ? { ...p, status: 'error' } : p)));
      setError(t('kyc.uploadFailed'));
    }
  }

  async function submit() {
    setError(undefined);
    if (description.trim().length < 5) return setError(t('request.tooShort'));
    if (!selected) return setError(t('request.noAddress'));
    if (selected.latitude === null || selected.longitude === null)
      return setError(t('apiErrors.ADDRESS_NEEDS_LOCATION'));
    if (photos.some((p) => p.status === 'uploading')) return setError(t('request.uploading'));

    setBusy(true);
    try {
      // Upload the voice note now (photos were uploaded as they were added).
      let vId = voiceId;
      if (voice && !vId) {
        vId = await uploadRequestMedia({
          kind: 'VOICE',
          uri: voice.uri,
          durationSeconds: voice.durationSeconds,
        });
        setVoiceId(vId);
      }
      const input: CreateRequestInput = {
        categorySlug: category,
        description: description.trim(),
        addressId: selected.id,
        urgency: when === 'NOW' ? 'IMMEDIATE' : 'SCHEDULED',
        ...(when === 'NOW' ? {} : { scheduledFor: scheduledIso(when) }),
        genderPreference: gender,
        mediaIds: [...photos.flatMap((p) => (p.mediaId ? [p.mediaId] : [])), ...(vId ? [vId] : [])],
      };
      const dto = await createRequest(input);
      router.replace({ pathname: '/request/[id]', params: { id: dto.requestId } });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (addresses.isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );

  return (
    <Screen scroll>
      <Text variant="title">{t(`categories.${category}`)}</Text>

      <TextField
        testID="description"
        label={t('request.describe')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={1000}
      />
      <Text variant="caption" color="textMuted">
        {t('request.describeHint')}
      </Text>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('request.where')}</Text>
        {list.length === 0 ? (
          <>
            <Text color="textMuted">{t('request.noAddress')}</Text>
            <Button
              testID="add-address"
              variant="secondary"
              title={t('request.addAddress')}
              onPress={() => router.push('/address-new')}
            />
          </>
        ) : (
          list.map((a) => (
            <Chip
              key={a.id}
              testID={`address-${a.label}`}
              label={`${a.label}: ${a.line1}`}
              selected={selected?.id === a.id}
              onPress={() => setAddressId(a.id)}
            />
          ))
        )}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('request.when')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {(['NOW', 'IN1H', 'IN2H', 'TOMORROW'] as const).map((w) => (
            <Chip
              key={w}
              testID={`when-${w}`}
              label={
                {
                  NOW: t('request.now'),
                  IN1H: t('request.in1h'),
                  IN2H: t('request.in2h'),
                  TOMORROW: t('request.tomorrow'),
                }[w]
              }
              selected={when === w}
              onPress={() => setWhen(w)}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('request.photos')}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Button
            testID="photo-camera"
            variant="secondary"
            title={t('kyc.takePhoto')}
            onPress={() => void addPhoto('camera')}
          />
          <Button
            testID="photo-library"
            variant="secondary"
            title={t('kyc.choosePhoto')}
            onPress={() => void addPhoto('library')}
          />
        </View>
        {photos.map((p, i) => (
          <View key={p.key} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Text
              testID={`photo-${i}-status`}
              color={
                p.status === 'error' ? 'danger' : p.status === 'done' ? 'success' : 'textMuted'
              }
            >
              {`${i + 1}. ${p.status === 'uploading' ? t('request.uploading') : p.status === 'done' ? t('kyc.uploaded') : t('kyc.uploadFailed')}`}
            </Text>
            <Button
              testID={`photo-${i}-remove`}
              variant="secondary"
              title={t('request.removePhoto')}
              onPress={() => setPhotos((cur) => cur.filter((x) => x.key !== p.key))}
            />
          </View>
        ))}
      </View>

      <VoiceNoteRecorder
        value={voice}
        onChange={(v) => {
          setVoice(v);
          setVoiceId(undefined);
        }}
      />

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('request.genderPref')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {(['ANY', 'FEMALE', 'MALE'] as const).map((g) => (
            <Chip
              key={g}
              testID={`gender-${g}`}
              label={
                { ANY: t('request.any'), FEMALE: t('request.female'), MALE: t('request.male') }[g]
              }
              selected={gender === g}
              onPress={() => setGender(g)}
            />
          ))}
        </View>
        <Text variant="caption" color="textMuted">
          {t('request.genderHint')}
        </Text>
      </View>

      {band.data ? (
        <Card testID="price-band">
          <View style={{ gap: spacing.xs }}>
            <Text variant="heading">{t('request.priceTitle')}</Text>
            <Text testID="price-range">
              {t('request.priceRange', {
                min: formatRupees(band.data.minPaise),
                max: formatRupees(band.data.maxPaise),
              })}
            </Text>
            <Text color="textMuted">
              {t('request.priceTypical', { median: formatRupees(band.data.medianPaise) })}
            </Text>
            {band.data.isSeededDefault ? (
              <Text variant="caption" color="warning">
                {t('request.priceEstimate')}
              </Text>
            ) : null}
            <Text variant="caption" color="textMuted">
              {t('request.priceNote')}
            </Text>
          </View>
        </Card>
      ) : null}

      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        testID="submit-request"
        title={t('request.submit')}
        onPress={() => void submit()}
        loading={busy}
      />
    </Screen>
  );
}
