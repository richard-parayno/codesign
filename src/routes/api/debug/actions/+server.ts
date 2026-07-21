import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import { z } from 'zod';

const detailValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(120)).max(30),
  z.array(z.number().finite()).max(30),
]);

const actionSchema = z
  .object({
    action: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9._-]+$/),
    details: z.record(z.string().max(60), detailValueSchema).default({}),
    clientTimestamp: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value.details).length > 20)
      context.addIssue({ code: 'custom', message: 'Too many debug detail fields' });
  });

export async function POST({ request }) {
  if (!dev) return new Response(null, { status: 204 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ message: 'Invalid debug action' }, { status: 400 });
  console.info(
    `[codesign:action] ${JSON.stringify({
      serverTimestamp: new Date().toISOString(),
      ...parsed.data,
    })}`,
  );
  return new Response(null, { status: 204 });
}
