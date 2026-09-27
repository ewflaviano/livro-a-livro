import { z } from 'zod';
import { bindingSchema, DRIVE_SCOPE, sameBinding, SyncError, type AuthClient, type Binding, type LoginSession } from './contracts';
import { limitedJson, request } from './network';

const scopes = z.array(z.string()).refine(values => values.includes(DRIVE_SCOPE) && values.every(value => value === DRIVE_SCOPE || value === 'openid'));
const sessionSchema = bindingSchema.extend({ expiresAt: z.number().positive(), csrfToken: z.string().min(1).max(1000), scopes });
/** Deliberately accepts only control methods; callers cannot supply body, path or headers. */
export function createAuthClient(fetcher: typeof fetch = fetch): AuthClient {
  const origin = 'https://api.livroalivro.app.br';
  let session: z.infer<typeof sessionSchema> | null = null;
  let loginSession: LoginSession | null = null;
  const loginSchema = z.strictObject({ connectionId: z.string().min(1).max(200), signInAttemptId: z.uuid(), expiresAt: z.number().positive(), absoluteExpiresAt: z.number().positive(), csrfToken: z.string().min(1).max(1000) });
  let access: { value: string; until: number } | null = null;
  const loginFetch: typeof fetch = async (input, init) => { const response = await fetcher(input, init); if (response.status === 403) throw new SyncError('invalid'); return response; };
  const control = (path: string, method: string, csrf = false, signal?: AbortSignal) => request(fetcher, origin + path,
    { method, credentials: 'include', signal, headers: csrf && session ? { 'x-lal-csrf': session.csrfToken } : {} });
  const authorizationUrl = async (response: Response) => {
    const data = z.strictObject({ authorizationUrl: z.string().url() }).parse(await limitedJson(response, 16 * 1024));
    const url = new URL(data.authorizationUrl);
    if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password) throw new SyncError('invalid');
    return url.href;
  };
  const client: AuthClient = {
    async session(signal, renew = true) {
      try {
        const next = sessionSchema.parse(await limitedJson(await request(loginFetch, origin + '/v1/session', { method: 'GET', credentials: 'include', signal }), 16 * 1024));
        if (!sameBinding(session, next)) access = null;
        session = next;
        if (renew && next.expiresAt * 1000 - Date.now() < 7 * 86400_000) {
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
    async login(signal) {
      const next = loginSchema.parse(await limitedJson(await request(loginFetch, origin + '/v1/login', { method: 'GET', credentials: 'include', signal }), 16 * 1024));
      if (Math.min(next.expiresAt, next.absoluteExpiresAt) * 1000 <= Date.now()) throw new SyncError('reconnect');
      loginSession = next;
      if (next.expiresAt * 1000 - Date.now() < 7 * 86400_000) {
        const renewed = z.strictObject({ expiresAt: z.number().positive(), absoluteExpiresAt: z.number().positive(), csrfToken: z.string().min(1).max(1000) }).parse(await limitedJson(await request(loginFetch, origin + '/v1/login/renew', { method: 'POST', credentials: 'include', signal, headers: { 'x-lal-csrf': next.csrfToken } }), 16 * 1024));
        if (renewed.absoluteExpiresAt !== next.absoluteExpiresAt || renewed.expiresAt > next.absoluteExpiresAt || renewed.expiresAt * 1000 <= Date.now()) throw new SyncError('invalid');
        loginSession = { ...next, ...renewed };
      }
      return loginSession;
    },
    async startSignIn(attemptId, guard) {
      let current: LoginSession | null = null;
      try { current = await client.login(); } catch (error) { if (!(error instanceof SyncError) || error.code !== 'reconnect') throw error; }
      await guard?.();
      access = null; session = null; loginSession = null;
      return authorizationUrl(await request(fetcher, origin + '/v1/auth/google/start', { method: 'POST', credentials: 'include', headers: { 'x-lal-attempt': attemptId, ...(current ? { 'x-lal-csrf': current.csrfToken } : {}) } }));
    },
    async startDrive(attemptId) {
      if (!loginSession || Math.min(loginSession.expiresAt, loginSession.absoluteExpiresAt) * 1000 <= Date.now()) throw new SyncError('reconnect');
      return authorizationUrl(await request(fetcher, origin + '/v1/auth/google/drive/start', {
        method: 'POST', credentials: 'include', headers: { 'x-lal-csrf': loginSession.csrfToken, 'x-lal-attempt': attemptId },
      }));
    },
    async cancelAuthorization(attemptId) {
      let current;
      try { current = z.strictObject({ attemptId: z.uuid(), purpose: z.enum(['signin', 'drive']), expiresAt: z.number().positive(), csrfToken: z.string().min(1).max(1000) }).parse(await limitedJson(await request(loginFetch, origin + '/v1/auth/google/authorization', { method: 'GET', credentials: 'include' }), 16 * 1024)); }
      catch (error) { if (error instanceof SyncError && error.code === 'reconnect') return; throw error; }
      if (current.attemptId !== attemptId) return;
      await request(fetcher, origin + '/v1/auth/google/authorization', { method: 'DELETE', credentials: 'include', headers: { 'x-lal-csrf': current.csrfToken, 'x-lal-attempt': attemptId } });
    },
    async logout(expectedSignInAttemptId) {
      let current: LoginSession;
      try {
        current = loginSchema.parse(await limitedJson(await request(loginFetch, origin + '/v1/login', { method: 'GET', credentials: 'include' }), 16 * 1024));
      } catch (error) { if (error instanceof SyncError && error.code === 'reconnect') return; throw error; }
      if (current.signInAttemptId !== expectedSignInAttemptId) throw new SyncError('cancelled');
      try {
        await request(loginFetch, origin + '/v1/login', { method: 'DELETE', credentials: 'include', headers: { 'x-lal-csrf': current.csrfToken } });
      } finally { access = null; session = null; loginSession = null; }
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
