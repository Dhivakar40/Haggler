import { create } from 'zustand';

export interface ToastEvent {
  id: number;
  message: string;
  tone: 'default' | 'success' | 'danger';
}

interface ToastQueueState {
  queue: ToastEvent[];
  push: (message: string, tone?: ToastEvent['tone']) => void;
  shift: () => void;
}

let nextId = 1;

/** In-memory only, same reasoning as league-up-queue.ts: a toast queued but never shown because
 * the app was backgrounded is not worth persisting for — it was telling the user about something
 * that already happened and is reflected elsewhere (the screen that triggered it). */
export const useToastQueue = create<ToastQueueState>()((set) => ({
  queue: [],
  push: (message, tone = 'default') =>
    set((s) => ({ queue: [...s.queue, { id: nextId++, message, tone }] })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

/** The call site API: `showToast('Saved')` or `showToast('Could not save', 'danger')`. */
export function showToast(message: string, tone: ToastEvent['tone'] = 'default'): void {
  useToastQueue.getState().push(message, tone);
}
