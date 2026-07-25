import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

export default function DatabaseSetupPage() {
  return (
    <AppShell title="Database setup required">
      <div className="max-w-2xl space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
        <h2 className="text-lg font-semibold">PostgreSQL is not configured</h2>
        <p>
          The app needs a running PostgreSQL database and a{" "}
          <code className="rounded bg-white px-1">DATABASE_URL</code> in your{" "}
          <code className="rounded bg-white px-1">.env</code> file.
        </p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Add{" "}
            <code className="rounded bg-white px-1">DATABASE_URL</code> to your{" "}
            <code className="rounded bg-white px-1">.env</code> file
          </li>
          <li>
            Apply schema:{" "}
            <code className="rounded bg-white px-1">npm run db:push</code>
          </li>
          <li>
            Seed stores and suppliers:{" "}
            <code className="rounded bg-white px-1">npm run db:seed</code>
          </li>
          <li>
            Run the app with{" "}
            <code className="rounded bg-white px-1">npm run dev</code>
          </li>
        </ol>
        <Link href="/">
          <Button type="button">Back to home</Button>
        </Link>
      </div>
    </AppShell>
  );
}
