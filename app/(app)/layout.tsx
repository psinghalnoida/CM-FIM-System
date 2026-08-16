import { verifySession } from "@/lib/dal";
import { Sidebar } from "@/components/shell/sidebar";
import { Header } from "@/components/shell/header";
import { MitraWidget } from "@/components/shell/mitra-widget";

// M16: the nav shell every protected page renders inside — a route
// group (parens don't affect the URL) so this wraps every page under
// app/(app)/** without touching each page's own markup. /login and the
// root / page stay outside this group deliberately: no shell for a
// logged-out visitor. See docs/UI_FOUNDATION.md.
//
// verifySession() here is a real (DB-hitting) check, not redundant with
// proxy.ts's optimistic cookie check — proxy.ts only decrypts the cookie
// for a fast redirect; this is the actual authorization boundary, same
// as every protected page has always called individually. See
// docs/AUTH.md.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={session.user} />
        <main className="min-w-0 flex-1 overflow-x-auto">{children}</main>
      </div>
      <MitraWidget />
    </div>
  );
}
