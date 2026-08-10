import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { logout } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

// Placeholder protected page proving the M3 auth flow end-to-end — kept
// as the post-login landing page/nav hub. The real operational dashboard
// (M9) lives at /dashboards, linked below.
export default async function DashboardPage() {
  const session = await verifySession();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground text-sm">
        Signed in as {session.user.name} ({session.user.email}) —{" "}
        {session.user.role}
      </p>
      <nav className="mt-4 flex gap-4 text-sm">
        <Link
          href="/cities"
          className="text-primary underline underline-offset-4"
        >
          Cities
        </Link>
        <Link
          href="/depots"
          className="text-primary underline underline-offset-4"
        >
          Depots
        </Link>
        <Link
          href="/vehicles"
          className="text-primary underline underline-offset-4"
        >
          Vehicles
        </Link>
        <Link
          href="/drivers"
          className="text-primary underline underline-offset-4"
        >
          Drivers
        </Link>
        <Link
          href="/incidents"
          className="text-primary underline underline-offset-4"
        >
          Incidents
        </Link>
        <Link
          href="/claims"
          className="text-primary underline underline-offset-4"
        >
          Claims
        </Link>
        <Link
          href="/tat/stage-templates"
          className="text-primary underline underline-offset-4"
        >
          TAT stage templates
        </Link>
        <Link
          href="/dashboards"
          className="text-primary underline underline-offset-4"
        >
          Operational dashboard
        </Link>
        <Link
          href="/escalation-rules"
          className="text-primary underline underline-offset-4"
        >
          Escalation rules
        </Link>
      </nav>
      <form action={logout}>
        <Button type="submit" variant="outline" className="mt-4">
          Sign out
        </Button>
      </form>
    </div>
  );
}
