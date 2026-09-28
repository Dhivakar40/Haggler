import { randomBytes } from 'node:crypto';
import { LEGAL_VERSION } from '@haggler/shared';
import { KycService } from '../src/kyc/kyc.service';
import { StorageService } from '../src/adapters/storage/storage.service';
import { type Harness, KYC_BUCKET, startHarness } from './harness';
import { Api, type Session } from './helpers';

let h: Harness;
let api: Api;
let reviewer: { id: string; email: string; password: string };
let reviewerToken: string;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h.app);
  reviewer = await api.createAdmin(['KYC_REVIEWER']);
  reviewerToken = await api.adminToken(reviewer);
});
afterAll(async () => {
  await h?.stop();
});

/** A Ranger who is signed in, has the Ranger role, and has consented to KYC processing. */
async function newRanger(consent = true): Promise<Session> {
  const s = await api.signIn();
  await api.post(s, '/v1/me/roles', { role: 'WORKER' }).expect(201);
  if (consent)
    await api
      .post(s, '/v1/me/consents', { purpose: 'KYC_PROCESSING', version: LEGAL_VERSION })
      .expect(201);
  return s;
}

const png = (size = 2048) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), randomBytes(size - 4)]);

/** The full 3-step upload the phone performs: presign -> PUT to storage -> confirm. */
async function upload(
  s: Session,
  checkId: string,
  type: string,
  body: Buffer,
  contentType = 'image/png',
) {
  const p = await api
    .post(s, '/v1/kyc/documents', { checkId, type, contentType, sizeBytes: body.length })
    .expect(200);
  const put = await fetch(p.body.uploadUrl, { method: 'PUT', headers: p.body.headers, body });
  expect(put.status).toBe(200);
  await api.post(s, `/v1/kyc/documents/${p.body.documentId}/confirm`).expect(200);
  return p.body.documentId as string;
}

async function tier1Submitted(s?: Session) {
  const ranger = s ?? (await newRanger());
  const check = (await api.post(ranger, '/v1/kyc/start', { tier: 1 }).expect(200)).body;
  const files = { AADHAAR_FRONT: png(), AADHAAR_BACK: png(), SELFIE: png() };
  for (const [type, body] of Object.entries(files)) await upload(ranger, check.id, type, body);
  await api.post(ranger, '/v1/kyc/submit', { checkId: check.id }).expect(200);
  return { ranger, checkId: check.id as string, files };
}

const goodDecision = { decision: 'APPROVE', aadhaarLast4: '4821', dateOfBirth: '1995-06-14' };

describe('starting verification', () => {
  it('is for Rangers only (customers get 403)', async () => {
    const customer = await api.signIn();
    await api.post(customer, '/v1/kyc/start', { tier: 1 }).expect(403);
  });

  it('needs explicit consent first (DPDP)', async () => {
    const s = await newRanger(false);
    const res = await api.post(s, '/v1/kyc/start', { tier: 1 }).expect(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    expect(res.body.error.details).toMatchObject({
      purpose: 'KYC_PROCESSING',
      version: LEGAL_VERSION,
    });
  });

  it('opens one check per tier and is idempotent', async () => {
    const s = await newRanger();
    const a = await api.post(s, '/v1/kyc/start', { tier: 1 }).expect(200);
    expect(a.body).toMatchObject({
      tier: 1,
      status: 'DRAFT',
      requiredDocuments: ['AADHAAR_FRONT', 'AADHAAR_BACK', 'SELFIE'],
      documents: [],
    });
    const b = await api.post(s, '/v1/kyc/start', { tier: 1 }).expect(200);
    expect(b.body.id).toBe(a.body.id);
    const [c, d] = await Promise.all([
      api.post(s, '/v1/kyc/start', { tier: 1 }),
      api.post(s, '/v1/kyc/start', { tier: 1 }),
    ]);
    expect([c.body.id, d.body.id]).toEqual([a.body.id, a.body.id]);
    expect(await api.prisma().kycCheck.count({ where: { userId: s.userId } })).toBe(1);
    const row = await api.prisma().kycCheck.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(row.provider).toBe('manual_admin');
  });

  it('tier 2 needs tier 1 first', async () => {
    const s = await newRanger();
    await api.post(s, '/v1/kyc/start', { tier: 2 }).expect(422);
    await api.post(s, '/v1/kyc/start', { tier: 3 }).expect(400);
  });
});

describe('document uploads (presigned, private bucket)', () => {
  let s: Session;
  let checkId: string;
  beforeAll(async () => {
    s = await newRanger();
    checkId = (await api.post(s, '/v1/kyc/start', { tier: 1 })).body.id;
  });

  it('rejects the wrong document type, wrong mime, zero and oversize files', async () => {
    const base = { checkId, contentType: 'image/png', sizeBytes: 1000 };
    await api.post(s, '/v1/kyc/documents', { ...base, type: 'ADDRESS_PROOF' }).expect(422);
    await api
      .post(s, '/v1/kyc/documents', { ...base, type: 'SELFIE', contentType: 'application/pdf' })
      .expect(422);
    await api
      .post(s, '/v1/kyc/documents', { ...base, type: 'SELFIE', contentType: 'image/svg+xml' })
      .expect(422);
    await api.post(s, '/v1/kyc/documents', { ...base, type: 'SELFIE', sizeBytes: 0 }).expect(400);
    await api
      .post(s, '/v1/kyc/documents', { ...base, type: 'SELFIE', sizeBytes: 9 * 1024 * 1024 })
      .expect(400);
    await api
      .post(s, '/v1/kyc/documents', { ...base, type: 'SELFIE', checkId: 'not-a-uuid' })
      .expect(400);
  });

  it('nobody else can upload to my check (404, no leak)', async () => {
    const other = await newRanger();
    await api
      .post(other, '/v1/kyc/documents', {
        checkId,
        type: 'SELFIE',
        contentType: 'image/png',
        sizeBytes: 1000,
      })
      .expect(404);
  });

  it('uploads straight to storage, lands under my user id, and only confirms once the file exists', async () => {
    const body = png();
    const p = await api
      .post(s, '/v1/kyc/documents', {
        checkId,
        type: 'AADHAAR_FRONT',
        contentType: 'image/png',
        sizeBytes: body.length,
      })
      .expect(200);
    expect(p.body.method).toBe('PUT');
    expect(p.body.expiresInSeconds).toBe(300);
    expect(p.body.uploadUrl).toContain(`/${KYC_BUCKET}/kyc/${s.userId}/${checkId}/AADHAAR_FRONT-`);

    // Confirming before the upload happened fails: the server checks storage, not the phone's word.
    await api.post(s, `/v1/kyc/documents/${p.body.documentId}/confirm`).expect(409);

    const put = await fetch(p.body.uploadUrl, { method: 'PUT', headers: p.body.headers, body });
    expect(put.status).toBe(200);
    const ok = await api.post(s, `/v1/kyc/documents/${p.body.documentId}/confirm`).expect(200);
    expect(ok.body).toMatchObject({ type: 'AADHAAR_FRONT', status: 'UPLOADED' });
    expect(
      await h.app
        .get(StorageService)
        .headSize(
          KYC_BUCKET,
          (await api.prisma().kycDocument.findUniqueOrThrow({ where: { id: p.body.documentId } }))
            .storageKey,
        ),
    ).toBe(body.length);
  });

  it('the presigned URL is signed for the declared size: a bigger upload is refused by storage', async () => {
    const p = await api
      .post(s, '/v1/kyc/documents', {
        checkId,
        type: 'AADHAAR_BACK',
        contentType: 'image/png',
        sizeBytes: 1000,
      })
      .expect(200);
    const tooBig = await fetch(p.body.uploadUrl, {
      method: 'PUT',
      headers: p.body.headers,
      body: png(5000),
    });
    expect(tooBig.status).toBe(403);
    await api.post(s, `/v1/kyc/documents/${p.body.documentId}/confirm`).expect(409);
  });

  it('the bucket is private: the object URL without a signature is denied', async () => {
    const doc = await api
      .prisma()
      .kycDocument.findFirstOrThrow({ where: { kycCheckId: checkId, status: 'UPLOADED' } });
    const res = await fetch(`${h.s3Url}/${KYC_BUCKET}/${doc.storageKey}`);
    expect(res.status).toBe(403);
  });

  it('re-uploading a type replaces the old file (old object is deleted)', async () => {
    const first = await api.prisma().kycDocument.findFirstOrThrow({
      where: { kycCheckId: checkId, type: 'AADHAAR_FRONT', status: 'UPLOADED' },
    });
    const newId = await upload(s, checkId, 'AADHAAR_FRONT', png(3000));
    expect(newId).not.toBe(first.id);
    expect(
      (await api.prisma().kycDocument.findUniqueOrThrow({ where: { id: first.id } })).status,
    ).toBe('DELETED');
    await new Promise((r) => setTimeout(r, 400)); // best-effort delete is fire-and-forget
    expect(await h.app.get(StorageService).headSize(KYC_BUCKET, first.storageKey)).toBeNull();
    const status = await api.get(s, '/v1/kyc/status').expect(200);
    expect(
      status.body.checks[0].documents.filter((d: { type: string }) => d.type === 'AADHAAR_FRONT'),
    ).toHaveLength(1);
  });

  it('cannot submit until every required document is uploaded', async () => {
    const res = await api.post(s, '/v1/kyc/submit', { checkId }).expect(422);
    expect(res.body.error.details.missing.sort()).toEqual(['AADHAAR_BACK', 'SELFIE']);
  });
});

describe('submission and locking', () => {
  it('submit moves the check to PENDING_REVIEW and freezes it', async () => {
    const { ranger, checkId } = await tier1Submitted();
    const status = await api.get(ranger, '/v1/kyc/status').expect(200);
    expect(status.body.tier).toBe(0);
    expect(status.body.checks[0]).toMatchObject({ id: checkId, status: 'PENDING_REVIEW' });
    await api
      .post(ranger, '/v1/kyc/documents', {
        checkId,
        type: 'SELFIE',
        contentType: 'image/png',
        sizeBytes: 10,
      })
      .expect(409);
    await api.post(ranger, '/v1/kyc/submit', { checkId }).expect(409);
  });
});

describe('admin authentication and RBAC', () => {
  it('rejects wrong credentials without saying which part was wrong', async () => {
    const wrongPw = await api
      .http()
      .post('/v1/admin/auth/login')
      .send({ email: reviewer.email, password: 'nope-nope-nope' });
    const wrongEmail = await api
      .http()
      .post('/v1/admin/auth/login')
      .send({ email: 'nobody@haggler.test', password: 'nope-nope-nope' });
    expect(wrongPw.status).toBe(401);
    expect(wrongEmail.status).toBe(401);
    expect(wrongPw.body.error.message).toBe(wrongEmail.body.error.message);
  });

  it('locks an email for 15 minutes after 5 failures', async () => {
    const a = await api.createAdmin(['KYC_REVIEWER']);
    for (let i = 0; i < 5; i++) {
      await api
        .http()
        .post('/v1/admin/auth/login')
        .set('X-Forwarded-For', `10.99.0.${i + 1}`)
        .send({ email: a.email, password: 'wrong-wrong-wrong' })
        .expect(401);
    }
    const locked = await api
      .http()
      .post('/v1/admin/auth/login')
      .set('X-Forwarded-For', '10.99.0.77')
      .send({ email: a.email, password: a.password });
    expect(locked.status).toBe(429); // even the right password is refused while locked
  });

  it('user tokens cannot open admin routes, and admin tokens cannot open user routes', async () => {
    const user = await api.signIn();
    await api
      .http()
      .get('/v1/admin/kyc/queue')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(401);
    await api.http().get('/v1/me').set('Authorization', `Bearer ${reviewerToken}`).expect(401);
    await api.http().get('/v1/admin/kyc/queue').expect(401);
  });

  it('a DISPUTE_AGENT cannot review KYC (403) but a KYC_REVIEWER and a SUPER_ADMIN can', async () => {
    const agent = await api.createAdmin(['DISPUTE_AGENT']);
    const superAdmin = await api.createAdmin(['SUPER_ADMIN']);
    await api.adminGet(await api.adminToken(agent), '/v1/admin/kyc/queue').expect(403);
    await api.adminGet(await api.adminToken(superAdmin), '/v1/admin/kyc/queue').expect(200);
    await api.adminGet(reviewerToken, '/v1/admin/kyc/queue').expect(200);
  });

  it('a deactivated admin is locked out at once', async () => {
    const a = await api.createAdmin(['KYC_REVIEWER']);
    const token = await api.adminToken(a);
    await api.adminGet(token, '/v1/admin/kyc/queue').expect(200);
    await api.prisma().adminUser.update({ where: { id: a.id }, data: { isActive: false } });
    await api.adminGet(token, '/v1/admin/kyc/queue').expect(401);
  });
});

describe('the review queue: side-by-side images', () => {
  it('lists the check with a masked phone, and shows the real uploaded images via short-lived links', async () => {
    const { ranger, checkId, files } = await tier1Submitted();
    const queue = await api.adminGet(reviewerToken, '/v1/admin/kyc/queue?limit=50').expect(200);
    const item = queue.body.items.find((i: { id: string }) => i.id === checkId);
    expect(item).toMatchObject({ tier: 1, status: 'PENDING_REVIEW', provider: 'manual_admin' });
    expect(item.user.phoneMasked).toMatch(/^\+91X+\d{4}$/);
    expect(item.user.phoneMasked).not.toBe(ranger.phone);

    const detail = await api.adminGet(reviewerToken, `/v1/admin/kyc/${checkId}`).expect(200);
    expect(detail.body.documents.map((d: { type: string }) => d.type).sort()).toEqual([
      'AADHAAR_BACK',
      'AADHAAR_FRONT',
      'SELFIE',
    ]);
    for (const d of detail.body.documents) {
      const res = await fetch(d.url);
      expect(res.status).toBe(200);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.equals(files[d.type as keyof typeof files])).toBe(true); // exactly what the Ranger uploaded
    }
    const viewed = await api
      .prisma()
      .auditLog.findMany({ where: { action: 'kyc.documents_viewed', entityId: checkId } });
    expect(viewed).toHaveLength(1);
    expect(viewed[0]?.actorId).toBe(reviewer.id);
    expect(JSON.stringify(viewed[0])).not.toContain('http'); // no image URLs in the audit trail
  });

  it('paginates oldest-first with a cursor and no duplicates', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await tier1Submitted()).checkId);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await api
        .adminGet(reviewerToken, `/v1/admin/kyc/queue?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of ids) expect(seen).toContain(id);
    const submittedOrder = (
      await api.prisma().kycCheck.findMany({
        where: { id: { in: seen } },
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      })
    ).map((r) => r.id);
    expect(seen).toEqual(submittedOrder);
    await api.adminGet(reviewerToken, '/v1/admin/kyc/queue?cursor=garbage').expect(200); // bad cursor = first page, no crash
  });
});

describe('decisions', () => {
  it('reject and request-info both need a reason', async () => {
    const { checkId } = await tier1Submitted();
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, { decision: 'REJECT' })
      .expect(400);
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, {
        decision: 'REQUEST_INFO',
        reason: 'no',
      })
      .expect(400);
  });

  it('request more info: the Ranger sees the message, re-uploads the selfie, resubmits, and is approved', async () => {
    const { ranger, checkId } = await tier1Submitted();
    const req = await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, {
        decision: 'REQUEST_INFO',
        reason: 'Selfie is blurry, please retake in good light.',
      })
      .expect(200);
    expect(req.body.status).toBe('NEEDS_INFO');

    let st = (await api.get(ranger, '/v1/kyc/status').expect(200)).body;
    expect(st.checks[0]).toMatchObject({
      status: 'NEEDS_INFO',
      reviewerMessage: 'Selfie is blurry, please retake in good light.',
    });

    await upload(ranger, checkId, 'SELFIE', png(4000));
    await api.post(ranger, '/v1/kyc/submit', { checkId }).expect(200);
    st = (await api.get(ranger, '/v1/kyc/status')).body;
    expect(st.checks[0]).toMatchObject({ status: 'PENDING_REVIEW', reviewerMessage: null });

    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, goodDecision)
      .expect(200);
    expect((await api.get(ranger, '/v1/kyc/status')).body.tier).toBe(1);
    const reviews = await api
      .prisma()
      .kycReview.findMany({ where: { kycCheckId: checkId }, orderBy: { createdAt: 'asc' } });
    expect(reviews.map((r) => r.decision)).toEqual(['REQUEST_INFO', 'APPROVE']);
  });

  it('reject: the Ranger sees why, and can start a fresh check afterwards', async () => {
    const { ranger, checkId } = await tier1Submitted();
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, {
        decision: 'REJECT',
        reason: 'Photo does not match the ID.',
      })
      .expect(200);
    const st = (await api.get(ranger, '/v1/kyc/status')).body;
    expect(st.tier).toBe(0);
    expect(st.checks[0]).toMatchObject({
      status: 'REJECTED',
      reviewerMessage: 'Photo does not match the ID.',
    });
    await api
      .post(ranger, '/v1/kyc/documents', {
        checkId,
        type: 'SELFIE',
        contentType: 'image/png',
        sizeBytes: 10,
      })
      .expect(409);
    const fresh = await api.post(ranger, '/v1/kyc/start', { tier: 1 }).expect(200);
    expect(fresh.body.id).not.toBe(checkId);
    expect(fresh.body.status).toBe('DRAFT');
  });

  it('a decision on an already-decided check is refused (409)', async () => {
    const { checkId } = await tier1Submitted();
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, {
        decision: 'REJECT',
        reason: 'Document unreadable.',
      })
      .expect(200);
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, goodDecision)
      .expect(409);
  });

  it('two reviewers deciding at once: exactly one decision is recorded', async () => {
    const { checkId } = await tier1Submitted();
    const other = await api.adminToken(await api.createAdmin(['KYC_REVIEWER']));
    const [a, b] = await Promise.all([
      api.adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, goodDecision),
      api.adminPost(other, `/v1/admin/kyc/${checkId}/decision`, {
        decision: 'REJECT',
        reason: 'Conflicting decision.',
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await api.prisma().kycReview.count({ where: { kycCheckId: checkId } })).toBe(1);
  });

  it('APPROVE needs DOB and Aadhaar last 4', async () => {
    const { checkId } = await tier1Submitted();
    const res = await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, { decision: 'APPROVE' })
      .expect(422);
    expect(res.body.error.details.missing).toEqual(['aadhaarLast4', 'dateOfBirth']);
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, {
        ...goodDecision,
        aadhaarLast4: '12',
      })
      .expect(400);
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, {
        ...goodDecision,
        dateOfBirth: '1995-02-30',
      })
      .expect(422);
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, {
        ...goodDecision,
        dateOfBirth: '2999-01-01',
      })
      .expect(422);
  });

  it('HARD BLOCK: a person under 18 can never be approved, and the attempt is audit-logged', async () => {
    const { ranger, checkId } = await tier1Submitted();
    const now = new Date();
    const seventeen = `${now.getUTCFullYear() - 17}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(now.getUTCDate(), 28)).padStart(2, '0')}`;
    const res = await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, {
        ...goodDecision,
        dateOfBirth: seventeen,
      })
      .expect(422);
    expect(res.body.error.code).toBe('UNDERAGE');
    expect((await api.prisma().kycCheck.findUniqueOrThrow({ where: { id: checkId } })).status).toBe(
      'PENDING_REVIEW',
    );
    expect((await api.get(ranger, '/v1/kyc/status')).body.tier).toBe(0);
    expect(
      await api
        .prisma()
        .auditLog.count({ where: { action: 'kyc.approval_blocked_underage', entityId: checkId } }),
    ).toBe(1);

    // Exactly 18 today is allowed.
    const eighteen = `${now.getUTCFullYear() - 18}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, {
        ...goodDecision,
        dateOfBirth: eighteen,
      })
      .expect(200);
  });

  it('APPROVE tier 1: sets the tier, stores DOB and last-4 ENCRYPTED, and audit-logs the decision', async () => {
    const { ranger, checkId } = await tier1Submitted();
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, goodDecision)
      .expect(200);

    const me = await api.get(ranger, '/v1/me').expect(200);
    expect(me.body.workerKycTier).toBe(1);

    const [raw] = await api.prisma().$queryRaw<
      { aadhaar_last4_enc: string; date_of_birth_enc: string }[]
    >`
      SELECT aadhaar_last4_enc, date_of_birth_enc FROM worker_profiles WHERE user_id = ${ranger.userId}::uuid`;
    expect(raw?.aadhaar_last4_enc).toMatch(/^v1\./);
    expect(raw?.date_of_birth_enc).toMatch(/^v1\./);
    expect(raw?.date_of_birth_enc).not.toContain('1995');
    expect(raw?.aadhaar_last4_enc).not.toContain('4821');

    // The person can read their own data back through the export (decrypted).
    const exp = (await api.get(ranger, '/v1/me/export').expect(200)).body;
    expect(exp.rangerProfile).toMatchObject({
      kycTier: 1,
      aadhaarLast4: '4821',
      dateOfBirth: '1995-06-14',
    });
    expect(exp.verification[0]).toMatchObject({
      tier: 1,
      provider: 'manual_admin',
      status: 'APPROVED',
    });

    const audit = await api
      .prisma()
      .auditLog.findFirstOrThrow({ where: { action: 'kyc.approve', entityId: checkId } });
    expect(audit.actorId).toBe(reviewer.id);
    expect(JSON.stringify(audit)).not.toMatch(/4821|1995/); // no PII in the audit log
    await api
      .get(ranger, '/v1/kyc/status')
      .then((r) =>
        expect(r.body.checks[0]).toMatchObject({ status: 'APPROVED', reviewerMessage: null }),
      );
    await api.post(ranger, '/v1/kyc/start', { tier: 1 }).expect(409); // already verified
  });
});

describe('tier 2: address proof + logged reference call', () => {
  it('needs tier 1, address proof, categories and a reference; approval needs a VERIFIED call', async () => {
    const { ranger, checkId } = await tier1Submitted();
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, goodDecision)
      .expect(200);

    const t2 = (await api.post(ranger, '/v1/kyc/start', { tier: 2 }).expect(200)).body;
    expect(t2.requiredDocuments).toEqual(['ADDRESS_PROOF']);
    await api
      .post(ranger, '/v1/kyc/documents', {
        checkId: t2.id,
        type: 'SELFIE',
        contentType: 'image/png',
        sizeBytes: 100,
      })
      .expect(422);
    await upload(
      ranger,
      t2.id,
      'ADDRESS_PROOF',
      Buffer.from('%PDF-1.4 test bill ' + 'x'.repeat(500)),
      'application/pdf',
    );

    const ref = { name: 'Suresh Iyer', phone: '+919845012345', relationship: 'Former employer' };
    const noRef = await api.post(ranger, '/v1/kyc/submit', { checkId: t2.id }).expect(422);
    expect(noRef.body.error.details.missing).toEqual(['reference']);
    const noCats = await api
      .post(ranger, '/v1/kyc/submit', { checkId: t2.id, reference: ref })
      .expect(422);
    expect(noCats.body.error.details.missing).toEqual(['categories']);

    await api
      .patch(ranger, '/v1/worker/profile', {
        categorySlugs: ['electrician', 'plumber'],
        bio: 'Ten years of house wiring.',
        experienceYears: 10,
      })
      .expect(200);
    await api.patch(ranger, '/v1/worker/profile', { categorySlugs: ['astronaut'] }).expect(422);
    await api
      .patch(ranger, '/v1/worker/profile', {
        categorySlugs: ['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'ac_repair'],
      })
      .expect(400);
    await api.post(ranger, '/v1/kyc/submit', { checkId: t2.id, reference: ref }).expect(200);

    const detail = (await api.adminGet(reviewerToken, `/v1/admin/kyc/${t2.id}`).expect(200)).body;
    expect(detail.reference).toMatchObject({ ...ref, callOutcome: 'NOT_CALLED' });
    expect(detail.ranger.categorySlugs.sort()).toEqual(['electrician', 'plumber']);

    // Cannot approve without a logged, successful call.
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${t2.id}/decision`, { decision: 'APPROVE' })
      .expect(422);
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${t2.id}/decision`, {
        decision: 'APPROVE',
        referenceCall: { outcome: 'NOT_REACHABLE' },
      })
      .expect(422);
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${t2.id}/decision`, {
        decision: 'APPROVE',
        referenceCall: { outcome: 'VERIFIED', notes: 'Confirmed 10 years of work, would rehire.' },
      })
      .expect(200);

    expect((await api.get(ranger, '/v1/me')).body.workerKycTier).toBe(2);
    const stored = await api
      .prisma()
      .professionalReference.findUniqueOrThrow({ where: { kycCheckId: t2.id } });
    expect(stored).toMatchObject({
      callOutcome: 'VERIFIED',
      callNotes: 'Confirmed 10 years of work, would rehire.',
      calledBy: reviewer.id,
    });
    expect(stored.calledAt).not.toBeNull();
    expect((await api.get(ranger, '/v1/worker/profile')).body).toMatchObject({
      kycTier: 2,
      categorySlugs: ['electrician', 'plumber'],
      experienceYears: 10,
    });
  });
});

describe('retention: identity images are deleted after the decision window (D-017)', () => {
  it('deletes images past kyc_image_retention_days and keeps the outcome', async () => {
    const { checkId } = await tier1Submitted();
    await api
      .adminPost(reviewerToken, `/v1/admin/kyc/${checkId}/decision`, goodDecision)
      .expect(200);
    const docs = await api.prisma().kycDocument.findMany({ where: { kycCheckId: checkId } });
    const kyc = h.app.get(KycService);

    expect(await kyc.purgeExpiredImages()).toBe(0); // decided just now: still inside the window
    await api.prisma().kycCheck.update({
      where: { id: checkId },
      data: { decidedAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    expect(await kyc.purgeExpiredImages()).toBe(3);

    const storage = h.app.get(StorageService);
    for (const d of docs) expect(await storage.headSize(KYC_BUCKET, d.storageKey)).toBeNull();
    expect(
      (await api.prisma().kycDocument.findMany({ where: { kycCheckId: checkId } })).every(
        (d) => d.status === 'DELETED',
      ),
    ).toBe(true);
    expect((await api.prisma().kycCheck.findUniqueOrThrow({ where: { id: checkId } })).status).toBe(
      'APPROVED',
    );
    expect(await kyc.purgeExpiredImages()).toBe(0); // idempotent
  });
});

describe('account deletion removes stored identity files', () => {
  it('purge deletes the KYC objects from storage and the check rows', async () => {
    const { ranger, checkId } = await tier1Submitted();
    const docs = await api.prisma().kycDocument.findMany({ where: { kycCheckId: checkId } });
    await api.del(ranger, '/v1/me').expect(202);
    await api.prisma().user.update({
      where: { id: ranger.userId },
      data: { deletionScheduledFor: new Date(Date.now() - 1000) },
    });
    const { AccountLifecycleService } = await import('../src/users/account-lifecycle.service');
    await h.app.get(AccountLifecycleService).purgeDueDeletions();
    const storage = h.app.get(StorageService);
    for (const d of docs) expect(await storage.headSize(KYC_BUCKET, d.storageKey)).toBeNull();
    expect(await api.prisma().kycCheck.count({ where: { userId: ranger.userId } })).toBe(0);
  });
});
