import { NextResponse, type NextRequest } from 'next/server';

// Passes the requested path to server components (x-pathname), so a guard in a
// layout can send a guest to sign-in and back to the exact page they opened.
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-pathname', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/|api/|assets/|photos/|uploads/|favicon).*)'],
};
