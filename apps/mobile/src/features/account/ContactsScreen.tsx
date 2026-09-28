import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { emergencyContactInputSchema, MAX_EMERGENCY_CONTACTS } from '@haggler/shared';
import { createContact, deleteContact, listContacts } from '../../api/endpoints';
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
import { formatIndianPhone, normalizeIndianPhone } from '../../lib/phone';
import { spacing } from '../../theme/tokens';

const KEY = ['emergency-contacts'];

export function ContactsScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: KEY, queryFn: listContacts });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [error, setError] = useState<string>();

  const add = useMutation({
    mutationFn: createContact,
    onSuccess: async () => {
      setName('');
      setPhone('');
      setRelationship('');
      setError(undefined);
      await qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => setError(errorMessage(err, t)),
  });
  const remove = useMutation({
    mutationFn: deleteContact,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  function submit() {
    const parsed = emergencyContactInputSchema.safeParse({
      name,
      phone: normalizeIndianPhone(phone) ?? '',
      relationship,
    });
    if (!parsed.success) return setError(t('contacts.invalid'));
    add.mutate(parsed.data);
  }

  const full = (data?.length ?? 0) >= MAX_EMERGENCY_CONTACTS;

  return (
    <Screen scroll>
      <Text color="textMuted">{t('contacts.intro')}</Text>
      {isLoading && <LoadingState />}
      {isError && <ErrorState onRetry={() => void refetch()} />}
      {data?.length === 0 && <EmptyState message={t('contacts.empty')} />}
      {data?.map((c) => (
        <Card key={c.id} testID={`contact-${c.name}`}>
          <View style={{ gap: spacing.xs }}>
            <Text variant="heading">{c.name}</Text>
            <Text color="textMuted">
              {c.relationship} · {formatIndianPhone(c.phone)}
            </Text>
            <Button
              variant="danger"
              title={t('contacts.remove')}
              onPress={() => remove.mutate(c.id)}
            />
          </View>
        </Card>
      ))}

      {!full && (
        <Card>
          <View style={{ gap: spacing.md }}>
            <Text variant="heading">{t('contacts.add')}</Text>
            <TextField
              testID="contact-name"
              label={t('contacts.name')}
              value={name}
              onChangeText={setName}
              maxLength={80}
            />
            <TextField
              testID="contact-phone"
              label={t('contacts.phone')}
              prefix="+91"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={16}
            />
            <TextField
              testID="contact-relationship"
              label={t('contacts.relationship')}
              value={relationship}
              onChangeText={setRelationship}
              maxLength={40}
              error={error}
            />
            <Button
              testID="save-contact"
              title={t('contacts.save')}
              onPress={submit}
              loading={add.isPending}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}
