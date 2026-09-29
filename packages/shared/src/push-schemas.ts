import { z } from 'zod';

/** POST /me/push-token: registers or updates this device's Expo/FCM push token (Phase 5). */
export const registerPushTokenSchema = z.object({
  deviceId: z.string().min(1).max(200),
  pushToken: z.string().min(1).max(512),
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
