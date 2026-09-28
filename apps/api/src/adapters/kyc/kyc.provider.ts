import { Injectable, Module } from '@nestjs/common';

export interface KycSubmission {
  checkId: string;
  userId: string;
  tier: 1 | 2;
}

export interface KycSubmitResult {
  /** Where the check goes next. A manual provider always answers PENDING_REVIEW. */
  status: 'PENDING_REVIEW';
  /** Vendor reference for vendor providers; null for manual review. */
  rawRef: string | null;
}

/**
 * The seam for identity verification (D-016). Today's only implementation hands the check to
 * a human admin. A vendor implementation (Aadhaar eKYC, face match, background check) would call
 * the vendor here and could answer with an immediate result, with no schema change.
 */
export interface KycProvider {
  readonly name: string;
  submit(input: KycSubmission): Promise<KycSubmitResult>;
}

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');

@Injectable()
export class ManualAdminKycProvider implements KycProvider {
  readonly name = 'manual_admin';

  async submit(): Promise<KycSubmitResult> {
    // Nothing to call: the check appears in the admin review queue.
    return { status: 'PENDING_REVIEW', rawRef: null };
  }
}

@Module({
  providers: [
    ManualAdminKycProvider,
    { provide: KYC_PROVIDER, useExisting: ManualAdminKycProvider },
  ],
  exports: [KYC_PROVIDER],
})
export class KycProviderModule {}
