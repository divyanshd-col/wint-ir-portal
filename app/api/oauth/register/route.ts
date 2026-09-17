import { OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { isRateLimited } from '@/lib/rate-limit';
import { registerClient, OAuthError, OAUTH_SCOPE } from '@/lib/mcp/oauth';

// RFC 7591 — OAuth 2.0 Dynamic Client Registration.
// claude.ai self-registers here before starting the authorization-code flow.
// Registration alone grants nothing (no token, no data): the real gates are the
// redirect-URI host allowlist (enforced in registerClient), the portal login,
// the consent screen, and PKCE. Rate-limiting is hygiene, so it fails OPEN —
// a limiter outage must not make the connector un-registerable. (Codes and
// tokens are 256-bit single-use values, infeasible to brute-force regardless.)
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

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(req: Request): Promise<Response> {
  if (await isRateLimited(`oauth:register:ip:${clientIp(req)}`, 20, 3600)) {
    return json({ error: 'temporarily_unavailable', error_description: 'Too many registration attempts.' }, 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'invalid_client_metadata', error_description: 'Body must be valid JSON.' }, 400);
  }

  const parsed = OAuthClientMetadataSchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { error: 'invalid_client_metadata', error_description: parsed.error.issues.map((i) => i.message).join('; ') },
      400,
    );
  }
  const meta = parsed.data;

  try {
    const client = await registerClient({
      redirectUris: meta.redirect_uris.map((u) => String(u)),
      clientName: meta.client_name ?? null,
      grantTypes: meta.grant_types,
      tokenEndpointAuthMethod: meta.token_endpoint_auth_method,
      scope: meta.scope ?? OAUTH_SCOPE,
    });

    // RFC 7591 §3.2.1 registration response (public client → no client_secret).
    return json(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        response_types: ['code'],
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        client_name: client.clientName ?? undefined,
        scope: client.scope ?? undefined,
      },
      201,
    );
  } catch (err) {
    if (err instanceof OAuthError) {
      return json({ error: err.code, error_description: err.message }, 400);
    }
    return json({ error: 'server_error', error_description: 'Registration failed.' }, 500);
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
