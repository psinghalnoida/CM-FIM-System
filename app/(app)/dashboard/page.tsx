import Link from "next/link";
import { verifySession } from "@/lib/dal";

// Post-login landing page. Used to double as a flat nav-hub linking every
// module (kept from M3, before M16's sidebar existed) — that list is now
// redundant with the sidebar, so this just welcomes the user and points
// at the real operational dashboard (M9).
export default async function DashboardPage() {
  const session = await verifySession();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Welcome, {session.user.name}
      </h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {session.user.role} · Signed in as {session.user.email}
      </p>
      <Link
        href="/dashboards"
        className="text-primary mt-4 inline-block text-sm underline underline-offset-4"
      >
        Go to the operational dashboard →
      </Link>
    </div>
  );
}
