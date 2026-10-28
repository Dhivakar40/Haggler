import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';
import { addRole, exportMyData } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Avatar, Button, Card, ListRow, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { formatIndianPhone } from '../../lib/phone';
import { spacing } from '../../theme/tokens';

const ROLE_KEY = {
  CUSTOMER: 'account.roleCustomer',
  WORKER: 'account.roleWorker',
  EMPLOYER: 'account.roleEmployer',
  STUDENT: 'account.roleStudent',
} as const;

export function AccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const refreshMe = useSession((s) => s.refreshMe);
  const signOut = useSession((s) => s.signOut);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!user) return null;
  const isRanger = user.roles.includes('WORKER');
  const isEmployer = user.roles.includes('EMPLOYER');
  const isStudent = user.roles.includes('STUDENT');

  async function becomeRanger() {
    setBusy(true);
    setMessage(undefined);
    try {
      await addRole('WORKER');
      await refreshMe();
      router.push('/ranger');
    } catch (err) {
      setMessage(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function becomeEmployer() {
    setBusy(true);
    setMessage(undefined);
    try {
      await addRole('EMPLOYER');
      await refreshMe();
      router.push('/employer/profile');
    } catch (err) {
      setMessage(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function becomeStudent() {
    setBusy(true);
    setMessage(undefined);
    try {
      await addRole('STUDENT');
      await refreshMe();
      router.push('/student/profile');
    } catch (err) {
      setMessage(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setMessage(undefined);
    try {
      const data = await exportMyData();
      await Share.share({ message: JSON.stringify(data, null, 2), title: 'Haggler data export' });
    } catch {
      setMessage(t('account.exportFailed'));
    }
  }

  const go = (path: string) => () => router.push(path as never);

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Avatar name={user.fullName} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text variant="title">{user.fullName ?? t('account.noName')}</Text>
          <Text color="textMuted">
            {t('account.signedInAs', { phone: formatIndianPhone(user.phone) })}
          </Text>
          <Text color="textMuted" testID="roles">
            {t('account.roles')}: {user.roles.map((r) => t(ROLE_KEY[r])).join(', ')}
          </Text>
        </View>
      </View>

      {message ? (
        <Text color="danger" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}

      <Card>
        <ListRow
          testID="open-client-league"
          icon="ribbon-outline"
          title={t('clientLeague.title')}
          onPress={go('/client-league')}
        />
      </Card>

      {isRanger ? (
        <Card>
          <ListRow
            testID="ranger-verification"
            icon="shield-checkmark-outline"
            title={t('account.rangerVerification')}
            onPress={go('/ranger')}
          />
        </Card>
      ) : (
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading">{t('account.becomeRanger')}</Text>
            <Text color="textMuted">{t('account.becomeRangerDesc')}</Text>
            <Button
              testID="become-ranger"
              title={t('account.becomeRanger')}
              onPress={() => void becomeRanger()}
              loading={busy}
            />
          </View>
        </Card>
      )}

      {isEmployer ? (
        <Card>
          <ListRow
            testID="employer-listings"
            icon="briefcase-outline"
            title={t('employer.myListingsTitle')}
            onPress={go('/employer/listings')}
          />
        </Card>
      ) : (
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading">{t('employer.becomeEmployer')}</Text>
            <Text color="textMuted">{t('employer.becomeEmployerDesc')}</Text>
            <Button
              testID="become-employer"
              title={t('employer.becomeEmployer')}
              onPress={() => void becomeEmployer()}
              loading={busy}
            />
          </View>
        </Card>
      )}

      {isStudent ? (
        <Card>
          <ListRow
            testID="student-profile"
            icon="school-outline"
            title={t('campus.profileTitle')}
            onPress={go('/student/profile')}
          />
        </Card>
      ) : (
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading">{t('campus.becomeStudent')}</Text>
            <Text color="textMuted">{t('campus.becomeStudentDesc')}</Text>
            <Button
              testID="become-student"
              title={t('campus.becomeStudent')}
              onPress={() => void becomeStudent()}
              loading={busy}
            />
          </View>
        </Card>
      )}

      <View style={{ gap: spacing.xs }}>
        <Text variant="label" color="textMuted">
          {t('account.sectionMarketplace')}
        </Text>
        <Card>
          <ListRow
            testID="browse-contracts"
            icon="document-text-outline"
            title={t('employer.browseTitle')}
            onPress={go('/contracts')}
          />
          {isRanger ? (
            <ListRow
              testID="my-contract-applications"
              icon="list-outline"
              title={t('employer.myApplicationsTitle')}
              onPress={go('/contracts/my-applications')}
            />
          ) : null}
          <ListRow
            testID="browse-campus"
            icon="school-outline"
            title={t('campus.browseTitle')}
            onPress={go('/campus')}
          />
          {isStudent ? (
            <ListRow
              testID="my-campus-applications"
              icon="list-outline"
              title={t('employer.myApplicationsTitle')}
              onPress={go('/campus/my-applications')}
            />
          ) : null}
          <ListRow
            testID="open-wallet"
            icon="star-outline"
            title={t('account.wallet')}
            onPress={go('/wallet')}
          />
          {isRanger ? (
            <ListRow
              testID="open-earnings"
              icon="cash-outline"
              title={t('account.earnings')}
              onPress={go('/earnings')}
            />
          ) : null}
        </Card>
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text variant="label" color="textMuted">
          {t('account.sectionProfile')}
        </Text>
        <Card>
          <ListRow icon="person-outline" title={t('account.editProfile')} onPress={go('/profile')} />
          <ListRow
            icon="location-outline"
            title={t('account.addresses')}
            onPress={go('/addresses')}
          />
          <ListRow
            testID="open-blocked-users"
            icon="ban-outline"
            title={t('account.blockedUsers')}
            onPress={go('/blocked-users')}
          />
          <ListRow icon="call-outline" title={t('account.contacts')} onPress={go('/contacts')} />
          <ListRow icon="document-lock-outline" title={t('account.legal')} onPress={go('/legal')} />
          <ListRow
            icon="download-outline"
            title={t('account.exportData')}
            onPress={() => void download()}
          />
        </Card>
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text variant="label" color="textMuted">
          {t('account.sectionAccount')}
        </Text>
        <Card>
          <ListRow
            icon="log-out-outline"
            title={t('account.signOut')}
            onPress={() => void signOut()}
          />
          <ListRow
            testID="delete-account"
            icon="trash-outline"
            tone="danger"
            title={t('account.deleteAccount')}
            onPress={go('/delete-account')}
          />
        </Card>
      </View>
    </Screen>
  );
}
