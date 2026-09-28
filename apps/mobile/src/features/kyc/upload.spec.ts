import * as ImageManipulator from 'expo-image-manipulator';
import { mockApi, signInAs } from '../../test-utils';
import { compressImage, JPEG_QUALITY, MAX_IMAGE_SIDE, uploadKycDocument } from './upload';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri: `${uri}#compressed` })),
  SaveFormat: { JPEG: 'jpeg' },
}));

const presign = {
  documentId: '22222222-2222-4222-8222-222222222222',
  uploadUrl: 'http://storage.test/put/1',
  method: 'PUT',
  headers: { 'Content-Type': 'image/jpeg' },
  expiresInSeconds: 300,
};
const doc = { id: presign.documentId, type: 'SELFIE', status: 'UPLOADED' };
const input = {
  checkId: '33333333-3333-4333-8333-333333333333',
  type: 'SELFIE',
  uri: 'file:///photo.jpg',
  width: 3000,
};

beforeEach(() => {
  signInAs();
  (ImageManipulator.manipulateAsync as jest.Mock).mockClear();
});

describe('compressImage (low-bandwidth mode)', () => {
  it('shrinks big photos to 1600 px and re-encodes as JPEG at 70%', async () => {
    await compressImage('file:///big.jpg', 4000);
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      'file:///big.jpg',
      [{ resize: { width: MAX_IMAGE_SIDE } }],
      { compress: JPEG_QUALITY, format: 'jpeg' },
    );
  });
  it('does not upscale a small photo', async () => {
    await compressImage('file:///small.jpg', 800);
    expect((ImageManipulator.manipulateAsync as jest.Mock).mock.calls[0][1]).toEqual([]);
  });
});

describe('uploadKycDocument', () => {
  it('presigns with the REAL byte size, PUTs the compressed file to storage, then confirms, in that order', async () => {
    const { calls } = mockApi((c) => {
      if (c.path.startsWith('file:')) return { blobSize: 48213 };
      if (c.path === '/v1/kyc/documents') return { body: presign };
      if (c.path === '/put/1') return { status: 200 };
      if (c.path.endsWith('/confirm')) return { body: doc };
    });
    await uploadKycDocument(input);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET file:///photo.jpg#compressed',
      'POST /v1/kyc/documents',
      'PUT /put/1',
      `POST /v1/kyc/documents/${presign.documentId}/confirm`,
    ]);
    expect(calls[1]?.body).toEqual({
      checkId: input.checkId,
      type: 'SELFIE',
      contentType: 'image/jpeg',
      sizeBytes: 48213,
    });
    expect(calls[2]?.headers).toEqual({ 'Content-Type': 'image/jpeg' }); // exactly what the server told us to send
    expect(calls[2]?.headers.Authorization).toBeUndefined(); // storage gets no Haggler token
  });

  it('reports which stage failed', async () => {
    mockApi((c) =>
      c.path.startsWith('file:')
        ? { blobSize: 10 }
        : c.path === '/v1/kyc/documents'
          ? { body: presign }
          : { status: 403 },
    );
    await expect(uploadKycDocument(input)).rejects.toMatchObject({ stage: 'put' });

    mockApi((c) => {
      if (c.path.startsWith('file:')) return { blobSize: 10 };
      if (c.path === '/v1/kyc/documents') return { body: presign };
      if (c.path === '/put/1') return { status: 200 };
      return { status: 409, body: { error: { code: 'CONFLICT', message: 'not there' } } };
    });
    await expect(uploadKycDocument(input)).rejects.toMatchObject({ stage: 'confirm' });

    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('no file'));
    await expect(uploadKycDocument(input)).rejects.toMatchObject({ stage: 'read' });
  });

  it('a network drop during the PUT is an upload error, not a crash', async () => {
    let n = 0;
    (global as unknown as { fetch: unknown }).fetch = jest.fn(
      async (url: string): Promise<unknown> => {
        n += 1;
        if (url.startsWith('file:'))
          return { ok: true, status: 200, blob: async () => ({ size: 5 }), text: async () => '' };
        if (url.includes('/v1/kyc/documents'))
          return { ok: true, status: 200, text: async () => JSON.stringify(presign) };
        throw new TypeError('Network request failed');
      },
    );
    await expect(uploadKycDocument(input)).rejects.toMatchObject({
      name: 'UploadError',
      stage: 'put',
    });
    expect(n).toBe(3);
  });
});
