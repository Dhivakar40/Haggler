import { z } from 'zod';

/** POST /me/push-token: registers or updates this device's Expo/FCM push token (Phase 5). */
export const registerPushTokenSchema = z.object({
  deviceId: z.string().min(1).max(200),
  pushToken: z.string().min(1).max(512),
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;

/** DELETE /me/push-token: clears this device's push token (user turned notifications off). */
export const unregisterPushTokenSchema = z.object({
  deviceId: z.string().min(1).max(200),
});
export type UnregisterPushTokenInput = z.infer<typeof unregisterPushTokenSchema>;
