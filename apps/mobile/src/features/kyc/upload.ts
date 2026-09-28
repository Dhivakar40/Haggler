import * as ImageManipulator from 'expo-image-manipulator';
import { confirmKycDocument, presignKycDocument } from '../../api/endpoints';

/** Longest side after compression. Low-end phones on slow data: identity text stays readable. */
export const MAX_IMAGE_SIDE = 1600;
export const JPEG_QUALITY = 0.7;

/** Shrinks a photo before upload (low-bandwidth mode: fewer bytes, faster, cheaper for the user). */
export async function compressImage(uri: string, width: number): Promise<string> {
  const actions = width > MAX_IMAGE_SIDE ? [{ resize: { width: MAX_IMAGE_SIDE } }] : [];
  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly stage: 'read' | 'presign' | 'put' | 'confirm',
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * The 3-step upload: presign -> PUT straight to private storage -> confirm.
 * The declared size is signed into the URL, so it must equal the real byte length of the blob.
 */
export async function uploadKycDocument(input: {
  checkId: string;
  type: string;
  uri: string;
  width: number;
}): Promise<void> {
  let blob: Blob;
  try {
    const compressed = await compressImage(input.uri, input.width);
    blob = await (await fetch(compressed)).blob();
  } catch {
    throw new UploadError('Could not read the photo', 'read');
  }

  const contentType = 'image/jpeg';
  const presign = await presignKycDocument({
    checkId: input.checkId,
    type: input.type,
    contentType,
    sizeBytes: blob.size,
  });

  let put: Response;
  try {
    put = await fetch(presign.uploadUrl, {
      method: presign.method,
      headers: presign.headers,
      body: blob,
    });
  } catch {
    throw new UploadError('Network error during upload', 'put');
  }
  if (!put.ok) throw new UploadError(`Storage refused the upload (${put.status})`, 'put');

  try {
    await confirmKycDocument(presign.documentId);
  } catch {
    throw new UploadError('Could not confirm the upload', 'confirm');
  }
}
