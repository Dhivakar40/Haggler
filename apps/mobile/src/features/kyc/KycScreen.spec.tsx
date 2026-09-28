import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import i18n from '../../i18n';
import {
  makeMe,
  mockApi,
  renderWithProviders,
  routerMock,
  signInAs,
  type Handler,
} from '../../test-utils';
import { KycScreen } from './KycScreen';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  CameraType: { front: 'front', back: 'back' },
}));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri: `${uri}#c` })),
  SaveFormat: { JPEG: 'jpeg' },
}));

const picker = ImagePicker as unknown as Record<string, jest.Mock>;
const CHECK_ID = '33333333-3333-4333-8333-333333333333';
const DOC_ID = '44444444-4444-4444-8444-444444444444';

/** A tiny fake KYC backend: remembers which document types have been confirmed. */
function backend(tier: 1 | 2, opts: { submit?: Handler } = {}) {
  const uploaded = new Set<string>();
  const required = tier === 1 ? ['AADHAAR_FRONT', 'AADHAAR_BACK', 'SELFIE'] : ['ADDRESS_PROOF'];
  let lastType = '';
  const check = (status = 'DRAFT') => ({
    id: CHECK_ID,
    tier,
    status,
    reviewerMessage: null,
    submittedAt: null,
    decidedAt: null,
    requiredDocuments: required,
    documents: [...uploaded].map((type) => ({ id: DOC_ID, type, status: 'UPLOADED' })),
  });
  const api = mockApi((c) => {
    if (c.path.startsWith('file:')) return { blobSize: 1234 };
    if (c.path === '/v1/kyc/start') return { body: check() };
    if (c.path === '/v1/kyc/documents') {
      lastType = (c.body as { type: string }).type;
      return {
        body: {
          documentId: DOC_ID,
          uploadUrl: 'http://storage.test/put/1',
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          expiresInSeconds: 300,
        },
      };
    }
    if (c.path === '/put/1') return { status: 200 };
    if (c.path === `/v1/kyc/documents/${DOC_ID}/confirm`) {
      uploaded.add(lastType);
      return { body: { id: DOC_ID, type: lastType, status: 'UPLOADED' } };
    }
    if (c.path === '/v1/kyc/submit') return opts.submit?.(c) ?? { body: check('PENDING_REVIEW') };
  });
  return { ...api, uploaded };
}

const grantAll = () => {
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
  picker.launchCameraAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///photo.jpg', width: 3000 }],
  });
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///gallery.jpg', width: 900 }],
  });
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  routerMock().back.mockClear();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ tier: '1' });
  signInAs({ roles: ['CUSTOMER', 'WORKER'], missingConsents: [] });
  grantAll();
});

describe('consent gate (DPDP)', () => {
  it('asks for KYC consent BEFORE opening a check or uploading anything', async () => {
    signInAs({ roles: ['CUSTOMER', 'WORKER'], missingConsents: ['KYC_PROCESSING'] });
    const { calls } = mockApi((c) => {
      if (c.path === '/v1/me/consents') return { status: 201, body: { purpose: 'KYC_PROCESSING' } };
      if (c.path === '/v1/me')
        return { body: makeMe({ roles: ['CUSTOMER', 'WORKER'], missingConsents: [] }) };
      if (c.path === '/v1/kyc/start')
        return {
          body: {
            id: CHECK_ID,
            tier: 1,
            status: 'DRAFT',
            reviewerMessage: null,
            submittedAt: null,
            decidedAt: null,
            requiredDocuments: ['AADHAAR_FRONT', 'AADHAAR_BACK', 'SELFIE'],
            documents: [],
          },
        };
    });
    await renderWithProviders(<KycScreen />);
    expect(screen.getByText(/deleted 30 days after the decision/)).toBeTruthy();
    expect(calls).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('kyc-consent'));
    expect(await screen.findByTestId('doc-SELFIE')).toBeTruthy();
    expect(calls.map((c) => c.path)).toEqual(['/v1/me/consents', '/v1/me', '/v1/kyc/start']);
  });
});

describe('tier 1: Aadhaar photos + live selfie', () => {
  it('lists the three documents and warns to upload the MASKED Aadhaar', async () => {
    backend(1);
    await renderWithProviders(<KycScreen />);
    for (const t of ['Aadhaar card (front)', 'Aadhaar card (back)', 'Live selfie'])
      expect(await screen.findByText(t)).toBeTruthy();
    expect(screen.getByText(/MASKED Aadhaar/)).toBeTruthy();
  });

  it('the selfie can only come from the camera (front), never the gallery', async () => {
    backend(1);
    await renderWithProviders(<KycScreen />);
    await screen.findByTestId('doc-SELFIE');
    expect(screen.queryByTestId('library-SELFIE')).toBeNull();
    expect(screen.getByTestId('library-AADHAAR_FRONT')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('camera-SELFIE'));
    await waitFor(() =>
      expect(picker.launchCameraAsync).toHaveBeenCalledWith(
        expect.objectContaining({ cameraType: 'front' }),
      ),
    );
  });

  it('uploads a photo end to end and then shows it as Uploaded', async () => {
    const { calls } = backend(1);
    await renderWithProviders(<KycScreen />);
    await screen.findByTestId('doc-AADHAAR_FRONT');
    await fireEvent.press(screen.getByTestId('camera-AADHAAR_FRONT'));
    await waitFor(() =>
      expect(screen.getByTestId('doc-AADHAAR_FRONT-status').props.children).toBe('Uploaded'),
    );
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /v1/kyc/start',
      'GET file:///photo.jpg#c',
      'POST /v1/kyc/documents',
      'PUT /put/1',
      `POST /v1/kyc/documents/${DOC_ID}/confirm`,
      'POST /v1/kyc/start', // reload: the same open check comes back with the document listed
    ]);
    expect(calls[2]?.body).toEqual({
      checkId: CHECK_ID,
      type: 'AADHAAR_FRONT',
      contentType: 'image/jpeg',
      sizeBytes: 1234,
    });
    expect(screen.getByTestId('doc-AADHAAR_BACK-status').props.children).toBe('Not added yet');
  });

  it('a gallery photo works for Aadhaar too', async () => {
    const { uploaded } = backend(1);
    await renderWithProviders(<KycScreen />);
    await screen.findByTestId('doc-AADHAAR_BACK');
    await fireEvent.press(screen.getByTestId('library-AADHAAR_BACK'));
    await waitFor(() => expect(uploaded.has('AADHAAR_BACK')).toBe(true));
  });

  it('camera permission denied: explains, and uploads nothing', async () => {
    const { calls } = backend(1);
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    await renderWithProviders(<KycScreen />);
    await screen.findByTestId('doc-SELFIE');
    await fireEvent.press(screen.getByTestId('camera-SELFIE'));
    expect(
      await screen.findByText(
        'Camera or photo permission is off. Turn it on in your phone settings.',
      ),
    ).toBeTruthy();
    expect(calls.filter((c) => c.path === '/v1/kyc/documents')).toHaveLength(0);
  });

  it('cancelling the camera does nothing', async () => {
    const { calls } = backend(1);
    picker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null });
    await renderWithProviders(<KycScreen />);
    await screen.findByTestId('doc-SELFIE');
    await fireEvent.press(screen.getByTestId('camera-SELFIE'));
    await waitFor(() => expect(picker.launchCameraAsync).toHaveBeenCalled());
    expect(calls.filter((c) => c.path === '/v1/kyc/documents')).toHaveLength(0);
  });

  it('a failed upload shows a retry-able message', async () => {
    mockApi((c) => {
      if (c.path === '/v1/kyc/start')
        return {
          body: {
            id: CHECK_ID,
            tier: 1,
            status: 'DRAFT',
            reviewerMessage: null,
            submittedAt: null,
            decidedAt: null,
            requiredDocuments: ['AADHAAR_FRONT', 'AADHAAR_BACK', 'SELFIE'],
            documents: [],
          },
        };
      if (c.path.startsWith('file:')) return { blobSize: 10 };
      if (c.path === '/v1/kyc/documents')
        return {
          body: {
            documentId: DOC_ID,
            uploadUrl: 'http://storage.test/put/1',
            method: 'PUT',
            headers: {},
            expiresInSeconds: 300,
          },
        };
      return { status: 403 };
    });
    await renderWithProviders(<KycScreen />);
    await screen.findByTestId('doc-SELFIE');
    await fireEvent.press(screen.getByTestId('camera-SELFIE'));
    expect(
      await screen.findByText('Upload failed. Check your connection and try again.'),
    ).toBeTruthy();
    expect(screen.getByTestId('doc-SELFIE-status').props.children).toBe('Not added yet');
  });

  it('submit is refused until every document is uploaded; then it submits and goes back', async () => {
    const { calls, uploaded } = backend(1);
    await renderWithProviders(<KycScreen />);
    await screen.findByTestId('kyc-submit');
    await fireEvent.press(screen.getByTestId('kyc-submit'));
    expect(await screen.findByText('Add all documents first.')).toBeTruthy();
    expect(calls.some((c) => c.path === '/v1/kyc/submit')).toBe(false);

    for (const type of ['AADHAAR_FRONT', 'AADHAAR_BACK', 'SELFIE']) {
      await fireEvent.press(screen.getByTestId(`camera-${type}`));
      await waitFor(() => expect(uploaded.has(type)).toBe(true));
      await waitFor(() =>
        expect(screen.getByTestId(`doc-${type}-status`).props.children).toBe('Uploaded'),
      );
    }
    await fireEvent.press(screen.getByTestId('kyc-submit'));
    await waitFor(() => expect(routerMock().back).toHaveBeenCalled());
    expect(calls.find((c) => c.path === '/v1/kyc/submit')?.body).toEqual({ checkId: CHECK_ID });
  });

  it('shows the reviewer message when more information was requested', async () => {
    mockApi((c) =>
      c.path === '/v1/kyc/start'
        ? {
            body: {
              id: CHECK_ID,
              tier: 1,
              status: 'NEEDS_INFO',
              reviewerMessage: 'Selfie is blurry, please retake.',
              submittedAt: null,
              decidedAt: null,
              requiredDocuments: ['SELFIE'],
              documents: [],
            },
          }
        : undefined,
    );
    await renderWithProviders(<KycScreen />);
    expect(await screen.findByText('Selfie is blurry, please retake.')).toBeTruthy();
    expect(screen.getByTestId('camera-SELFIE')).toBeTruthy(); // editable again
  });

  it('a check already waiting for review is read-only', async () => {
    mockApi((c) =>
      c.path === '/v1/kyc/start'
        ? {
            body: {
              id: CHECK_ID,
              tier: 1,
              status: 'PENDING_REVIEW',
              reviewerMessage: null,
              submittedAt: '2026-09-28T10:00:00Z',
              decidedAt: null,
              requiredDocuments: ['SELFIE'],
              documents: [{ id: DOC_ID, type: 'SELFIE', status: 'UPLOADED' }],
            },
          }
        : undefined,
    );
    await renderWithProviders(<KycScreen />);
    await screen.findByTestId('doc-SELFIE');
    expect(screen.queryByTestId('camera-SELFIE')).toBeNull();
    expect(screen.queryByTestId('kyc-submit')).toBeNull();
  });
});

describe('tier 2: address proof + reference', () => {
  beforeEach(() => (useLocalSearchParams as jest.Mock).mockReturnValue({ tier: '2' }));

  async function withProofUploaded(submit?: Handler) {
    const be = backend(2, { submit });
    await renderWithProviders(<KycScreen />);
    await screen.findByTestId('doc-ADDRESS_PROOF');
    await fireEvent.press(screen.getByTestId('library-ADDRESS_PROOF'));
    await waitFor(() =>
      expect(screen.getByTestId('doc-ADDRESS_PROOF-status').props.children).toBe('Uploaded'),
    );
    return be;
  }

  it('asks for a reference and refuses an invalid one', async () => {
    const { calls } = await withProofUploaded();
    await fireEvent.changeText(screen.getByTestId('ref-name'), 'S');
    await fireEvent.press(screen.getByTestId('kyc-submit'));
    expect(
      await screen.findByText('Enter a name, a 10-digit mobile number and the relationship.'),
    ).toBeTruthy();
    expect(calls.some((c) => c.path === '/v1/kyc/submit')).toBe(false);
  });

  it('submits the reference with a normalised phone number', async () => {
    const { calls } = await withProofUploaded();
    await fireEvent.changeText(screen.getByTestId('ref-name'), 'Suresh Iyer');
    await fireEvent.changeText(screen.getByTestId('ref-phone'), '98450 12345');
    await fireEvent.changeText(screen.getByTestId('ref-relationship'), 'Former employer');
    await fireEvent.press(screen.getByTestId('kyc-submit'));
    await waitFor(() => expect(routerMock().back).toHaveBeenCalled());
    expect(calls.find((c) => c.path === '/v1/kyc/submit')?.body).toEqual({
      checkId: CHECK_ID,
      reference: { name: 'Suresh Iyer', phone: '+919845012345', relationship: 'Former employer' },
    });
  });

  it('tells the Ranger to choose their categories when the server says they are missing', async () => {
    await withProofUploaded(() => ({
      status: 422,
      body: {
        error: { code: 'UNPROCESSABLE', message: 'x', details: { missing: ['categories'] } },
      },
    }));
    await fireEvent.changeText(screen.getByTestId('ref-name'), 'Suresh Iyer');
    await fireEvent.changeText(screen.getByTestId('ref-phone'), '9845012345');
    await fireEvent.changeText(screen.getByTestId('ref-relationship'), 'Former employer');
    await fireEvent.press(screen.getByTestId('kyc-submit'));
    expect(await screen.findByText('Choose the work you do first.')).toBeTruthy();
    expect(routerMock().back).not.toHaveBeenCalled();
  });
});
