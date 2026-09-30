'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminApiError, api, TOKEN_COOKIE } from '../lib/api';
import { parseDecisionForm } from '../lib/decision-form';

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  try {
    const res = await api<{ accessToken: string; expiresInSeconds: number }>(
      '/v1/admin/auth/login',
      {
        method: 'POST',
        body: { email, password },
      },
    );
    (await cookies()).set(TOKEN_COOKIE, res.accessToken, {
      httpOnly: true, // page scripts can never read the token
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: res.expiresInSeconds,
    });
  } catch (err) {
    const msg = err instanceof AdminApiError ? err.message : 'Could not reach the server.';
    redirect(`/login?error=${encodeURIComponent(msg)}`);
  }
  redirect('/kyc');
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(TOKEN_COOKIE);
  redirect('/login');
}

export async function decideAction(id: string, tier: number, formData: FormData): Promise<void> {
  const parsed = parseDecisionForm(formData, tier);
  if (!parsed.ok) redirect(`/kyc/${id}?error=${encodeURIComponent(parsed.error)}`);
  try {
    await api(`/v1/admin/kyc/${id}/decision`, { method: 'POST', body: parsed.payload });
  } catch (err) {
    const msg = err instanceof AdminApiError ? err.message : 'Could not save the decision.';
    redirect(`/kyc/${id}?error=${encodeURIComponent(msg)}`);
  }
  redirect('/kyc');
}

// ---- Phase 8: admin moderation ---------------------------------------------------------

export async function verifyEmployerAction(employerId: string): Promise<void> {
  try {
    await api(`/v1/admin/employers/${employerId}/verify`, { method: 'POST' });
  } catch (err) {
    const msg = err instanceof AdminApiError ? err.message : 'Could not verify this employer.';
    redirect(`/employers?error=${encodeURIComponent(msg)}`);
  }
  redirect('/employers');
}

export async function hideReviewAction(reviewId: string, formData: FormData): Promise<void> {
  const reason = String(formData.get('reason') ?? '');
  try {
    await api(`/v1/admin/reviews/${reviewId}/hide`, { method: 'POST', body: { reason } });
  } catch (err) {
    const msg = err instanceof AdminApiError ? err.message : 'Could not hide this review.';
    redirect(`/reviews?error=${encodeURIComponent(msg)}`);
  }
  redirect('/reviews');
}

export async function cancelListingAction(
  kind: 'contract' | 'campus',
  listingId: string,
  formData: FormData,
): Promise<void> {
  const reason = String(formData.get('reason') ?? '');
  const path = kind === 'contract' ? 'contract-listings' : 'campus-listings';
  try {
    await api(`/v1/admin/${path}/${listingId}/cancel`, { method: 'POST', body: { reason } });
  } catch (err) {
    const msg = err instanceof AdminApiError ? err.message : 'Could not cancel this listing.';
    redirect(`/listings?error=${encodeURIComponent(msg)}`);
  }
  redirect('/listings');
}
