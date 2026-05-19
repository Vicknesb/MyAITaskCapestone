import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/repos", "/settings"];
const AUTH_ONLY = ["/login", "/register"]; // redirect to dashboard if already have a session

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const sessionCookie = req.cookies.get("devpulse_session")?.value;

  const res = NextResponse.next();

  // ── Security headers ────────────────────────────────────────────────────────
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`, // unsafe-eval only in dev (Next.js HMR)
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://avatars.githubusercontent.com",
      "connect-src 'self'",
      "font-src 'self'",
    ].join("; ")
  );

  // ── Route protection ────────────────────────────────────────────────────────
  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));
  const isAuthRoute  = AUTH_ONLY.some((p) => pathname.startsWith(p));

  if (isProtected && !sessionCookie) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthRoute && sessionCookie) {
    const dashUrl = req.nextUrl.clone();
    dashUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashUrl);
  }

  return res;
}

export const config = {
  matcher: [
    // Run on all routes except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
