import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        403 — Not permitted
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Your account doesn&apos;t have permission to view this page.
      </p>
      <Link
        href="/dashboard"
        className="text-primary text-sm underline underline-offset-4"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
