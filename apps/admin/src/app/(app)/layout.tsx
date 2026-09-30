import Link from 'next/link';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { logoutAction } from '../actions';

/** Every page under (app) requires a valid admin token; api() redirects to /login on 401. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await api<{ email: string; roles: string[] }>('/v1/admin/me');
  return (
    <>
      <header className="top">
        <nav>
          <strong>Haggler Admin</strong>
          <Link href="/kyc">KYC review</Link>
          <Link href="/employers">Employers</Link>
          <Link href="/reviews">Reviews</Link>
          <Link href="/listings">Listings</Link>
        </nav>
        <form action={logoutAction}>
          <span className="muted">
            {me.email} ({me.roles.join(', ')}){' '}
          </span>
          <button className="secondary" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}
