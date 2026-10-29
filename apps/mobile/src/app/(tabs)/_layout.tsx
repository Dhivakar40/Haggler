import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../auth/session';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';

type TabIconProps = {
  name: keyof typeof Ionicons.glyphMap;
  activeName: keyof typeof Ionicons.glyphMap;
  color: ComponentProps<typeof Ionicons>['color'];
  focused: boolean;
};

function TabIcon({ name, activeName, color, focused }: TabIconProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.iconContainer, focused && { backgroundColor: colors.primary }]}>
      <Ionicons name={focused ? activeName : name} size={21} color={focused ? colors.onPrimary : color} />
    </View>
  );
}

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
          borderTopWidth: StyleSheet.hairlineWidth,
          minHeight: 70,
          paddingTop: 7,
          paddingBottom: 7,
        },
        tabBarItemStyle: { paddingVertical: 2 },
        // Reuses the label typography variant's own values rather than a parallel fontSize/weight
        // pair that could drift from it — React Navigation needs a plain style object here, not a
        // Text element, so this is the one place typography is read as raw values, not via <Text>.
        tabBarLabelStyle: {
          fontSize: typography.label.fontSize,
          fontFamily: typography.label.fontFamily,
          marginTop: 3,
          marginBottom: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="grid-outline" activeName="grid" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('tabs.activity'),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="time-outline" activeName="time" color={color} focused={focused} />
          ),
        }}
      />
      {/* Only Rangers see the Work tab. `href: null` hides it for everyone else. */}
      <Tabs.Screen
        name="work"
        options={{
          title: t('tabs.work'),
          href: isRanger ? undefined : null,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="briefcase-outline" activeName="briefcase" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('tabs.account'),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="person-outline" activeName="person" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="settings-outline" activeName="settings" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    width: 44,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
