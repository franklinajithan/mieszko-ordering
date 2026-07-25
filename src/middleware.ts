import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
  if (hasDatabase) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === "/setup" || pathname.startsWith("/setup/")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        success: false,
        error:
          "DATABASE_URL is not set. Configure PostgreSQL — see /setup for instructions.",
      },
      { status: 503 },
    );
  }

  return NextResponse.redirect(new URL("/setup", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
