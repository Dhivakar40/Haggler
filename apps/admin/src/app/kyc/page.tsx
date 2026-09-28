import Link from 'next/link';
import { api } from '../../lib/api';

interface QueueItem {
  id: string;
  tier: number;
  status: string;
  provider: string;
  submittedAt: string;
  user: { id: string; fullName: string | null; phoneMasked: string };
}

const STATUSES = [
  ['PENDING_REVIEW', 'Waiting for review'],
  ['NEEDS_INFO', 'Waiting for the Ranger'],
  ['APPROVED', 'Approved'],
  ['REJECTED', 'Rejected'],
] as const;

const TIER_LABEL: Record<number, string> = { 1: 'Tier 1 · Identity', 2: 'Tier 2 · Go live' };

function waiting(since: string): string {
  const mins = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  if (mins < 2880) return `${Math.floor(mins / 60)} h`;
  return `${Math.floor(mins / 1440)} days`;
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { status = 'PENDING_REVIEW', cursor } = await searchParams;
  const q = new URLSearchParams({ status, limit: '20', ...(cursor ? { cursor } : {}) });
  const data = await api<{ items: QueueItem[]; nextCursor: string | null }>(
    `/v1/admin/kyc/queue?${q}`,
  );

  return (
    <>
      <h1>KYC review queue</h1>
      <div className="tabs" role="tablist">
        {STATUSES.map(([value, label]) => (
          <Link
            key={value}
            className={`tab ${status === value ? 'active' : ''}`}
            href={`/kyc?status=${value}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <div className="card">
        {data.items.length === 0 ? (
          <p className="muted">Nothing here. </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ranger</th>
                <th>Phone</th>
                <th>Check</th>
                <th>Waiting</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.user.fullName ?? <span className="muted">(no name)</span>}</td>
                  <td>{i.user.phoneMasked}</td>
                  <td>{TIER_LABEL[i.tier] ?? `Tier ${i.tier}`}</td>
                  <td>{waiting(i.submittedAt)}</td>
                  <td>
                    <Link href={`/kyc/${i.id}`}>
                      {status === 'PENDING_REVIEW' ? 'Review' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data.nextCursor && (
        <p>
          <Link href={`/kyc?status=${status}&cursor=${encodeURIComponent(data.nextCursor)}`}>
            Next page →
          </Link>
        </p>
      )}
    </>
  );
}
