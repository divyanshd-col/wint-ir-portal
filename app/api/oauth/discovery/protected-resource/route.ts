import { generateProtectedResourceMetadata, getPublicOrigin } from 'mcp-handler';

// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
// Exposed publicly at /.well-known/oauth-protected-resource (and any path
// suffix) via rewrites in next.config.ts. The MCP endpoint's 401 points here
// through its WWW-Authenticate header; claude.ai reads it to learn which
// authorization server protects the resource.
export const runtime = 'nodejs';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store',
};

export function GET(req: Request): Response {
  const origin = getPublicOrigin(req);
  const metadata = generateProtectedResourceMetadata({
    // Must match the "issuer" of the authorization-server metadata above.
    authServerUrls: [origin],
    resourceUrl: `${origin}/api/mcp/mcp`,
    additionalMetadata: { scopes_supported: ['analytics:read'] },
  });
  return Response.json(metadata, { headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
