import { create } from 'zustand';
import type { ClientLeagueTier, LeagueTier } from '@haggler/shared';

export interface LeagueUpEvent {
  kind: 'worker' | 'client';
  league: LeagueTier | ClientLeagueTier;
}

interface LeagueUpQueueState {
  queue: LeagueUpEvent[];
  push: (event: LeagueUpEvent) => void;
  shift: () => void;
}

/** In-memory only (Sub-phase 4, Part F): a celebration popup queued but never shown because the
 * app was killed first is not worth persisting for — the league itself is still correctly stored
 * server-side and in league-seen.ts either way, so nothing is lost, just the celebratory moment. */
export const useLeagueUpQueue = create<LeagueUpQueueState>()((set) => ({
  queue: [],
  push: (event) => set((s) => ({ queue: [...s.queue, event] })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}));
