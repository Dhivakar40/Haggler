import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';
import { addRole, exportMyData } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Button, Card, Screen, Text } from '../../components';
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
      <View style={{ gap: spacing.xs }}>
        <Text variant="title">{user.fullName ?? t('account.noName')}</Text>
        <Text color="textMuted">
          {t('account.signedInAs', { phone: formatIndianPhone(user.phone) })}
        </Text>
        <Text color="textMuted" testID="roles">
          {t('account.roles')}: {user.roles.map((r) => t(ROLE_KEY[r])).join(', ')}
        </Text>
      </View>

      {message ? (
        <Text color="danger" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}

      {isRanger ? (
        <Button
          testID="ranger-verification"
          title={t('account.rangerVerification')}
          onPress={go('/ranger')}
        />
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
        <Button
          testID="employer-listings"
          title={t('employer.myListingsTitle')}
          onPress={go('/employer/listings')}
        />
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
        <Button
          testID="student-profile"
          title={t('campus.profileTitle')}
          onPress={go('/student/profile')}
        />
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

      <View style={{ gap: spacing.sm }}>
        <Button
          testID="browse-contracts"
          variant="secondary"
          title={t('employer.browseTitle')}
          onPress={go('/contracts')}
        />
        {isRanger ? (
          <Button
            testID="my-contract-applications"
            variant="secondary"
            title={t('employer.myApplicationsTitle')}
            onPress={go('/contracts/my-applications')}
          />
        ) : null}
        <Button
          testID="browse-campus"
          variant="secondary"
          title={t('campus.browseTitle')}
          onPress={go('/campus')}
        />
        {isStudent ? (
          <Button
            testID="my-campus-applications"
            variant="secondary"
            title={t('employer.myApplicationsTitle')}
            onPress={go('/campus/my-applications')}
          />
        ) : null}
        <Button testID="open-wallet" title={t('account.wallet')} onPress={go('/wallet')} />
        <Button variant="secondary" title={t('account.editProfile')} onPress={go('/profile')} />
        <Button variant="secondary" title={t('account.addresses')} onPress={go('/addresses')} />
        <Button
          testID="open-blocked-users"
          variant="secondary"
          title={t('account.blockedUsers')}
          onPress={go('/blocked-users')}
        />
        <Button variant="secondary" title={t('account.contacts')} onPress={go('/contacts')} />
        <Button variant="secondary" title={t('account.legal')} onPress={go('/legal')} />
        <Button
          variant="secondary"
          title={t('account.exportData')}
          onPress={() => void download()}
        />
        <Button variant="secondary" title={t('account.signOut')} onPress={() => void signOut()} />
        <Button
          testID="delete-account"
          variant="danger"
          title={t('account.deleteAccount')}
          onPress={go('/delete-account')}
        />
      </View>
    </Screen>
  );
}
