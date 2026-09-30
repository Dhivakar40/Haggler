import Link from 'next/link';
import { api } from '../../../lib/api';
import { cancelListingAction } from '../../actions';

interface ListingItem {
  id: string;
  title: string;
  businessName: string;
  employerUserId: string;
  status: string;
  createdAt: string;
}

const TABS = [
  ['contract', 'Contract'],
  ['campus', 'Campus'],
] as const;

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string; cursor?: string; error?: string }>;
}) {
  const { q, cursor, kind, error } = await searchParams;
  const activeKind: 'contract' | 'campus' = kind === 'campus' ? 'campus' : 'contract';
  const query = new URLSearchParams({
    limit: '20',
    ...(q ? { q } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const endpoint = activeKind === 'contract' ? 'contract-listings' : 'campus-listings';
  const data = await api<{ items: ListingItem[]; nextCursor: string | null }>(
    `/v1/admin/${endpoint}?${query}`,
  );

  return (
    <>
      <h1>Listings</h1>
      <p className="muted">
        Browse and search by title. No report queue exists yet — this is manual moderation.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="tabs" role="tablist">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            className={`tab ${activeKind === value ? 'active' : ''}`}
            href={`/listings?kind=${value}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <form className="row" style={{ marginBottom: 16 }}>
        <input type="hidden" name="kind" value={activeKind} />
        <input type="text" name="q" placeholder="Search by title" defaultValue={q ?? ''} />
        <button type="submit" className="secondary">
          Search
        </button>
      </form>
      <div className="card">
        {data.items.length === 0 ? (
          <p className="muted">No listings.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Employer</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => {
                const cancel = cancelListingAction.bind(null, activeKind, i.id);
                const cancellable = ['OPEN', 'PAUSED', 'FILLED'].includes(i.status);
                return (
                  <tr key={i.id}>
                    <td>{i.title}</td>
                    <td>{i.businessName}</td>
                    <td>
                      <span className="badge">{i.status}</span>
                    </td>
                    <td>
                      {cancellable && (
                        <form action={cancel} className="row">
                          <input
                            name="reason"
                            placeholder="Reason (min 5 chars)"
                            minLength={5}
                            maxLength={500}
                            required
                          />
                          <button type="submit" className="danger">
                            Take down
                          </button>
                        </form>
                      )}
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
          <Link
            href={`/listings?kind=${activeKind}${q ? `&q=${encodeURIComponent(q)}` : ''}&cursor=${encodeURIComponent(
              data.nextCursor,
            )}`}
          >
            Next page →
          </Link>
        </p>
      )}
    </>
  );
}
