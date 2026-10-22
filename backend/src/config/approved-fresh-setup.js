// Explicit operator tool only. Never imported by startup or HTTP composition.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  canonical,
  freshCollections,
  manifestValidator,
  FRESH_MANIFEST_COLLECTION,
  FRESH_PROFILE,
  FRESH_PROFILE_VERSION,
} from './fresh-cycle-schema.js';
import { installFreshCycleSchema } from './fresh-cycle-setup.js';

const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export const approvedSchemaDigest = hash({
  profile: FRESH_PROFILE,
  version: FRESH_PROFILE_VERSION,
  manifest: manifestValidator,
  collections: freshCollections,
});
export const freshApprovalPlan = z
  .object({
    formatVersion: z.literal(1),
    setupId: z.uuid(),
    purpose: z.literal('generated-data-only'),
    target: z
      .object({
        srvHost: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+\.mongodb\.net$/),
        database: z.string().regex(/^tn_rehearsal_[a-f0-9]{12}$/),
        replicaSet: z.string().regex(/^atlas-[a-zA-Z0-9-]+$/),
      })
      .strict(),
    schemaDigest: z.literal(approvedSchemaDigest),
    writersStopped: z.literal(true),
    runtimeCredentialWithheld: z.literal(true),
  })
  .strict();
export const approvalDigest = (plan) => hash(freshApprovalPlan.parse(plan));
const receiptSchema = z
  .object({
    formatVersion: z.literal(1),
    planDigest: z.string().regex(/^[a-f0-9]{64}$/),
    setupId: z.uuid(),
    phase: z.enum(['prepared', 'owned', 'ready']),
    manifestUuid: z.uuid().optional(),
  })
  .strict();
const fail = (code) => {
  throw new Error(code);
};

export function validateSetupUri(uri, plan) {
  const target = freshApprovalPlan.parse(plan).target;
  let url;
  try {
    url = new URL(uri);
  } catch {
    fail('OPERATOR_URI_INVALID');
  }
  const allowed = { authSource: 'admin', retryWrites: 'true', w: 'majority', tls: 'true' };
  if (
    url.protocol !== 'mongodb+srv:' ||
    url.hostname !== target.srvHost ||
    url.port ||
    decodeURIComponent(url.pathname.slice(1)) !== target.database ||
    !url.username ||
    !url.password ||
    url.hash ||
    [...url.searchParams].some(([key, value]) =>
      key === 'appName' ? !/^[a-zA-Z0-9_-]{1,64}$/.test(value) : allowed[key] !== value,
    )
  )
    fail('OPERATOR_URI_TARGET_MISMATCH');
  return uri;
}

// The caller owns transport/TLS/replica-set validation and durable external
// receipt storage. A missing ownership receipt is never inferred from a valid schema.
export async function provisionApprovedFresh({
  db,
  plan: input,
  approval,
  receipt,
  saveReceipt,
  fault = async () => {},
}) {
  const plan = freshApprovalPlan.parse(input),
    digest = approvalDigest(plan);
  if (approval !== digest) fail('OPERATOR_APPROVAL_REQUIRED');
  if (db.databaseName !== plan.target.database) fail('OPERATOR_DATABASE_MISMATCH');
  if (typeof saveReceipt !== 'function') fail('OPERATOR_RECEIPT_REQUIRED');
  let state = receipt ? receiptSchema.parse(receipt) : null;
  if (
    state &&
    (state.planDigest !== digest ||
      state.setupId !== plan.setupId ||
      (state.phase !== 'prepared' && !state.manifestUuid))
  )
    fail('OPERATOR_RECEIPT_MISMATCH');
  const rows = await db.listCollections().toArray();
  const allowed = new Set([FRESH_MANIFEST_COLLECTION, ...freshCollections.map((row) => row.name)]);
  if (rows.some((row) => !allowed.has(row.name))) fail('OPERATOR_UNKNOWN_COLLECTION');
  // Even a recognized fresh schema cannot be adopted once writers have used it.
  for (const row of rows)
    if (
      row.name !== FRESH_MANIFEST_COLLECTION &&
      (await db.collection(row.name).findOne({}, { projection: { _id: 1 } }))
    )
      fail('OPERATOR_DATABASE_NOT_EMPTY');
  if (rows.length === 0) {
    if (state?.manifestUuid) fail('OPERATOR_OWNED_COLLECTION_MISSING');
    state = { formatVersion: 1, planDigest: digest, setupId: plan.setupId, phase: 'prepared' };
    await saveReceipt(state);
    await db.createCollection(FRESH_MANIFEST_COLLECTION, {
      validator: manifestValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    // If killed here, ownership is ambiguous: refuse automatic resume; retain
    // the abandoned target for review and approve a different empty DB instead.
    await fault('before_ownership_receipt');
    const row = await db.listCollections({ name: FRESH_MANIFEST_COLLECTION }).next();
    state = { ...state, phase: 'owned', manifestUuid: row.info.uuid.toString() };
    await saveReceipt(state);
  } else {
    const row = rows.find((row) => row.name === FRESH_MANIFEST_COLLECTION);
    if (!state?.manifestUuid || row?.info?.uuid?.toString() !== state.manifestUuid)
      fail('OPERATOR_OWNERSHIP_UNPROVEN');
  }
  await fault('after_ownership_receipt');
  const result = await installFreshCycleSchema(db, { fault });
  await saveReceipt({ ...state, phase: 'ready' });
  return result;
}
