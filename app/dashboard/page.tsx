import { verifySession } from "@/lib/dal";
import { logout } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

// Placeholder protected page proving the M3 auth flow end-to-end. The real
// corporate/depot/claim dashboards are M9 — this page's only job is to
// exist behind verifySession() so M3 has something real to smoke-test
// against, not to be a dashboard.
export default async function DashboardPage() {
  const session = await verifySession();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground text-sm">
        Signed in as {session.user.name} ({session.user.email}) —{" "}
        {session.user.role}
      </p>
      <form action={logout}>
        <Button type="submit" variant="outline" className="mt-2">
          Sign out
        </Button>
      </form>
    </div>
  );
}
