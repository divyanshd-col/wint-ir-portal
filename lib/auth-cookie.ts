/**
 * Whether a request arrived over https, for picking the session cookie name.
 * next-auth names the cookie "__Secure-next-auth.session-token" over https and "next-auth.session-token" otherwise, deciding from the
 * request's own host and protocol. getToken() in the route guard defaults to NEXTAUTH_URL instead, which disagrees behind a tunnel
 * (page on https, NEXTAUTH_URL on http://localhost) and leaves you bounced back to /login after signing in.
 */
export function isHttpsRequest(forwardedProto: string | null | undefined, protocol: string): boolean {
  const first = (forwardedProto ?? '').split(',')[0].trim().toLowerCase();
  return first ? first === 'https' : protocol === 'https:';
}
