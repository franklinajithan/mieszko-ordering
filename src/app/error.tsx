"use client";

import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

export default function DatabaseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDatabaseError =
    error.message.includes("DATABASE_URL") ||
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("connect") ||
    error.message.includes("password authentication failed");

  return (
    <AppShell title="Something went wrong">
      <div className="max-w-2xl space-y-4 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-950">
        <h2 className="text-lg font-semibold">
          {isDatabaseError ? "Database connection failed" : "Application error"}
        </h2>
        <p>{error.message}</p>
        {isDatabaseError ? (
          <p>
            See setup steps on{" "}
            <Link href="/setup" className="underline">
              /setup
            </Link>
            .
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Link href="/setup">
            <Button variant="outline" type="button">
              Setup guide
            </Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
