import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, adminPassword, verifySessionToken } from './lib/auth';

// Gate the whole admin panel behind a session cookie.
//
// Fails CLOSED: if ADMIN_PASSWORD isn't configured, nobody gets in (the login
// page explains how to set it). That's deliberate — this panel can approve and
// edit published content, so "no password configured" must never mean "open".
export async function middleware(req: NextRequest) {
  const secret = adminPassword();
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (secret && (await verifySessionToken(secret, token))) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  // Preserve where they were headed so login can send them back.
  const dest = req.nextUrl.pathname + req.nextUrl.search;
  url.search = dest && dest !== '/' ? `?next=${encodeURIComponent(dest)}` : '';

  const res = NextResponse.redirect(url);
  if (token) res.cookies.delete(SESSION_COOKIE); // clear an expired/invalid cookie
  return res;
}

export const config = {
  // Everything except the login route, Next internals, and the PWA files that
  // must be reachable for "Add to Home Screen" to work.
  matcher: [
    '/((?!login|_next/static|_next/image|icon.svg|sw.js|manifest.webmanifest|favicon.ico).*)',
  ],
};
