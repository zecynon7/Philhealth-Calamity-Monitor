import { z } from 'zod';

const username = z.string().trim().min(1).max(64).regex(/^[a-z0-9_]+$/i);
const money = z.number().int().nonnegative();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const status = z.enum(['Submitted', 'Under Review', 'Approved', 'Returned (RTH)', 'Denied', 'Resubmitted', 'Paid', 'Reconciled']);
export const schemas = {
  csrf: z.object({}),
  login: z.object({ username, password: z.string().min(1).max(256) }),
  logout: z.object({}),
  me: z.object({}),
  dashboard: z.object({}),
  claims: z.object({ q: z.string().trim().max(100).optional() }),
  claim: z.object({ ref: z.string().min(1).max(64) }),
  claimStatus: z.object({
    ref: z.string().min(1).max(64), status, approved: money.optional(), note: z.string().trim().max(1000).optional(),
    reasonCode: z.string().trim().min(1).max(64).optional(), overrideReason: z.string().trim().min(1).max(1000).optional()
  }),
  createClaim: z.object({
    ref: z.string().trim().min(1).max(64), eventId: z.string().trim().min(1).max(64), region: z.string().trim().min(1).max(32),
    token: z.string().regex(/^PT-\d{4,}$/), type: z.string().trim().min(1).max(64), claimed: money.positive(),
    providerId: z.number().int().positive().optional(), dischargeDate: date, filingDate: date, note: z.string().trim().max(1000).optional()
  }).strict(),
  payment: z.object({ amount: money.positive(), paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(1000).optional() }),
  reconcile: z.object({ note: z.string().trim().max(1000).optional() }),
  settings: z.object({ value: z.string().trim().min(1).max(64), reason: z.string().trim().min(1).max(1000) }),
  exceptions: z.object({}),
  resolveException: z.object({ id: z.coerce.number().int().positive(), note: z.string().trim().min(1).max(1000) }),
  analytics: z.object({}),
  drill: z.object({ metric: z.enum(['aging', 'lateFiling', 'mismatch', 'status']).default('aging') }),
  audit: z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
  }),
  events: z.object({}),
  reports: z.object({})
};

export function validate(schema, source = 'body') {
  return async (request, reply) => {
    const input = source === 'params' ? request.params : source === 'query' ? request.query : source === 'params+body' ? { ...request.params, ...request.body } : request.body ?? {};
    const result = schema.safeParse(input);
    if (!result.success) return reply.code(400).send({ error: 'Invalid request.' });
    request.validated = result.data;
  };
}
