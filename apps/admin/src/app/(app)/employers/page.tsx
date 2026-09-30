import Link from 'next/link';
import { api } from '../../../lib/api';
import { verifyEmployerAction } from '../../actions';

interface QueueItem {
  employerId: string;
  userId: string;
  businessName: string;
  phone: string;
  createdAt: string;
}

function waiting(since: string): string {
  const mins = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  if (mins < 2880) return `${Math.floor(mins / 60)} h`;
  return `${Math.floor(mins / 1440)} days`;
}

export default async function EmployersPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; error?: string }>;
}) {
  const { cursor, error } = await searchParams;
  const q = new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) });
  const data = await api<{ items: QueueItem[]; nextCursor: string | null }>(
    `/v1/admin/employers/queue?${q}`,
  );

  return (
    <>
      <h1>Unverified employers</h1>
      <p className="muted">
        Confirms a business is real before its Campus listings can go live (Contract listings
        don&apos;t require this, D-056).
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="card">
        {data.items.length === 0 ? (
          <p className="muted">Nothing waiting.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Phone</th>
                <th>Waiting</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => {
                const verify = verifyEmployerAction.bind(null, i.employerId);
                return (
                  <tr key={i.employerId}>
                    <td>{i.businessName}</td>
                    <td>{i.phone}</td>
                    <td>{waiting(i.createdAt)}</td>
                    <td>
                      <form action={verify}>
                        <button type="submit">Verify</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {data.nextCursor && (
        <p>
          <Link href={`/employers?cursor=${encodeURIComponent(data.nextCursor)}`}>Next page →</Link>
        </p>
      )}
    </>
  );
}
