import { getPublicOrigin } from 'mcp-handler';
import { OAUTH_SCOPE } from '@/lib/mcp/oauth';

// RFC 8414 — OAuth 2.0 Authorization Server Metadata.
// Exposed publicly at /.well-known/oauth-authorization-server via a rewrite in
// next.config.ts. claude.ai fetches this to discover the authorize / token /
// register endpoints. Absolute URLs are derived from the public origin so the
// document is correct in every environment (local, preview, prod).
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store',
};

export function GET(req: Request): Response {
  const origin = getPublicOrigin(req);
  const metadata = {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
  return Response.json(metadata, { headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
