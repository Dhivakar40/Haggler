import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { createStudentProfile, getStudentProfile, useStudentProfile } from '../../api/campus';
import { Button, Card, Screen, Text, TextField } from '../../components';
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
  const [dob, setDob] = useState('');
  const [institute, setInstitute] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const dobValid = /^\d{4}-\d{2}-\d{2}$/.test(dob);

  async function save() {
    setError(undefined);
    setBusy(true);
    try {
      await createStudentProfile({
        dateOfBirth: dob,
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
          <TextField
            testID="student-dob"
            label={t('campus.dateOfBirth')}
            value={dob}
            onChangeText={setDob}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
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
            disabled={!dobValid}
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
