import Link from 'next/link';
import { api } from '../../../../lib/api';
import { decideAction } from '../../../actions';

interface Detail {
  id: string;
  tier: number;
  status: string;
  submittedAt: string;
  reviewerMessage: string | null;
  user: { fullName: string | null; phoneMasked: string };
  ranger: { kycTier: number; categorySlugs: string[] };
  documents: { id: string; type: string; contentType: string; url: string }[];
  reference: {
    name: string;
    phone: string;
    relationship: string;
    callOutcome: string;
    callNotes: string | null;
  } | null;
  reviews: { decision: string; reason: string | null; by: string; at: string }[];
}

const DOC_LABEL: Record<string, string> = {
  AADHAAR_FRONT: 'Aadhaar (front)',
  AADHAAR_BACK: 'Aadhaar (back)',
  SELFIE: 'Live selfie',
  ADDRESS_PROOF: 'Address proof',
};
// Compare the selfie with the Aadhaar photo: show ID first, selfie last, side by side.
const ORDER = ['AADHAAR_FRONT', 'AADHAAR_BACK', 'SELFIE', 'ADDRESS_PROOF'];

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const d = await api<Detail>(`/v1/admin/kyc/${id}`);
  const docs = [...d.documents].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  const pending = d.status === 'PENDING_REVIEW';
  const decide = decideAction.bind(null, d.id, d.tier);

  return (
    <>
      <p>
        <Link href="/kyc">← Back to queue</Link>
      </p>
      <h1>
        {d.tier === 1 ? 'Tier 1 · Identity' : 'Tier 2 · Go live'}{' '}
        <span className="badge">{d.status}</span>
      </h1>
      <p className="muted">
        {d.user.fullName ?? '(no name)'} · {d.user.phoneMasked} · Categories:{' '}
        {d.ranger.categorySlugs.join(', ') || 'none chosen'}
      </p>
      {d.reviewerMessage && (
        <p className="warning">Message sent to the Ranger: {d.reviewerMessage}</p>
      )}

      <h2>Documents</h2>
      <p className="muted">
        Links expire in 2 minutes and every view is logged. Reload to refresh. Aadhaar must be the{' '}
        <strong>masked</strong> copy; if you can see all 12 digits, ask for a masked copy (request
        more info).
      </p>
      <div className="images">
        {docs.map((doc) => (
          <figure key={doc.id}>
            <figcaption>{DOC_LABEL[doc.type] ?? doc.type}</figcaption>
            {doc.contentType === 'application/pdf' ? (
              <a href={doc.url} target="_blank" rel="noreferrer noopener">
                Open PDF
              </a>
            ) : (
              <img src={doc.url} alt={DOC_LABEL[doc.type] ?? doc.type} />
            )}
          </figure>
        ))}
      </div>

      {d.reference && (
        <>
          <h2>Professional reference</h2>
          <div className="card">
            <p>
              <strong>{d.reference.name}</strong> ({d.reference.relationship}) · {d.reference.phone}
            </p>
            <p className="muted">
              Call outcome: {d.reference.callOutcome}
              {d.reference.callNotes ? ` · ${d.reference.callNotes}` : ''}
            </p>
          </div>
        </>
      )}

      {d.reviews.length > 0 && (
        <>
          <h2>History</h2>
          <div className="card">
            {d.reviews.map((r, i) => (
              <p key={i}>
                {new Date(r.at).toLocaleString()} · <strong>{r.decision}</strong> by {r.by}
                {r.reason ? ` · ${r.reason}` : ''}
              </p>
            ))}
          </div>
        </>
      )}

      {pending ? (
        <>
          <h2>Decision</h2>
          <form action={decide} className="card">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {d.tier === 1 && (
              <>
                <p className="muted">
                  To approve, type these from the Aadhaar. Under-18s cannot be approved.
                </p>
                <label htmlFor="aadhaarLast4">Aadhaar last 4 digits</label>
                <input
                  id="aadhaarLast4"
                  name="aadhaarLast4"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]{4}"
                />
                <label htmlFor="dateOfBirth">Date of birth (as on Aadhaar)</label>
                <input id="dateOfBirth" name="dateOfBirth" type="date" />
              </>
            )}
            {d.tier === 2 && (
              <>
                <p className="muted">
                  Call the reference, then log the result. Approval needs outcome “Verified”.
                </p>
                <label htmlFor="callOutcome">Reference call outcome</label>
                <select id="callOutcome" name="callOutcome" defaultValue="">
                  <option value="">Not called yet</option>
                  <option value="VERIFIED">Verified</option>
                  <option value="NOT_REACHABLE">Not reachable</option>
                  <option value="NEGATIVE">Negative feedback</option>
                </select>
                <label htmlFor="callNotes">Call notes</label>
                <textarea id="callNotes" name="callNotes" rows={2} maxLength={500} />
              </>
            )}
            <label htmlFor="reason">
              Reason / message to the Ranger (required to reject or ask for more)
            </label>
            <textarea id="reason" name="reason" rows={3} maxLength={500} />
            <div className="row">
              <button type="submit" name="decision" value="APPROVE">
                Approve
              </button>
              <button type="submit" name="decision" value="REQUEST_INFO" className="secondary">
                Request more info
              </button>
              <button type="submit" name="decision" value="REJECT" className="danger">
                Reject
              </button>
            </div>
          </form>
        </>
      ) : (
        <p className="muted">This verification is not waiting for a decision.</p>
      )}
    </>
  );
}
