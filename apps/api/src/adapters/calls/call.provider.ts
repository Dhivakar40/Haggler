/**
 * Masked calling contract. INTERFACE ONLY: no implementation exists (D-019). The `call_sessions`
 * table is in place. When a vendor (e.g. Exotel) is added, implement this and bind it in a module;
 * `CALLS_MODE` is currently pinned to `disabled`.
 */
export interface CallProvider {
  /** Connects two parties through a virtual number so real numbers are never exposed. */
  createMaskedCall(input: {
    callerPhone: string;
    calleePhone: string;
    sessionId: string;
  }): Promise<{
    providerRef: string;
  }>;
}
