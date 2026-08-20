import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getPublicOrigin } from 'mcp-handler';
import { normalizeEmail } from '@/lib/identity';
import { getUserByEmail } from '@/lib/users';
import { isRateLimited } from '@/lib/rate-limit';
import {
  getClient,
  createAuthCode,
  isAllowedRedirectUri,
  signConsentToken,
  verifyConsentToken,
  OAUTH_SCOPE,
  MCP_ALLOWED_ROLES_LABEL,
  type ConsentFields,
} from '@/lib/mcp/oauth';
import { MCP_ALLOWED_ROLES } from '@/lib/mcp/tokens';

// OAuth 2.1 authorization endpoint (RFC 6749 §3.1, with PKCE RFC 7636).
// GET  → validate the request, require a portal login, gate to admin/tl, then
//        render a minimal consent screen carrying an HMAC-bound CSRF token.
// POST → verify the token + session, then mint a one-time authorization code and
//        redirect back to the (registered, allowlisted) redirect_uri.
export const runtime = 'nodejs';

const BRAND = '#2d9e4f';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlPage(title: string, bodyInner: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background:#f7f8f7; color:#1f2937; display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:20px; padding:32px; max-width:440px; width:100%;
          box-shadow:0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size:20px; margin:0 0 8px; }
  p { font-size:14px; line-height:1.55; color:#4b5563; margin:0 0 12px; }
  .who { font-size:13px; color:#6b7280; }
  .scope { background:#f3f4f6; border:1px solid #e5e7eb; border-radius:12px; padding:12px 14px; font-size:13px; margin:16px 0; }
  .scope strong { color:#111827; }
  .client { font-weight:600; color:#111827; }
  .row { display:flex; gap:10px; margin-top:20px; }
  button { flex:1; border:0; border-radius:12px; padding:11px 16px; font-size:14px; font-weight:600; cursor:pointer; }
  .approve { background:${BRAND}; color:#fff; }
  .approve:hover { background:#268544; }
  .deny { background:#fff; color:#374151; border:1px solid #d1d5db; }
  .deny:hover { background:#f9fafb; }
  .muted { font-size:12px; color:#9ca3af; margin-top:16px; }
  .err { color:#b91c1c; }
</style></head><body><div class="card">${bodyInner}</div></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

interface AuthzParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  state: string;
  resource: string;
}

function readParams(sp: URLSearchParams): AuthzParams {
  return {
    responseType: sp.get('response_type') ?? '',
    clientId: sp.get('client_id') ?? '',
    redirectUri: sp.get('redirect_uri') ?? '',
    codeChallenge: sp.get('code_challenge') ?? '',
    codeChallengeMethod: sp.get('code_challenge_method') ?? '',
    scope: sp.get('scope') ?? '',
    state: sp.get('state') ?? '',
    resource: sp.get('resource') ?? '',
  };
}

// Normalize/validate the requested scope down to what we grant.
function resolveScope(requested: string): string | null {
  if (!requested.trim()) return OAUTH_SCOPE;
  const wanted = requested.trim().split(/\s+/);
  if (wanted.every((s) => s === OAUTH_SCOPE)) return OAUTH_SCOPE;
  return null; // asked for something we don't offer
}

function redirectError(redirectUri: string, error: string, description: string, state: string): Response {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return Response.redirect(url.toString(), 302);
}

async function eligibleUser(): Promise<{ userId: number; email: string; name: string } | null | 'none'> {
  const session = await getServerSession(authOptions);
  const email = (session?.user as { email?: string } | undefined)?.email;
  if (!email) return 'none';
  const user = await getUserByEmail(normalizeEmail(email));
  if (!user) return null;
  if (user.status !== 'active') return null;
  if (!MCP_ALLOWED_ROLES.includes(user.role as (typeof MCP_ALLOWED_ROLES)[number])) return null;
  return { userId: user.user_id, email: user.email, name: user.name };
}

// ── GET: validate → login → consent ─────────────────────────────────────────────
export async function GET(req: Request): Promise<Response> {
  const origin = getPublicOrigin(req);
  const reqUrl = new URL(req.url);
  const p = readParams(reqUrl.searchParams);

  // 1) Establish a trusted redirect_uri BEFORE echoing anything back to it.
  const client = await getClient(p.clientId);
  if (!client) {
    return htmlPage('Unknown application', `<h1 class="err">Unknown application</h1>
      <p>This connection request references a client that isn't registered. Please start again from Claude.</p>`, 400);
  }
  if (!p.redirectUri || !client.redirectUris.includes(p.redirectUri) || !isAllowedRedirectUri(p.redirectUri)) {
    return htmlPage('Invalid redirect', `<h1 class="err">Invalid redirect URL</h1>
      <p>The redirect URL for this request is not registered for this application, so we can't safely continue.</p>`, 400);
  }

  // 2) redirect_uri is now trusted — remaining errors go back to the client.
  if (p.responseType !== 'code') {
    return redirectError(p.redirectUri, 'unsupported_response_type', 'Only response_type=code is supported.', p.state);
  }
  if (!p.codeChallenge || p.codeChallengeMethod !== 'S256') {
    return redirectError(p.redirectUri, 'invalid_request', 'PKCE with code_challenge_method=S256 is required.', p.state);
  }
  const scope = resolveScope(p.scope);
  if (!scope) {
    return redirectError(p.redirectUri, 'invalid_scope', `Only the "${OAUTH_SCOPE}" scope is available.`, p.state);
  }

  // 3) Require a portal login (bounce through NextAuth, returning here).
  const who = await eligibleUser();
  if (who === 'none') {
    const callbackUrl = `${origin}${reqUrl.pathname}${reqUrl.search}`;
    const loginUrl = `${origin}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    return Response.redirect(loginUrl, 302);
  }
  if (who === null) {
    return htmlPage('Access not available', `<h1 class="err">You don't have analytics access</h1>
      <p>The Wint Analytics connector is available to admins and team leads only. If you think you should have
      access, ask an admin.</p>`, 403);
  }

  // 4) Render consent with an HMAC-bound token.
  const now = Math.floor(Date.now() / 1000);
  const fields: ConsentFields = {
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    scope,
    resource: p.resource,
    state: p.state,
    email: who.email,
  };
  const token = signConsentToken(fields, now);
  const clientLabel = client.clientName || 'An application';

  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const body = `
    <h1>Connect ${esc(clientLabel)}?</h1>
    <p class="who">Signed in as <strong>${esc(who.email)}</strong></p>
    <p><span class="client">${esc(clientLabel)}</span> is requesting access to <strong>Wint Analytics</strong>.</p>
    <div class="scope">This will allow it to <strong>read the CX analytics database</strong> (read-only) and run
      queries on your behalf. Phone numbers stay masked and every query is logged against your account.</div>
    <form method="POST" action="/api/oauth/authorize">
      ${hidden('client_id', p.clientId)}
      ${hidden('redirect_uri', p.redirectUri)}
      ${hidden('code_challenge', p.codeChallenge)}
      ${hidden('code_challenge_method', p.codeChallengeMethod)}
      ${hidden('scope', scope)}
      ${hidden('state', p.state)}
      ${hidden('resource', p.resource)}
      ${hidden('consent_token', token)}
      <div class="row">
        <button type="submit" name="decision" value="deny" class="deny">Cancel</button>
        <button type="submit" name="decision" value="approve" class="approve">Approve</button>
      </div>
    </form>
    <p class="muted">Grants ${esc(MCP_ALLOWED_ROLES_LABEL)} read-only analytics access. You can revoke this anytime
      from the Analytics settings.</p>`;
  return htmlPage(`Connect ${clientLabel}`, body);
}

// ── POST: verify consent → issue code ───────────────────────────────────────────
export async function POST(req: Request): Promise<Response> {
  // Light rate-limit (fails open; the real gates are session + consent token).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (await isRateLimited(`oauth:authorize:ip:${ip}`, 60, 3600)) {
    return htmlPage('Slow down', `<h1 class="err">Too many attempts</h1><p>Please wait a moment and try again.</p>`, 429);
  }

  const form = await req.formData();
  const get = (k: string) => String(form.get(k) ?? '');
  const p = {
    clientId: get('client_id'),
    redirectUri: get('redirect_uri'),
    codeChallenge: get('code_challenge'),
    codeChallengeMethod: get('code_challenge_method'),
    scope: get('scope'),
    state: get('state'),
    resource: get('resource'),
    consentToken: get('consent_token'),
    decision: get('decision'),
  };

  // Re-establish a trusted redirect_uri (never trust the posted value blindly).
  const client = await getClient(p.clientId);
  if (
    !client ||
    !p.redirectUri ||
    !client.redirectUris.includes(p.redirectUri) ||
    !isAllowedRedirectUri(p.redirectUri)
  ) {
    return htmlPage('Invalid request', `<h1 class="err">Invalid request</h1>
      <p>We couldn't verify this connection request. Please start again from Claude.</p>`, 400);
  }

  const who = await eligibleUser();
  if (who === 'none' || who === null) {
    return htmlPage('Session expired', `<h1 class="err">Session expired</h1>
      <p>Please start the connection again from Claude.</p>`, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const fields: ConsentFields = {
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    scope: p.scope,
    resource: p.resource,
    state: p.state,
    email: who.email,
  };
  if (!verifyConsentToken(p.consentToken, fields, now)) {
    return htmlPage('Request expired', `<h1 class="err">This request expired</h1>
      <p>For your security, please start the connection again from Claude.</p>`, 400);
  }

  if (p.decision !== 'approve') {
    return redirectError(p.redirectUri, 'access_denied', 'The user declined the request.', p.state);
  }
  if (resolveScope(p.scope) !== OAUTH_SCOPE) {
    return redirectError(p.redirectUri, 'invalid_scope', `Only the "${OAUTH_SCOPE}" scope is available.`, p.state);
  }

  const code = await createAuthCode({
    clientId: p.clientId,
    userId: who.userId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    codeChallengeMethod: 'S256',
    scope: OAUTH_SCOPE,
    resource: p.resource || null,
  });

  const url = new URL(p.redirectUri);
  url.searchParams.set('code', code);
  if (p.state) url.searchParams.set('state', p.state);
  return Response.redirect(url.toString(), 302);
}
