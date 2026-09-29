import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as ExpoAudio from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import i18n from '../../i18n';
import {
  iso,
  makeJob,
  mockApi,
  type MockCall,
  renderWithProviders,
  routerMock,
  signInAs,
} from '../../test-utils';
import { NewRequestScreen, scheduledIso } from './NewRequestScreen';
import { RequestStatusScreen } from './RequestStatusScreen';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri: `${uri}#c` })),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-audio', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over top-level imports
  const React = require('react');
  const recorder = {
    prepareToRecordAsync: jest.fn(),
    record: jest.fn(),
    stop: jest.fn(),
    uri: 'file:///voice.m4a',
  };
  const listeners = new Set<() => void>();
  let state = { isRecording: false, durationMillis: 0 };
  return {
    __recorder: recorder,
    __setState: (next: Partial<typeof state>) => {
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    AudioQuality: { MEDIUM: 'medium' },
    IOSOutputFormat: { MPEG4AAC: 'aac' },
    useAudioRecorder: () => recorder,
    // Reactive like the real hook: components re-render when the recorder state changes.
    useAudioRecorderState: () =>
      React.useSyncExternalStore(
        (l: () => void) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => state,
      ),
    requestRecordingPermissionsAsync: jest.fn(),
    setAudioModeAsync: jest.fn(),
  };
});

const picker = ImagePicker as unknown as Record<string, jest.Mock>;
const audio = ExpoAudio as unknown as {
  __recorder: Record<string, jest.Mock>;
  __setState: (s: { isRecording?: boolean; durationMillis?: number }) => void;
  requestRecordingPermissionsAsync: jest.Mock;
};

const addr = (over = {}) => ({
  id: '55555555-5555-4555-8555-555555555555',
  label: 'Home',
  line1: '12 Gandhi Road',
  line2: null,
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600042',
  isDefault: true,
  latitude: 12.97,
  longitude: 80.22,
  ...over,
});
const band = (over = {}) => ({
  categorySlug: 'electrician',
  scope: 'DEFAULT',
  minPaise: 19900,
  medianPaise: 34900,
  maxPaise: 69900,
  sampleSize: 0,
  isSeededDefault: true,
  ...over,
});
const MEDIA_ID = '99999999-9999-4999-8999-999999999999';

/** Fake backend for the new-request screen. */
function backend(
  over: {
    addresses?: object[];
    onCreate?: (c: MockCall) => { status?: number; body?: unknown };
  } = {},
) {
  let n = 0;
  return mockApi((c) => {
    if (c.path === '/v1/me/addresses') return { body: over.addresses ?? [addr()] };
    if (c.path.startsWith('/v1/price-bands')) return { body: band() };
    if (c.path.startsWith('file:')) return { blobSize: 1500 };
    if (c.path === '/v1/requests/media') {
      n += 1;
      return {
        body: {
          mediaId: `${MEDIA_ID.slice(0, -1)}${n}`,
          uploadUrl: `http://storage.test/put/${n}`,
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          expiresInSeconds: 300,
        },
      };
    }
    if (c.path.startsWith('/put/')) return { status: 200 };
    if (c.path.endsWith('/confirm')) return { body: { id: 'x' } };
    if (c.path === '/v1/requests' && c.method === 'POST')
      return over.onCreate?.(c) ?? { status: 201, body: makeJob() };
  });
}

const grantPicker = () => {
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
  picker.launchCameraAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///photo.jpg', width: 3000 }],
  });
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///gallery.jpg', width: 800 }],
  });
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  audio.__setState({ isRecording: false, durationMillis: 0 });
  audio.requestRecordingPermissionsAsync.mockResolvedValue({ granted: true });
  grantPicker();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ category: 'electrician' });
  signInAs();
});

describe('scheduledIso', () => {
  const now = new Date('2026-09-30T10:00:00Z');
  it('NOW has no schedule', () => expect(scheduledIso('NOW', now)).toBeUndefined());
  it('IN1H is comfortably over the 30-minute minimum', () => {
    expect(
      (new Date(scheduledIso('IN1H', now)!).getTime() - now.getTime()) / 60_000,
    ).toBeGreaterThan(60);
  });
  it('IN2H is two hours ahead', () =>
    expect(
      (new Date(scheduledIso('IN2H', now)!).getTime() - now.getTime()) / 3_600_000,
    ).toBeCloseTo(2, 1));
  it('TOMORROW is 9 am the next day (local time)', () => {
    const d = new Date(scheduledIso('TOMORROW', now)!);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
    expect(d.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('NewRequestScreen', () => {
  it('shows the category, the default address, and the real price band (flagged as an estimate when seeded)', async () => {
    backend();
    await renderWithProviders(<NewRequestScreen />);
    expect(await screen.findByText('Electrician')).toBeTruthy();
    expect(await screen.findByTestId('price-range')).toHaveTextContent('₹199 to ₹699');
    expect(screen.getByText('Typically ₹349')).toBeTruthy();
    expect(screen.getByText('Estimate only: not enough local jobs yet.')).toBeTruthy();
    expect(screen.getByTestId('address-Home').props.accessibilityState.selected).toBe(true);
  });

  it('does not call the estimate warning when the band is from real local data', async () => {
    mockApi((c) =>
      c.path === '/v1/me/addresses'
        ? { body: [addr()] }
        : { body: band({ scope: 'PINCODE_CLUSTER', isSeededDefault: false, sampleSize: 30 }) },
    );
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    expect(screen.queryByText('Estimate only: not enough local jobs yet.')).toBeNull();
  });

  it('a too-short description is refused before anything is sent', async () => {
    const { calls } = backend();
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    await fireEvent.changeText(screen.getByTestId('description'), 'fan');
    await fireEvent.press(screen.getByTestId('submit-request'));
    expect(
      await screen.findByText('Please describe the problem (at least 5 characters).'),
    ).toBeTruthy();
    expect(calls.some((c) => c.path === '/v1/requests' && c.method === 'POST')).toBe(false);
  });

  it('with no saved address it asks the person to add one', async () => {
    backend({ addresses: [] });
    await renderWithProviders(<NewRequestScreen />);
    expect(
      await screen.findByText('Add an address first so the Ranger knows where to go.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('add-address'));
    expect(routerMock().push).toHaveBeenCalledWith('/address-new');
  });

  it('an address without a location cannot be used', async () => {
    const { calls } = backend({ addresses: [addr({ latitude: null, longitude: null })] });
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    await fireEvent.changeText(screen.getByTestId('description'), 'Fan makes a loud noise');
    await fireEvent.press(screen.getByTestId('submit-request'));
    expect(
      await screen.findByText(
        'This address has no location. Add it again using "Use my current location".',
      ),
    ).toBeTruthy();
    expect(calls.some((c) => c.path === '/v1/requests' && c.method === 'POST')).toBe(false);
  });

  it('sends an immediate request with the chosen address and opens the waiting screen', async () => {
    const { calls } = backend({
      onCreate: () => ({
        status: 201,
        body: makeJob({ requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      }),
    });
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    await fireEvent.changeText(screen.getByTestId('description'), '  Fan makes a loud noise  ');
    await fireEvent.press(screen.getByTestId('submit-request'));
    await waitFor(() =>
      expect(routerMock().replace).toHaveBeenCalledWith({
        pathname: '/request/[id]',
        params: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      }),
    );
    expect(calls.find((c) => c.method === 'POST' && c.path === '/v1/requests')?.body).toEqual({
      categorySlug: 'electrician',
      description: 'Fan makes a loud noise',
      addressId: addr().id,
      urgency: 'IMMEDIATE',
      genderPreference: 'ANY',
      mediaIds: [],
    });
  });

  it('scheduling and the gender preference are sent as chosen', async () => {
    const { calls } = backend();
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    await fireEvent.changeText(screen.getByTestId('description'), 'Fan makes a loud noise');
    await fireEvent.press(screen.getByTestId('when-TOMORROW'));
    await fireEvent.press(screen.getByTestId('gender-FEMALE'));
    await fireEvent.press(screen.getByTestId('submit-request'));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/v1/requests' && c.method === 'POST')).toBe(true),
    );
    const body = calls.find((c) => c.path === '/v1/requests' && c.method === 'POST')?.body as {
      urgency: string;
      scheduledFor: string;
      genderPreference: string;
    };
    expect(body).toMatchObject({ urgency: 'SCHEDULED', genderPreference: 'FEMALE' });
    expect(new Date(body.scheduledFor).getHours()).toBe(9);
    expect(screen.getByText(/soft preference|This is a preference, not a promise/)).toBeTruthy();
  });

  it('photos are compressed and uploaded as they are added, and their ids are sent with the request', async () => {
    const { calls } = backend();
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    await fireEvent.press(screen.getByTestId('photo-camera'));
    await waitFor(() =>
      expect(screen.getByTestId('photo-0-status')).toHaveTextContent('1. Uploaded'),
    );
    await fireEvent.press(screen.getByTestId('photo-library'));
    await waitFor(() =>
      expect(screen.getByTestId('photo-1-status')).toHaveTextContent('2. Uploaded'),
    );
    expect(calls.filter((c) => c.path === '/v1/requests/media')[0]?.body).toMatchObject({
      kind: 'PHOTO',
      contentType: 'image/jpeg',
      sizeBytes: 1500,
    });
    expect(calls.some((c) => c.path.startsWith('file:') && c.path.endsWith('#c'))).toBe(true); // the COMPRESSED file was uploaded

    await fireEvent.changeText(screen.getByTestId('description'), 'Fan makes a loud noise');
    await fireEvent.press(screen.getByTestId('submit-request'));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/v1/requests' && c.method === 'POST')).toBe(true),
    );
    expect(
      (
        calls.find((c) => c.path === '/v1/requests' && c.method === 'POST')?.body as {
          mediaIds: string[];
        }
      ).mediaIds,
    ).toHaveLength(2);
  });

  it('a photo can be removed, and the limit is 5', async () => {
    backend();
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    for (let i = 0; i < 5; i++) {
      await fireEvent.press(screen.getByTestId('photo-camera'));
      await waitFor(() =>
        expect(screen.getByTestId(`photo-${i}-status`)).toHaveTextContent(`${i + 1}. Uploaded`),
      );
    }
    await fireEvent.press(screen.getByTestId('photo-camera'));
    expect(await screen.findByText('You can add up to 5 photos.')).toBeTruthy();
    expect(screen.queryByTestId('photo-5-status')).toBeNull();
    await fireEvent.press(screen.getByTestId('photo-0-remove'));
    expect(screen.queryByTestId('photo-4-status')).toBeNull();
  });

  it('a failed upload is shown and does not get attached', async () => {
    mockApi((c) => {
      if (c.path === '/v1/me/addresses') return { body: [addr()] };
      if (c.path.startsWith('/v1/price-bands')) return { body: band() };
      if (c.path.startsWith('file:')) return { blobSize: 1500 };
      if (c.path === '/v1/requests/media')
        return {
          body: {
            mediaId: MEDIA_ID,
            uploadUrl: 'http://storage.test/put/1',
            method: 'PUT',
            headers: {},
            expiresInSeconds: 300,
          },
        };
      return { status: 403 };
    });
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    await fireEvent.press(screen.getByTestId('photo-camera'));
    await waitFor(() =>
      expect(screen.getByTestId('photo-0-status')).toHaveTextContent(
        '1. Upload failed. Check your connection and try again.',
      ),
    );
  });

  it('camera permission denied: explained, nothing uploaded', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    const { calls } = backend();
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    await fireEvent.press(screen.getByTestId('photo-camera'));
    expect(
      await screen.findByText(
        'Camera or photo permission is off. Turn it on in your phone settings.',
      ),
    ).toBeTruthy();
    expect(calls.some((c) => c.path === '/v1/requests/media')).toBe(false);
  });

  it('records a voice note (max 60 s), shows its length, uploads it with the duration, and attaches it', async () => {
    const { calls } = backend();
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    await fireEvent.press(screen.getByTestId('voice-record'));
    await waitFor(() => expect(audio.__recorder.record).toHaveBeenCalled());
    expect(audio.__recorder.prepareToRecordAsync).toHaveBeenCalled();

    await act(async () => audio.__setState({ isRecording: true, durationMillis: 12_400 }));
    expect(await screen.findByTestId('voice-recording')).toHaveTextContent('Recording… 12s');
    await fireEvent.press(screen.getByTestId('voice-stop'));
    expect(await screen.findByTestId('voice-ready')).toHaveTextContent('Voice note ready (13s)');

    await fireEvent.changeText(screen.getByTestId('description'), 'Fan makes a loud noise');
    await fireEvent.press(screen.getByTestId('submit-request'));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/v1/requests' && c.method === 'POST')).toBe(true),
    );
    expect(calls.find((c) => c.path === '/v1/requests/media')?.body).toMatchObject({
      kind: 'VOICE',
      contentType: 'audio/mp4',
      durationSeconds: 13,
    });
    expect(
      (
        calls.find((c) => c.path === '/v1/requests' && c.method === 'POST')?.body as {
          mediaIds: string[];
        }
      ).mediaIds,
    ).toHaveLength(1);
  });

  it('microphone permission denied is explained', async () => {
    audio.requestRecordingPermissionsAsync.mockResolvedValue({ granted: false });
    backend();
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    await fireEvent.press(screen.getByTestId('voice-record'));
    expect(await screen.findByText('Microphone permission is off.')).toBeTruthy();
    expect(audio.__recorder.record).not.toHaveBeenCalled();
  });

  it('server rejections are shown in the user language (too many open requests)', async () => {
    backend({
      onCreate: () => ({
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'x', details: { code: 'TOO_MANY_OPEN' } } },
      }),
    });
    await renderWithProviders(<NewRequestScreen />);
    await screen.findByTestId('price-range');
    await fireEvent.changeText(screen.getByTestId('description'), 'Fan makes a loud noise');
    await fireEvent.press(screen.getByTestId('submit-request'));
    expect(await screen.findByText('You already have 3 open requests.')).toBeTruthy();
    expect(routerMock().replace).not.toHaveBeenCalled();
  });

  it('is translated (Hindi)', async () => {
    await i18n.changeLanguage('hi');
    backend();
    await renderWithProviders(<NewRequestScreen />);
    expect(await screen.findByText('रेंजर खोजें')).toBeTruthy();
  });
});

describe('RequestStatusScreen', () => {
  const REQ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  beforeEach(() => (useLocalSearchParams as jest.Mock).mockReturnValue({ id: REQ }));

  it('shows the live search: wave radius, countdown and the "usually accepted in ~N min" estimate', async () => {
    mockApi(() => ({
      body: makeJob({ broadcast: { wave: 2, deadline: iso(95_000), slaEstimateMinutes: 6 } }),
    }));
    await renderWithProviders(<RequestStatusScreen />);
    expect(await screen.findByTestId('finding')).toBeTruthy();
    expect(screen.getByText('Asking Rangers within 5 km')).toBeTruthy();
    expect(screen.getByTestId('sla')).toHaveTextContent('Usually accepted in about 6 min here');
    expect(screen.getByTestId('countdown').props.children).toMatch(/^1:3\d$|^1:4\d$|^1:35$/);
  });

  it('tells the customer when their gender preference cannot be met (and that matching continues)', async () => {
    mockApi(() => ({ body: makeJob({ genderPreference: 'FEMALE', genderPreferenceMet: false }) }));
    await renderWithProviders(<RequestStatusScreen />);
    expect(await screen.findByTestId('gender-unmet')).toHaveTextContent(
      'No female Ranger is nearby right now. We will match the nearest available Ranger.',
    );
  });

  it('does not show that note when the preference was met', async () => {
    mockApi(() => ({ body: makeJob({ genderPreference: 'FEMALE', genderPreferenceMet: true }) }));
    await renderWithProviders(<RequestStatusScreen />);
    await screen.findByTestId('finding');
    expect(screen.queryByTestId('gender-unmet')).toBeNull();
  });

  it('on timeout offers "Ask again" and "Cancel"; asking again restarts the search', async () => {
    let timedOut = true;
    const { calls } = mockApi((c) => {
      if (c.path.endsWith('/rebroadcast')) {
        timedOut = false;
        return {
          body: makeJob({ broadcast: { wave: 1, deadline: iso(180_000), slaEstimateMinutes: 4 } }),
        };
      }
      return {
        body: makeJob({
          broadcast: {
            wave: 3,
            deadline: timedOut ? iso(-5_000) : iso(180_000),
            slaEstimateMinutes: 4,
          },
        }),
      };
    });
    await renderWithProviders(<RequestStatusScreen />);
    expect(await screen.findByTestId('timed-out')).toHaveTextContent('No Ranger accepted yet.');
    expect(screen.getByText('You can ask again, or cancel.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rebroadcast'));
    await waitFor(() => expect(screen.getByTestId('finding')).toBeTruthy());
    expect(
      calls.some((c) => c.method === 'POST' && c.path === `/v1/requests/${REQ}/rebroadcast`),
    ).toBe(true);
    expect(screen.queryByTestId('rebroadcast')).toBeNull();
  });

  it('cancel asks first, then cancels and returns home', async () => {
    const { calls } = mockApi((c) =>
      c.path.endsWith('/cancel') ? { body: makeJob({ status: 'CANCELLED' }) } : { body: makeJob() },
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithProviders(<RequestStatusScreen />);
    await fireEvent.press(await screen.findByTestId('cancel-request'));
    expect(calls.some((c) => c.path.endsWith('/cancel'))).toBe(false); // not yet
    const buttons = alert.mock.calls[0]?.[2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Cancel request')?.onPress?.());
    await waitFor(() => expect(routerMock().replace).toHaveBeenCalledWith('/'));
    expect(calls.some((c) => c.method === 'POST' && c.path === `/v1/requests/${REQ}/cancel`)).toBe(
      true,
    );
  });

  it('as soon as a Ranger accepts it opens the job', async () => {
    mockApi(() => ({
      body: makeJob({
        status: 'MATCHED',
        worker: {
          id: '22222222-2222-4222-8222-222222222222',
          firstName: 'Ravi',
          kycTier: 2,
          badgeTier: 'BRONZE',
          jobsCompleted: 0,
          ratingAvg: null,
          ratingCount: 0,
        },
      }),
    }));
    await renderWithProviders(<RequestStatusScreen />);
    await waitFor(() =>
      expect(routerMock().replace).toHaveBeenCalledWith({
        pathname: '/job/[id]',
        params: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      }),
    );
  });

  it('a scheduled request explains it will start later', async () => {
    mockApi(() => ({
      body: makeJob({
        status: 'REQUESTED',
        urgency: 'SCHEDULED',
        scheduledFor: iso(5 * 3_600_000),
        broadcast: { wave: 0, deadline: null, slaEstimateMinutes: 4 },
      }),
    }));
    await renderWithProviders(<RequestStatusScreen />);
    expect(await screen.findByTestId('scheduled')).toHaveTextContent(
      /We will start looking shortly before/,
    );
  });

  it('a cancelled request says so', async () => {
    mockApi(() => ({ body: makeJob({ status: 'CANCELLED' }) }));
    await renderWithProviders(<RequestStatusScreen />);
    expect(await screen.findByText('This request was cancelled.')).toBeTruthy();
  });

  it('a network failure offers a retry', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('offline'));
    await renderWithProviders(<RequestStatusScreen />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
