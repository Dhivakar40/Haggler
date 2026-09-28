import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { type KycCheckDto, kycReferenceInputSchema, LEGAL_VERSION } from '@haggler/shared';
import { ApiError } from '../../api/client';
import { grantConsent, startKyc, submitKyc } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Button, Card, ErrorState, LoadingState, Screen, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { normalizeIndianPhone } from '../../lib/phone';
import { spacing } from '../../theme/tokens';
import { KYC_STATUS_KEY } from '../ranger/RangerScreen';
import { UploadError, uploadKycDocument } from './upload';

export function KycScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ tier: string }>();
  const tier: 1 | 2 = params.tier === '2' ? 2 : 1;
  const user = useSession((s) => s.user);
  const refreshMe = useSession((s) => s.refreshMe);

  const [check, setCheck] = useState<KycCheckDto | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [ref, setRef] = useState({ name: '', phone: '', relationship: '' });

  const needsConsent = user?.missingConsents.includes('KYC_PROCESSING') ?? true;

  // Opens the check (or returns the one already open, so this is safe to call repeatedly).
  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setCheck(await startKyc(tier));
    } catch {
      setLoadFailed(true);
    }
  }, [tier]);

  useEffect(() => {
    if (!needsConsent) void load();
  }, [needsConsent, load]);

  async function giveConsent() {
    try {
      await grantConsent({ purpose: 'KYC_PROCESSING', version: LEGAL_VERSION });
      await refreshMe();
    } catch (err) {
      setMessage(errorMessage(err, t));
    }
  }

  async function pick(type: string, source: 'camera' | 'library') {
    if (!check) return;
    setMessage(undefined);
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setMessage(t('kyc.permissionDenied'));

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 1,
            // The selfie uses the front camera, and cannot come from the gallery.
            cameraType:
              type === 'SELFIE' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
          })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setUploading(type);
    try {
      await uploadKycDocument({ checkId: check.id, type, uri: asset.uri, width: asset.width });
      await load(); // refresh which documents are uploaded
    } catch (err) {
      setMessage(
        err instanceof UploadError || err instanceof TypeError
          ? t('kyc.uploadFailed')
          : errorMessage(err, t),
      );
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    if (!check) return;
    const uploaded = new Set(
      check.documents.filter((d) => d.status === 'UPLOADED').map((d) => d.type),
    );
    if (!check.requiredDocuments.every((d) => uploaded.has(d)))
      return setMessage(t('kyc.incomplete'));

    let reference: { name: string; phone: string; relationship: string } | undefined;
    if (tier === 2) {
      const parsed = kycReferenceInputSchema.safeParse({
        ...ref,
        phone: normalizeIndianPhone(ref.phone) ?? '',
      });
      if (!parsed.success) return setMessage(t('contacts.invalid'));
      reference = parsed.data;
    }
    setSubmitting(true);
    setMessage(undefined);
    try {
      await submitKyc({ checkId: check.id, reference });
      await qc.invalidateQueries({ queryKey: KYC_STATUS_KEY });
      router.back();
    } catch (err) {
      const missing =
        err instanceof ApiError
          ? (err.details as { missing?: string[] } | undefined)?.missing
          : undefined;
      setMessage(missing?.includes('categories') ? t('kyc.needCategories') : errorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  if (needsConsent) {
    return (
      <Screen scroll>
        <Text variant="title">{t('kyc.consentTitle')}</Text>
        <Text>{t('kyc.consentText')}</Text>
        {message ? <Text color="danger">{message}</Text> : null}
        <Button
          testID="kyc-consent"
          title={t('kyc.consentAgree')}
          onPress={() => void giveConsent()}
        />
      </Screen>
    );
  }
  if (loadFailed)
    return (
      <Screen>
        <ErrorState onRetry={() => void load()} />
      </Screen>
    );
  if (!check)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );

  const editable = check.status === 'DRAFT' || check.status === 'NEEDS_INFO';
  const uploaded = new Set(
    check.documents.filter((d) => d.status === 'UPLOADED').map((d) => d.type),
  );

  return (
    <Screen scroll>
      <Text variant="title">{tier === 1 ? t('kyc.title1') : t('kyc.title2')}</Text>
      {check.reviewerMessage ? (
        <Card>
          <Text variant="label">{t('ranger.messageFromTeam')}</Text>
          <Text>{check.reviewerMessage}</Text>
        </Card>
      ) : null}
      {tier === 1 ? <Text color="warning">{t('kyc.maskedNotice')}</Text> : null}

      {check.requiredDocuments.map((type) => {
        const isSelfie = type === 'SELFIE';
        const busy = uploading === type;
        return (
          <Card key={type} testID={`doc-${type}`}>
            <View style={{ gap: spacing.sm }}>
              <Text variant="heading">{t(`kyc.docs.${type}`)}</Text>
              {isSelfie ? <Text color="textMuted">{t('kyc.selfieNotice')}</Text> : null}
              <Text
                color={uploaded.has(type) ? 'success' : 'textMuted'}
                testID={`doc-${type}-status`}
              >
                {busy
                  ? t('kyc.uploading')
                  : uploaded.has(type)
                    ? t('kyc.uploaded')
                    : t('kyc.missing')}
              </Text>
              {editable ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <Button
                    testID={`camera-${type}`}
                    title={t('kyc.takePhoto')}
                    onPress={() => void pick(type, 'camera')}
                    disabled={busy}
                  />
                  {!isSelfie ? (
                    <Button
                      testID={`library-${type}`}
                      variant="secondary"
                      title={t('kyc.choosePhoto')}
                      onPress={() => void pick(type, 'library')}
                      disabled={busy}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          </Card>
        );
      })}

      {tier === 2 && editable ? (
        <Card>
          <View style={{ gap: spacing.md }}>
            <Text variant="heading">{t('kyc.reference')}</Text>
            <Text color="textMuted">{t('kyc.referenceHint')}</Text>
            <TextField
              testID="ref-name"
              label={t('kyc.refName')}
              value={ref.name}
              onChangeText={(v) => setRef({ ...ref, name: v })}
              maxLength={80}
            />
            <TextField
              testID="ref-phone"
              label={t('kyc.refPhone')}
              prefix="+91"
              value={ref.phone}
              onChangeText={(v) => setRef({ ...ref, phone: v })}
              keyboardType="phone-pad"
              maxLength={16}
            />
            <TextField
              testID="ref-relationship"
              label={t('kyc.refRelationship')}
              value={ref.relationship}
              onChangeText={(v) => setRef({ ...ref, relationship: v })}
              maxLength={40}
            />
          </View>
        </Card>
      ) : null}

      {message ? (
        <Text color="danger" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}
      {editable ? (
        <Button
          testID="kyc-submit"
          title={t('kyc.submit')}
          onPress={() => void submit()}
          loading={submitting}
        />
      ) : (
        <Text color="textMuted">{t('ranger.status.PENDING_REVIEW')}</Text>
      )}
    </Screen>
  );
}
