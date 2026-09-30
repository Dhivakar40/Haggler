import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { useMyCampusApplications } from '../../api/campus';
import { Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { spacing } from '../../theme/tokens';

const STATUS_COLOR: Record<string, 'text' | 'success' | 'danger' | 'textMuted'> = {
  APPLIED: 'text',
  SHORTLISTED: 'success',
  REJECTED: 'danger',
  HIRED: 'success',
  WITHDRAWN: 'textMuted',
};

export function MyCampusApplicationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const applications = useMyCampusApplications();

  if (applications.isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (applications.isError)
    return (
      <Screen>
        <ErrorState onRetry={() => void applications.refetch()} />
      </Screen>
    );

  const items = applications.data?.items ?? [];

  return (
    <Screen>
      {items.length === 0 ? (
        <EmptyState message={t('employer.noApplications')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}
          renderItem={({ item }) => (
            <Card
              testID={`my-campus-application-${item.id}`}
              onPress={() => router.push(`/campus/${item.listingId}`)}
            >
              <View style={{ gap: spacing.xs }}>
                <Text variant="heading">{item.listingTitle}</Text>
                <Text color="textMuted">{item.businessName}</Text>
                <Text color={STATUS_COLOR[item.status] ?? 'text'}>
                  {t(`employer.applicationStatus.${item.status}`)}
                </Text>
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
