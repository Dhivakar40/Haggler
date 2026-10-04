import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Gender } from '@haggler/shared';
import { completeOnboarding } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Button, Screen, Text, TextField } from '../../components';
import { PersonalDetailsFields } from '../account/PersonalDetailsFields';
import { errorMessage } from '../../lib/errors';
import { type DobParts, partsToDob } from '../../lib/dob';

/**
 * The mandatory first-sign-in setup (Part B, D-075): shown once, before the main app is usable,
 * right after sign-in/consent. `_layout.tsx`'s Navigator gates every other route behind
 * `user.profileComplete`, so there is no way to skip or dismiss this short of filling it in.
 */
export function OnboardingScreen() {
  const { t } = useTranslation();
  const refreshMe = useSession((s) => s.refreshMe);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState<DobParts>({ day: '', month: '', year: '' });
  const [gender, setGender] = useState<Gender | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    const dateOfBirth = partsToDob(dob);
    if (name.trim().length < 2) return setError(t('onboarding.nameInvalid'));
    if (!dateOfBirth) return setError(t('onboarding.dobInvalid'));
    if (!gender) return setError(t('onboarding.genderInvalid'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t('onboarding.emailInvalid'));

    setError(undefined);
    setBusy(true);
    try {
      await completeOnboarding({ fullName: name.trim(), dateOfBirth, gender, email: email.trim() });
      await refreshMe();
      // The root layout now sees profileComplete and shows the app.
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Text variant="title">{t('onboarding.title')}</Text>
      <Text color="textMuted">{t('onboarding.intro')}</Text>
      <TextField
        testID="onboarding-name"
        label={t('onboarding.nameLabel')}
        value={name}
        onChangeText={setName}
        autoComplete="name"
        maxLength={80}
      />
      <PersonalDetailsFields
        email={email}
        onEmailChange={setEmail}
        dob={dob}
        onDobChange={setDob}
        gender={gender}
        onGenderChange={setGender}
      />
      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        testID="onboarding-continue"
        title={t('onboarding.continue')}
        onPress={() => void submit()}
        loading={busy}
      />
    </Screen>
  );
}
