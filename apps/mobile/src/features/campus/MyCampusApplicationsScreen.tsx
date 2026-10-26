import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { useMyCampusApplications } from '../../api/campus';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  StatusPill,
  Text,
} from '../../components';
import { applicationStatusTone } from '../../lib/status-tone';
import { spacing } from '../../theme/tokens';

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
        <ErrorState error={applications.error} onRetry={() => void applications.refetch()} />
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
                <StatusPill
                  testID={`my-campus-application-${item.id}-status`}
                  tone={applicationStatusTone(item.status)}
                  label={t(`employer.applicationStatus.${item.status}`)}
                />
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
