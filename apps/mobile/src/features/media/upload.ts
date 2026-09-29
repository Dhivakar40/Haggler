import {
  confirmJobPhoto,
  confirmRequestMedia,
  presignJobPhoto,
  presignRequestMedia,
} from '../../api/market';
import { compressImage, UploadError } from '../kyc/upload';

async function readBlob(uri: string): Promise<Blob> {
  try {
    return await (await fetch(uri)).blob();
  } catch {
    throw new UploadError('Could not read the file', 'read');
  }
}

async function put(
  url: string,
  method: string,
  headers: Record<string, string>,
  blob: Blob,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: blob });
  } catch {
    throw new UploadError('Network error during upload', 'put');
  }
  if (!res.ok) throw new UploadError(`Storage refused the upload (${res.status})`, 'put');
}

/** Photo (compressed) or voice note -> presign -> PUT to storage -> confirm. Returns the media id to attach to the request. */
export async function uploadRequestMedia(
  input:
    | { kind: 'PHOTO'; uri: string; width: number }
    | { kind: 'VOICE'; uri: string; durationSeconds: number },
): Promise<string> {
  const uri = input.kind === 'PHOTO' ? await compressImage(input.uri, input.width) : input.uri;
  const blob = await readBlob(uri);
  const presign = await presignRequestMedia({
    kind: input.kind,
    contentType: input.kind === 'PHOTO' ? 'image/jpeg' : 'audio/mp4',
    sizeBytes: blob.size,
    ...(input.kind === 'VOICE' ? { durationSeconds: input.durationSeconds } : {}),
  });
  await put(presign.uploadUrl, presign.method, presign.headers, blob);
  try {
    await confirmRequestMedia(presign.mediaId);
  } catch {
    throw new UploadError('Could not confirm the upload', 'confirm');
  }
  return presign.mediaId;
}

/** The Ranger's BEFORE / AFTER job photo. */
export async function uploadJobPhoto(
  jobId: string,
  kind: 'BEFORE' | 'AFTER',
  uri: string,
  width: number,
): Promise<void> {
  const blob = await readBlob(await compressImage(uri, width));
  const presign = await presignJobPhoto(jobId, {
    kind,
    contentType: 'image/jpeg',
    sizeBytes: blob.size,
  });
  await put(presign.uploadUrl, presign.method, presign.headers, blob);
  try {
    await confirmJobPhoto(jobId, presign.photoId);
  } catch {
    throw new UploadError('Could not confirm the upload', 'confirm');
  }
}
