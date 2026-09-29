import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ContractPayType } from '@haggler/shared';
import { useCategories } from '../../api/hooks';
import { createListing } from '../../api/contracts';
import { Button, Card, Chip, Screen, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { parseRupeesToPaise } from '../../lib/money';
import { spacing } from '../../theme/tokens';

const PAY_TYPES: ContractPayType[] = ['ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY'];

export function PostListingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const categories = useCategories();

  const [categorySlug, setCategorySlug] = useState<string>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [payType, setPayType] = useState<ContractPayType>('DAILY');
  const [payAmount, setPayAmount] = useState('');
  const [openings, setOpenings] = useState('1');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const payAmountPaise = parseRupeesToPaise(payAmount);
  const openingsNum = Number(openings);
  const canSubmit =
    !!categorySlug &&
    title.trim().length >= 3 &&
    description.trim().length >= 10 &&
    payAmountPaise !== null &&
    payAmountPaise > 0 &&
    Number.isInteger(openingsNum) &&
    openingsNum >= 1 &&
    city.trim().length > 0 &&
    state.trim().length > 0 &&
    /^[1-9][0-9]{5}$/.test(pincode);

  async function submit() {
    if (!canSubmit || !categorySlug || payAmountPaise === null) return;
    setError(undefined);
    setBusy(true);
    try {
      const listing = await createListing({
        categorySlug,
        title: title.trim(),
        description: description.trim(),
        payType,
        payAmountPaise,
        openings: openingsNum,
        city: city.trim(),
        state: state.trim(),
        pincode,
      });
      await qc.invalidateQueries({ queryKey: ['employer', 'listings'] });
      router.replace(`/employer/listings/${listing.id}`);
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
              testID={`listing-cat-${c.slug}`}
              label={t(c.nameKey)}
              selected={categorySlug === c.slug}
              onPress={() => setCategorySlug(c.slug)}
            />
          ))}
        </View>
      </View>

      <TextField
        testID="listing-title"
        label={t('employer.listingTitle')}
        value={title}
        onChangeText={setTitle}
        maxLength={120}
      />
      <TextField
        testID="listing-description"
        label={t('employer.listingDescription')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
      />

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('employer.payType')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {PAY_TYPES.map((p) => (
            <Chip
              key={p}
              testID={`pay-type-${p}`}
              label={t(`employer.payTypes.${p}`)}
              selected={payType === p}
              onPress={() => setPayType(p)}
            />
          ))}
        </View>
      </View>

      <TextField
        testID="listing-pay-amount"
        label={t('employer.payAmount')}
        value={payAmount}
        onChangeText={setPayAmount}
        keyboardType="decimal-pad"
        prefix="₹"
      />
      <TextField
        testID="listing-openings"
        label={t('employer.openings')}
        value={openings}
        onChangeText={setOpenings}
        keyboardType="number-pad"
      />
      <TextField
        testID="listing-city"
        label={t('employer.city')}
        value={city}
        onChangeText={setCity}
      />
      <TextField
        testID="listing-state"
        label={t('employer.state')}
        value={state}
        onChangeText={setState}
      />
      <TextField
        testID="listing-pincode"
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
          testID="post-listing"
          title={t('employer.postListing')}
          onPress={() => void submit()}
          loading={busy}
          disabled={!canSubmit}
        />
      </Card>
    </Screen>
  );
}
