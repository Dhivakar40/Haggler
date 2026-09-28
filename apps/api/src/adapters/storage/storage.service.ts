import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Module } from '@nestjs/common';
import { EnvService } from '../../config/env.service';

export interface PresignedUpload {
  url: string;
  method: 'PUT';
  /** The client MUST send exactly these headers, or the signature will not match. */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * S3-compatible storage (MinIO in dev, AWS S3 / Cloudflare R2 in production, same code).
 * Two clients: `internal` for server-side calls, `signer` builds URLs with the host phones can
 * reach (S3_PUBLIC_ENDPOINT), because "localhost" inside a URL means the phone itself.
 *
 * Why presigned URLs: the phone uploads straight to storage, so photos never pass through (and
 * never load) our API servers, and the URL expires in minutes.
 */
@Injectable()
export class StorageService {
  private readonly internal: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly envService: EnvService) {
    const e = envService.env;
    const base = {
      region: e.S3_REGION,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY },
    };
    this.internal = new S3Client({ ...base, endpoint: e.S3_ENDPOINT });
    this.signer = new S3Client({ ...base, endpoint: e.S3_PUBLIC_ENDPOINT ?? e.S3_ENDPOINT });
  }

  async presignUpload(input: {
    bucket: string;
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<PresignedUpload> {
    const expiresIn = input.expiresInSeconds ?? 300;
    const sse = this.envService.env.S3_SSE;
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: input.contentType,
      // Signing the exact length means the client cannot upload a bigger file than declared.
      ContentLength: input.sizeBytes,
      ...(sse ? { ServerSideEncryption: sse as 'AES256' } : {}),
    });
    const url = await getSignedUrl(this.signer, command, {
      expiresIn,
      // Make the signed headers explicit so we can tell the client what to send.
      unhoistableHeaders: new Set(['x-amz-server-side-encryption']),
    });
    const headers: Record<string, string> = { 'Content-Type': input.contentType };
    if (sse) headers['x-amz-server-side-encryption'] = sse;
    return { url, method: 'PUT', headers, expiresInSeconds: expiresIn };
  }

  presignDownload(bucket: string, key: string, expiresInSeconds = 60): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  /** Returns the object's size in bytes, or null if it does not exist. */
  async headSize(bucket: string, key: string): Promise<number | null> {
    try {
      const res = await this.internal.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return res.ContentLength ?? 0;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}

@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
