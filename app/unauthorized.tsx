import Link from "next/link";

export default function Unauthorized() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        401 — Sign in required
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        You need to be signed in to view this page.
      </p>
      <Link
        href="/login"
        className="text-primary text-sm underline underline-offset-4"
      >
        Go to login
      </Link>
    </div>
  );
}
