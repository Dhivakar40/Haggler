import { Stack } from 'expo-router';

// Open on the phone screen, not on whatever file sorts first.
export const unstable_settings = { initialRouteName: 'phone' };

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
