import Link from 'next/link';
import { api } from '../../../lib/api';
import { hideReviewAction } from '../../actions';

interface ReviewItem {
  id: string;
  jobId: string;
  raterRole: string;
  raterName: string | null;
  revieweeName: string | null;
  rating: number;
  comment: string | null;
  createdAt: string;
  hidden: boolean;
  hiddenReason: string | null;
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ revieweeId?: string; cursor?: string; error?: string }>;
}) {
  const { revieweeId, cursor, error } = await searchParams;
  const q = new URLSearchParams({
    limit: '20',
    ...(revieweeId ? { revieweeId } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const data = await api<{ items: ReviewItem[]; nextCursor: string | null }>(
    `/v1/admin/reviews?${q}`,
  );

  return (
    <>
      <h1>Reviews</h1>
      <p className="muted">
        Newest first, site-wide. Hiding a review reverses its rating out of the reviewee&apos;s
        stats immediately.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="card">
        {data.items.length === 0 ? (
          <p className="muted">No reviews.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Rating</th>
                <th>Comment</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => {
                const hide = hideReviewAction.bind(null, r.id);
                return (
                  <tr key={r.id}>
                    <td>
                      {r.raterName ?? <span className="muted">(no name)</span>} ({r.raterRole})
                    </td>
                    <td>{r.revieweeName ?? <span className="muted">(no name)</span>}</td>
                    <td>{r.rating} / 5</td>
                    <td>{r.comment ?? <span className="muted">—</span>}</td>
                    <td>
                      {r.hidden ? (
                        <span className="badge">
                          Hidden{r.hiddenReason ? `: ${r.hiddenReason}` : ''}
                        </span>
                      ) : (
                        <span className="muted">Visible</span>
                      )}
                    </td>
                    <td>
                      {!r.hidden && (
                        <form action={hide} className="row">
                          <input
                            name="reason"
                            placeholder="Reason (min 5 chars)"
                            minLength={5}
                            maxLength={500}
                            required
                          />
                          <button type="submit" className="danger">
                            Hide
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
            href={`/reviews?${revieweeId ? `revieweeId=${revieweeId}&` : ''}cursor=${encodeURIComponent(
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
