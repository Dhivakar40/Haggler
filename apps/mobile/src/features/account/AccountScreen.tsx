import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { addRole } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Avatar, Badge, Button, Card, ListRow, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { formatIndianPhone } from '../../lib/phone';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

const ROLE_KEY = {
  CUSTOMER: 'account.roleCustomer',
  WORKER: 'account.roleWorker',
  EMPLOYER: 'account.roleEmployer',
  STUDENT: 'account.roleStudent',
} as const;

// The app never shows the word "worker" to a user (always "Ranger") — testIDs are inert in the
// real app, but screens.spec.tsx asserts the word never appears anywhere in the rendered tree
// (including props), so this must avoid it too rather than echoing the role enum directly.
const ROLE_TEST_SLUG = {
  CUSTOMER: 'customer',
  WORKER: 'ranger',
  EMPLOYER: 'employer',
  STUDENT: 'student',
} as const;

function SectionHeading({ title, icon }: { title: string; icon: keyof typeof Ionicons.glyphMap }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeading}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text variant="label" color="textMuted">
        {title}
      </Text>
    </View>
  );
}

export function AccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
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

  const go = (path: string) => () => router.push(path as never);

  return (
    <Screen scroll>
      <Card style={styles.profileCard}>
        <View style={styles.profileRow}>
          <Avatar name={user.fullName} />
          <View style={styles.profileDetails}>
            <Text variant="title" style={styles.profileName}>
              {user.fullName ?? t('account.noName')}
            </Text>
            <Text color="textMuted">
              {t('account.signedInAs', { phone: formatIndianPhone(user.phone) })}
            </Text>
            <Text color="textMuted">{t('account.roles')}</Text>
            <View testID="roles" style={styles.roleBadges}>
              {user.roles.map((r) => (
                <Badge
                  key={r}
                  testID={`role-${ROLE_TEST_SLUG[r]}`}
                  tone={r === 'WORKER' ? 'accent' : 'neutral'}
                  label={t(ROLE_KEY[r])}
                />
              ))}
            </View>
          </View>
        </View>
      </Card>

      {message ? (
        <Card style={styles.messageCard}>
          <View style={styles.messageRow}>
            <Ionicons name="alert-circle-outline" size={21} color={colors.danger} />
            <Text color="danger" accessibilityRole="alert" style={styles.messageText}>
              {message}
            </Text>
          </View>
        </Card>
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
        <Card style={styles.promoCard}>
          <View style={styles.promoContent}>
            <View style={[styles.promoIcon, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="briefcase-outline" size={25} color={colors.primary} />
            </View>
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
        <Card style={styles.promoCard}>
          <View style={styles.promoContent}>
            <View style={[styles.promoIcon, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="business-outline" size={25} color={colors.primary} />
            </View>
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
        <Card style={styles.promoCard}>
          <View style={styles.promoContent}>
            <View style={[styles.promoIcon, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="school-outline" size={25} color={colors.primary} />
            </View>
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

      <View style={styles.section}>
        <SectionHeading title={t('account.sectionMarketplace')} icon="storefront-outline" />
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

      <View style={styles.section}>
        <SectionHeading title={t('account.sectionProfile')} icon="person-circle-outline" />
        <Card>
          <ListRow
            icon="person-outline"
            title={t('account.editProfile')}
            onPress={go('/profile')}
          />
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
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeading title={t('account.sectionAccount')} icon="settings-outline" />
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

const styles = StyleSheet.create({
  profileCard: {
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  profileDetails: { flex: 1, gap: spacing.sm },
  profileName: { fontSize: 23, lineHeight: 30 },
  roleBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  messageCard: { borderColor: '#B3261E' },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  messageText: { flex: 1 },
  promoCard: { borderRadius: radii.lg },
  promoContent: { gap: spacing.md },
  promoIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: spacing.sm },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
});
