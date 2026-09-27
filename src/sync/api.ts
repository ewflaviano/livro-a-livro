import { z } from 'zod';
import { bindingSchema, DRIVE_SCOPE, sameBinding, SyncError, type AuthClient, type Binding } from './contracts';
import { limitedJson, request } from './network';

const scopes = z.array(z.string()).refine(values => values.includes(DRIVE_SCOPE) && values.every(value => value === DRIVE_SCOPE || value === 'openid'));
const sessionSchema = bindingSchema.extend({ expiresAt: z.number().positive(), csrfToken: z.string().min(1).max(1000), scopes });
/** Deliberately accepts only control methods; callers cannot supply body, path or headers. */
export function createAuthClient(fetcher: typeof fetch = fetch): AuthClient {
  const origin = 'https://api.livroalivro.app.br';
  let session: z.infer<typeof sessionSchema> | null = null;
  let access: { value: string; until: number } | null = null;
  const control = (path: string, method: string, csrf = false, signal?: AbortSignal) => request(fetcher, origin + path,
    { method, credentials: 'include', signal, headers: csrf && session ? { 'x-lal-csrf': session.csrfToken } : {} });
  const client: AuthClient = {
    async session(signal) {
      try {
        const next = sessionSchema.parse(await limitedJson(await control('/v1/session', 'GET', false, signal), 16 * 1024));
        if (!sameBinding(session, next)) access = null;
        session = next;
        if (next.expiresAt * 1000 - Date.now() < 7 * 86400_000) {
          const renewed = z.strictObject({ expiresAt: z.number().positive(), csrfToken: z.string().min(1).max(1000) })
            .parse(await limitedJson(await control('/v1/session/renew', 'POST', true, signal), 16 * 1024));
          session = { ...next, ...renewed };
        }
        return { connectionId: next.connectionId, generation: next.generation };
      } catch (error) { access = null; session = null; if (error instanceof SyncError) throw error; throw new SyncError('invalid'); }
    },
    async token(binding: Binding, signal) {
      if (!session || !sameBinding(session, binding)) throw new SyncError('reconnect');
      if (access && access.until > Date.now()) return access.value;
      try {
        const token = z.strictObject({ accessToken: z.string().min(1).max(16_384), expiresIn: z.number().positive().max(86_400), scopes })
          .parse(await limitedJson(await control('/v1/auth/drive-token', 'POST', true, signal), 32 * 1024));
        access = { value: token.accessToken, until: Date.now() + Math.max(0, token.expiresIn - 60) * 1000 };
        return access.value;
      } catch (error) { access = null; if (error instanceof SyncError) throw error; throw new SyncError('invalid'); }
    },
    invalidate() { access = null; },
    async start() {
      const data = z.strictObject({ authorizationUrl: z.string().url() }).parse(await limitedJson(await control('/v1/auth/google/start', 'POST'), 16 * 1024));
      const url = new URL(data.authorizationUrl);
      if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password) throw new SyncError('invalid');
      return url.href;
    },
    async disconnect(all) {
      try {
        await client.session();
        const response = await control(all ? '/v1/drive-connection' : '/v1/session', 'DELETE', true);
        if (!all) return false;
        return z.strictObject({ disconnected: z.literal(true), revocationPending: z.boolean() })
          .parse(await limitedJson(response, 1024)).revocationPending;
      }
      finally { access = null; session = null; }
    },
  };
  return client;
}
