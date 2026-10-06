import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { createStudentProfile, getStudentProfile, useStudentProfile } from '../../api/campus';
import { Button, Card, Screen, Text, TextField } from '../../components';
import { type DobParts, partsToDob } from '../../lib/dob';
import { errorMessage } from '../../lib/errors';
import { spacing } from '../../theme/tokens';

/** Set a date of birth once (D-060: hard 18+ block, self-declared but enforced in code, not
 * admin-reviewed like a Ranger's — D-063 known gap). Required once before applying to a Campus
 * job. */
export function StudentProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const profile = useStudentProfile(true);
  const [dob, setDob] = useState<DobParts>({ day: '', month: '', year: '' });
  const [institute, setInstitute] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const dateOfBirth = partsToDob(dob);

  async function save() {
    if (!dateOfBirth) return setError(t('onboarding.dobInvalid'));
    setError(undefined);
    setBusy(true);
    try {
      await createStudentProfile({
        dateOfBirth,
        instituteName: institute.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['student', 'profile'] });
      router.push('/campus');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (profile.data) {
    // Profile already exists: DOB cannot be re-submitted, so just show the read-only summary.
    return (
      <Screen>
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading">{t('campus.profileTitle')}</Text>
            <Text color="textMuted">{profile.data.instituteName ?? t('campus.noInstitute')}</Text>
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text color="textMuted">{t('campus.profileIntro')}</Text>
      <Card>
        <View style={{ gap: spacing.md }}>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">{t('campus.dateOfBirth')}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  testID="student-dob-day"
                  label={t('onboarding.dobDay')}
                  value={dob.day}
                  onChangeText={(v) => setDob({ ...dob, day: v.replace(/\D/g, '').slice(0, 2) })}
                  keyboardType="number-pad"
                  maxLength={2}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  testID="student-dob-month"
                  label={t('onboarding.dobMonth')}
                  value={dob.month}
                  onChangeText={(v) => setDob({ ...dob, month: v.replace(/\D/g, '').slice(0, 2) })}
                  keyboardType="number-pad"
                  maxLength={2}
                />
              </View>
              <View style={{ flex: 1.4 }}>
                <TextField
                  testID="student-dob-year"
                  label={t('onboarding.dobYear')}
                  value={dob.year}
                  onChangeText={(v) => setDob({ ...dob, year: v.replace(/\D/g, '').slice(0, 4) })}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
            </View>
          </View>
          <TextField
            testID="student-institute"
            label={t('campus.instituteName')}
            value={institute}
            onChangeText={setInstitute}
            maxLength={120}
          />
          {error ? (
            <Text color="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button
            testID="student-save-profile"
            title={t('common.save')}
            onPress={() => void save()}
            loading={busy}
          />
        </View>
      </Card>
    </Screen>
  );
}

/** Best-effort check used by AccountScreen, without needing a dedicated existence endpoint. */
export async function hasStudentProfile(): Promise<boolean> {
  try {
    await getStudentProfile();
    return true;
  } catch {
    return false;
  }
}
