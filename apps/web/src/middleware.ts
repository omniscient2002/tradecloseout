import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/guest'];

// These restrictions apply to HTML application pages, not API document-stream
// responses. A PDF may be framed inside the application; the application
// itself must not be framed by another site.
function securePageResponse(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow Next.js internals, static assets, and API proxy routes
  if (
    pathname === '/_next' || pathname.startsWith('/_next/') ||
    pathname === '/api' || pathname.startsWith('/api/') ||
    pathname === '/icons' || pathname.startsWith('/icons/') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js'
  ) {
    return NextResponse.next();
  }

  const isPublicPath = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const sessionCookie = request.cookies.get('tc_session')?.value;

  // 1. Root route / -> Redirect to /login so the user always sees the persona selector / sign-in screen
  if (pathname === '/') {
    return securePageResponse(NextResponse.redirect(new URL('/login', request.url)));
  }

  // 2. Unauthenticated user hitting protected route -> Redirect to /login (SCR-002)
  if (!sessionCookie && !isPublicPath) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return securePageResponse(NextResponse.redirect(loginUrl));
  }

  // 3. Authenticated user or public path -> allow through
  return securePageResponse(NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
