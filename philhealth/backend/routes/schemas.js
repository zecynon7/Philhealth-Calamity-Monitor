import { z } from 'zod';

const username = z.string().trim().min(1).max(64).regex(/^[a-z0-9_]+$/i);
export const schemas = {
  csrf: z.object({}),
  login: z.object({ username, password: z.string().min(1).max(256) }),
  logout: z.object({}),
  me: z.object({}),
  dashboard: z.object({}),
  claims: z.object({ q: z.string().trim().max(100).optional() }),
  claim: z.object({ ref: z.string().min(1).max(64) }),
  claimStatus: z.object({ ref: z.string().min(1).max(64), status: z.enum(['Submitted', 'Under review', 'Approved', 'Paid']) }),
  exceptions: z.object({}),
  resolveException: z.object({ id: z.coerce.number().int().positive() }),
  analytics: z.object({}),
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
