import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import i18n from '../../i18n';
import { iso, type MockCall, mockApi, renderWithProviders, signInAs } from '../../test-utils';
import { ChatScreen } from './ChatScreen';

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THREAD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';

const M1 = '55555555-1111-4111-8111-555555555555';
const M2 = '66666666-2222-4222-8222-666666666666';
const msg = (
  over: Partial<{
    id: string;
    senderId: string;
    body: string;
    clientMsgId: string;
    createdAt: string;
  }> = {},
) => ({
  id: M1,
  threadId: THREAD_ID,
  senderId: THEM,
  body: 'hello',
  clientMsgId: 'client-msg-1',
  createdAt: iso(-10_000),
  ...over,
});

/** A backend for one thread: GET returns the saved messages so far, POST appends one (REST fallback path). */
function serve(
  initial: ReturnType<typeof msg>[],
  over: { onSend?: (c: MockCall) => { status?: number } | undefined } = {},
) {
  let items = initial;
  let n = 0;
  const api = mockApi((c) => {
    if (c.path === `/v1/jobs/${JOB_ID}/thread`) return { body: { id: THREAD_ID, jobId: JOB_ID } };
    if (c.method === 'GET' && c.path.startsWith(`/v1/threads/${THREAD_ID}/messages`))
      return { body: { items, nextCursor: null } };
    if (c.method === 'POST' && c.path === `/v1/threads/${THREAD_ID}/messages`) {
      const bad = over.onSend?.(c);
      if (bad) return bad;
      n += 1;
      const body = c.body as { clientMsgId: string; body: string };
      const saved = msg({
        id: `77777777-0000-4000-8000-${String(n).padStart(12, '0')}`,
        senderId: ME,
        body: body.body,
        clientMsgId: body.clientMsgId,
        createdAt: iso(0),
      });
      items = [saved, ...items];
      return { body: saved };
    }
    return undefined;
  });
  return { ...api, items: () => items };
}

const mockSocketHolder: { current: { isConnected: jest.Mock; emitWithAck: jest.Mock } | null } = {
  current: null,
};
jest.mock('../../realtime/RealtimeProvider', () => ({
  useRealtime: () => mockSocketHolder.current,
}));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  mockSocketHolder.current = null;
  (useLocalSearchParams as jest.Mock).mockReturnValue({ jobId: JOB_ID });
  signInAs({ id: ME } as never);
});

describe('ChatScreen', () => {
  it('shows an error state when the thread cannot be loaded', async () => {
    mockApi(() => ({ status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }));
    await renderWithProviders(<ChatScreen />);
    expect(await screen.findByText('Could not load this. Check your connection.')).toBeTruthy();
  });

  it('shows an empty state with no messages yet', async () => {
    serve([]);
    await renderWithProviders(<ChatScreen />);
    expect(await screen.findByText('Say hello to get started.')).toBeTruthy();
  });

  it('shows saved messages, my own on one side and theirs on the other', async () => {
    serve([
      msg({ id: M1, senderId: THEM, body: 'Hi, is the fan still sparking?' }),
      msg({ id: M2, senderId: ME, body: 'Yes, please come.' }),
    ]);
    await renderWithProviders(<ChatScreen />);
    expect(await screen.findByTestId(`msg-${M1}`)).toHaveTextContent(
      'Hi, is the fan still sparking?',
    );
    expect(screen.getByTestId(`msg-${M2}`)).toHaveTextContent('Yes, please come.');
  });

  it('Send is off for an empty or whitespace-only message', async () => {
    serve([]);
    await renderWithProviders(<ChatScreen />);
    const send = await screen.findByTestId('chat-send');
    expect(send.props.accessibilityState?.disabled ?? send.props.disabled).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('chat-input'), '   ');
    const stillOff = screen.getByTestId('chat-send');
    expect(stillOff.props.accessibilityState?.disabled ?? stillOff.props.disabled).toBeTruthy();
  });

  it('sending over REST (no live socket): appears immediately, then settles once saved, and clears the box', async () => {
    const { calls } = serve([]);
    await renderWithProviders(<ChatScreen />);
    await fireEvent.changeText(await screen.findByTestId('chat-input'), 'On my way in 10 minutes');
    await fireEvent.press(screen.getByTestId('chat-send'));
    expect(screen.getByTestId('chat-input').props.value).toBe('');
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.path === `/v1/threads/${THREAD_ID}/messages`),
      ).toBe(true),
    );
    const sent = calls.find((c) => c.method === 'POST')!;
    expect((sent.body as { body: string }).body).toBe('On my way in 10 minutes');
    expect((sent.body as { clientMsgId: string }).clientMsgId).toBe('test-device-uuid-0001'); // Crypto.randomUUID(), so a retry can be told apart from a new message
  });

  it('sends over the live socket when connected, and does not also send over REST', async () => {
    mockSocketHolder.current = {
      isConnected: jest.fn(() => true),
      emitWithAck: jest.fn(async () => ({ ok: true })),
    };
    const { calls } = serve([]);
    await renderWithProviders(<ChatScreen />);
    await fireEvent.changeText(await screen.findByTestId('chat-input'), 'Hello');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() =>
      expect(mockSocketHolder.current!.emitWithAck).toHaveBeenCalledWith(
        'chat.message',
        expect.objectContaining({ threadId: THREAD_ID, body: 'Hello' }),
      ),
    );
    expect(
      calls.some((c) => c.method === 'POST' && c.path === `/v1/threads/${THREAD_ID}/messages`),
    ).toBe(false);
  });

  it('falls back to REST when the socket ack fails', async () => {
    mockSocketHolder.current = {
      isConnected: jest.fn(() => true),
      emitWithAck: jest.fn(async () => {
        throw new Error('timed out');
      }),
    };
    const { calls } = serve([]);
    await renderWithProviders(<ChatScreen />);
    await fireEvent.changeText(await screen.findByTestId('chat-input'), 'Hello again');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.path === `/v1/threads/${THREAD_ID}/messages`),
      ).toBe(true),
    );
  });

  it('a message that fails to send can be tapped to retry, with the SAME clientMsgId (no duplicate)', async () => {
    let attempt = 0;
    const { calls } = serve([], {
      onSend: () =>
        attempt++ === 0
          ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }
          : undefined,
    });
    await renderWithProviders(<ChatScreen />);
    await fireEvent.changeText(await screen.findByTestId('chat-input'), 'Retry me');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await screen.findByText('Not sent. Tap to retry.');
    const firstCall = calls.find((c) => c.method === 'POST')!;
    const clientMsgId = (firstCall.body as { clientMsgId: string }).clientMsgId;
    await fireEvent.press(screen.getByTestId(`msg-pending-${clientMsgId}`));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').length).toBe(2));
    const secondCall = calls.filter((c) => c.method === 'POST')[1];
    expect((secondCall.body as { clientMsgId: string }).clientMsgId).toBe(
      (firstCall.body as { clientMsgId: string }).clientMsgId,
    );
    await waitFor(() => expect(screen.queryByText('Not sent. Tap to retry.')).toBeNull());
  });

  it('is translated (Tamil)', async () => {
    await i18n.changeLanguage('ta');
    serve([]);
    await renderWithProviders(<ChatScreen />);
    expect(await screen.findByTestId('chat-send')).toBeTruthy();
  });
});
