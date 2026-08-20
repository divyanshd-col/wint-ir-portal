import { isRateLimited } from '@/lib/rate-limit';
import { consumeAuthCode, issueTokens, rotateRefreshToken, verifyPkceS256 } from '@/lib/mcp/oauth';

// OAuth 2.1 token endpoint (RFC 6749 §3.2). Public client — no client secret;
// the authorization_code grant is bound by PKCE (S256). Supports the
// authorization_code and refresh_token grants. Rate-limit fails OPEN: codes and
// refresh tokens are 256-bit single-use values, so a limiter outage must not
// break token exchange.
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function err(code: string, description: string, status = 400): Response {
  return json({ error: code, error_description: description }, status);
}

async function readForm(req: Request): Promise<URLSearchParams> {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) if (v != null) sp.set(k, String(v));
    return sp;
  }
  const form = await req.formData().catch(() => null);
  const sp = new URLSearchParams();
  if (form) for (const [k, v] of form.entries()) sp.set(k, String(v));
  return sp;
}

export async function POST(req: Request): Promise<Response> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (await isRateLimited(`oauth:token:ip:${ip}`, 120, 3600)) {
    return err('temporarily_unavailable', 'Too many token requests.', 429);
  }

  const p = await readForm(req);
  const grantType = p.get('grant_type') ?? '';

  if (grantType === 'authorization_code') {
    const code = p.get('code') ?? undefined;
    const codeVerifier = p.get('code_verifier') ?? '';
    const redirectUri = p.get('redirect_uri') ?? '';
    const clientId = p.get('client_id') ?? '';

    const consumed = await consumeAuthCode(code);
    if (!consumed) return err('invalid_grant', 'The authorization code is invalid, expired, or already used.');
    if (clientId && consumed.clientId !== clientId) return err('invalid_grant', 'client_id mismatch.');
    if (!redirectUri || consumed.redirectUri !== redirectUri) return err('invalid_grant', 'redirect_uri mismatch.');
    if (!verifyPkceS256(codeVerifier, consumed.codeChallenge)) return err('invalid_grant', 'PKCE verification failed.');

    const tokens = await issueTokens({
      userId: consumed.userId,
      clientId: consumed.clientId,
      scope: consumed.scope,
      resource: consumed.resource,
    });
    return json(tokens, 200);
  }

  if (grantType === 'refresh_token') {
    const refreshToken = p.get('refresh_token') ?? undefined;
    const clientId = p.get('client_id') || null;
    const tokens = await rotateRefreshToken(refreshToken, clientId);
    if (!tokens) return err('invalid_grant', 'The refresh token is invalid, expired, or revoked.');
    return json(tokens, 200);
  }

  return err('unsupported_grant_type', `grant_type "${grantType}" is not supported.`);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
