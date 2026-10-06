import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ClientLeagueTier, LeagueTier } from '@haggler/shared';

interface SeenLeagues {
  worker?: LeagueTier;
  client?: ClientLeagueTier;
}

interface LeagueSeenState {
  /** Per user id, not global — switching accounts on one phone must never trigger a false popup
   * for the newly-signed-in person based on the previous account's league (Sub-phase 4, Part F). */
  seen: Record<string, SeenLeagues>;
  get: (userId: string) => SeenLeagues | undefined;
  set: (userId: string, next: SeenLeagues) => void;
}

/** Device-local only — purely a "have I shown this celebration yet" marker, nothing sensitive. */
export const useLeagueSeen = create<LeagueSeenState>()(
  persist(
    (set, get) => ({
      seen: {},
      get: (userId) => get().seen[userId],
      set: (userId, next) =>
        set((s) => ({ seen: { ...s.seen, [userId]: { ...s.seen[userId], ...next } } })),
    }),
    { name: 'haggler.league-seen.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
