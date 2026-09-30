import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useCategories } from '../../api/hooks';
import { createCampusListing } from '../../api/campus';
import { Button, Card, Chip, Screen, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { parseRupeesToPaise } from '../../lib/money';
import { spacing } from '../../theme/tokens';

/** Posting needs a verified employer (D-062) — an unverified attempt fails server-side with a
 * clear message; there's no client-side pre-check since the employer's own profile screen
 * doesn't expose `verified` today (kept out of scope; the error message is enough). */
export function PostCampusListingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const categories = useCategories();

  const [categorySlug, setCategorySlug] = useState<string>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [hoursPerWeek, setHoursPerWeek] = useState('');
  const [isNightShift, setIsNightShift] = useState(false);
  const [openings, setOpenings] = useState('1');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const hourlyRatePaise = parseRupeesToPaise(hourlyRate);
  const hoursNum = Number(hoursPerWeek);
  const openingsNum = Number(openings);
  const canSubmit =
    !!categorySlug &&
    title.trim().length >= 3 &&
    description.trim().length >= 10 &&
    hourlyRatePaise !== null &&
    hourlyRatePaise > 0 &&
    Number.isInteger(hoursNum) &&
    hoursNum >= 1 &&
    hoursNum <= 80 &&
    Number.isInteger(openingsNum) &&
    openingsNum >= 1 &&
    city.trim().length > 0 &&
    state.trim().length > 0 &&
    /^[1-9][0-9]{5}$/.test(pincode);

  async function submit() {
    if (!canSubmit || !categorySlug || hourlyRatePaise === null) return;
    setError(undefined);
    setBusy(true);
    try {
      const listing = await createCampusListing({
        categorySlug,
        title: title.trim(),
        description: description.trim(),
        hourlyRatePaise,
        hoursPerWeek: hoursNum,
        isNightShift,
        openings: openingsNum,
        city: city.trim(),
        state: state.trim(),
        pincode,
      });
      await qc.invalidateQueries({ queryKey: ['employer', 'campus-listings'] });
      router.replace(`/employer/campus/${listing.id}`);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('employer.category')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {categories.data?.map((c) => (
            <Chip
              key={c.slug}
              testID={`campus-cat-${c.slug}`}
              label={t(c.nameKey)}
              selected={categorySlug === c.slug}
              onPress={() => setCategorySlug(c.slug)}
            />
          ))}
        </View>
      </View>

      <TextField
        testID="campus-title"
        label={t('employer.listingTitle')}
        value={title}
        onChangeText={setTitle}
        maxLength={120}
      />
      <TextField
        testID="campus-description"
        label={t('employer.listingDescription')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
      />
      <TextField
        testID="campus-hourly-rate"
        label={t('campus.hourlyRate')}
        value={hourlyRate}
        onChangeText={setHourlyRate}
        keyboardType="decimal-pad"
        prefix="₹"
      />
      <TextField
        testID="campus-hours-per-week"
        label={t('campus.hoursPerWeek')}
        value={hoursPerWeek}
        onChangeText={setHoursPerWeek}
        keyboardType="number-pad"
      />

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('campus.shiftType')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip
            testID="shift-day"
            label={t('campus.dayShiftsOnly')}
            selected={!isNightShift}
            onPress={() => setIsNightShift(false)}
          />
          <Chip
            testID="shift-night"
            label={t('campus.includesNightShift')}
            selected={isNightShift}
            onPress={() => setIsNightShift(true)}
          />
        </View>
        {isNightShift ? (
          <Text variant="caption" color="textMuted">
            {t('campus.nightShiftHint')}
          </Text>
        ) : null}
      </View>

      <TextField
        testID="campus-openings"
        label={t('employer.openings')}
        value={openings}
        onChangeText={setOpenings}
        keyboardType="number-pad"
      />
      <TextField
        testID="campus-city"
        label={t('employer.city')}
        value={city}
        onChangeText={setCity}
      />
      <TextField
        testID="campus-state"
        label={t('employer.state')}
        value={state}
        onChangeText={setState}
      />
      <TextField
        testID="campus-pincode"
        label={t('employer.pincode')}
        value={pincode}
        onChangeText={setPincode}
        keyboardType="number-pad"
        maxLength={6}
      />

      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Card>
        <Button
          testID="post-campus-listing"
          title={t('employer.postListing')}
          onPress={() => void submit()}
          loading={busy}
          disabled={!canSubmit}
        />
      </Card>
    </Screen>
  );
}
