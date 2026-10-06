import { act, screen } from '@testing-library/react-native';
import { renderWithProviders } from '../test-utils';
import { showToast, useToastQueue } from '../store/toast-queue';
import { ToastHost } from './Toast';

beforeEach(() => {
  useToastQueue.setState({ queue: [] });
});

describe('ToastHost', () => {
  it('renders nothing when the queue is empty', async () => {
    await renderWithProviders(<ToastHost />);
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('shows a pushed toast, and auto-dismisses after its visible window', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      await renderWithProviders(<ToastHost />);
      await act(async () => {
        showToast('Saved');
      });
      expect(screen.getByText('Saved')).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(3200); // past VISIBLE_MS + the fade-out duration
      });
      expect(useToastQueue.getState().queue).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows a second toast only after the first has cleared, not stacked', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      await renderWithProviders(<ToastHost />);
      await act(async () => {
        showToast('First');
        showToast('Second');
      });
      expect(screen.getByText('First')).toBeTruthy();
      expect(screen.queryByText('Second')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(3200);
      });
      expect(screen.getByText('Second')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
