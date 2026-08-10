import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">CM FIM System</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Fleet Incident &amp; Insurance Claim Management System. Under
        construction — see <code>docs/SCOPE.md</code> for the delivery plan.
      </p>
      <Link
        href="/login"
        className="text-primary text-sm underline underline-offset-4"
      >
        Sign in
      </Link>
    </div>
  );
}
