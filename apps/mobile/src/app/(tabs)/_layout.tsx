import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../auth/session';
import { useTheme } from '../../theme/ThemeProvider';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isRanger = useSession((s) => s.user?.roles.includes('WORKER') ?? false);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          minHeight: 60,
        },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('tabs.activity'),
          tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} />,
        }}
      />
      {/* Only Rangers see the Work tab. `href: null` hides it for everyone else. */}
      <Tabs.Screen
        name="work"
        options={{
          title: t('tabs.work'),
          href: isRanger ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="briefcase" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('tabs.account'),
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
