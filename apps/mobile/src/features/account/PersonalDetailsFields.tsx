import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Gender } from '@haggler/shared';
import { Chip, Text, TextField } from '../../components';
import { type DobParts } from '../../lib/dob';
import { spacing } from '../../theme/tokens';

const GENDERS: Gender[] = ['FEMALE', 'MALE', 'OTHER'];

/**
 * The self-reported personal fields shared by the mandatory onboarding setup and Settings >
 * Edit Profile. Date of birth is entered as three plain-digit fields rather than a native date
 * picker, so it works identically (and accessibly) on every supported platform without adding a
 * new dependency; `partsToDob`/`dobToParts` (lib/dob.ts) handle the round trip to an ISO string.
 */
export function PersonalDetailsFields({
  email,
  onEmailChange,
  dob,
  onDobChange,
  gender,
  onGenderChange,
}: {
  email: string;
  onEmailChange: (v: string) => void;
  dob: DobParts;
  onDobChange: (v: DobParts) => void;
  gender: Gender | null;
  onGenderChange: (v: Gender) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: spacing.md }}>
      <TextField
        testID="email-input"
        label={t('onboarding.emailLabel')}
        value={email}
        onChangeText={onEmailChange}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        maxLength={254}
      />
      <View style={{ gap: spacing.sm }}>
        <Text variant="label">{t('onboarding.dobLabel')}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <TextField
              testID="dob-day"
              label={t('onboarding.dobDay')}
              value={dob.day}
              onChangeText={(v) => onDobChange({ ...dob, day: v.replace(/\D/g, '').slice(0, 2) })}
              keyboardType="number-pad"
              maxLength={2}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              testID="dob-month"
              label={t('onboarding.dobMonth')}
              value={dob.month}
              onChangeText={(v) => onDobChange({ ...dob, month: v.replace(/\D/g, '').slice(0, 2) })}
              keyboardType="number-pad"
              maxLength={2}
            />
          </View>
          <View style={{ flex: 1.4 }}>
            <TextField
              testID="dob-year"
              label={t('onboarding.dobYear')}
              value={dob.year}
              onChangeText={(v) => onDobChange({ ...dob, year: v.replace(/\D/g, '').slice(0, 4) })}
              keyboardType="number-pad"
              maxLength={4}
            />
          </View>
        </View>
      </View>
      <View style={{ gap: spacing.sm }}>
        <Text variant="label">{t('onboarding.genderLabel')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {GENDERS.map((g) => (
            <Chip
              key={g}
              testID={`gender-${g}`}
              label={t(`onboarding.gender${g.charAt(0)}${g.slice(1).toLowerCase()}`)}
              selected={gender === g}
              onPress={() => onGenderChange(g)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
