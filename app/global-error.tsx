"use client"; // Error boundaries must be Client Components — see Next's docs/error.md.

// Handles errors thrown by the root layout itself (app/layout.tsx),
// which app/error.tsx cannot catch (error.tsx wraps everything *below*
// the layout, not the layout/template itself — see Next's own
// docs/error.md). Without this file Next auto-generates a default one
// at build time; on this Next.js version that auto-generated page
// failed to prerender in this sandbox ("Cannot read properties of null
// (reading 'useContext')" during `next build`'s static generation of
// "/_global-error"). Supplying an explicit one — the officially
// documented pattern, not a workaround — sidesteps that page entirely.
//
// Per Next's docs: global-error replaces the root layout when active,
// so it must define its own <html>/<body> and does not inherit
// app/layout.tsx's fonts or globals.css.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h1>Something went wrong</h1>
        <p>
          An unexpected error occurred{error.digest ? ` (${error.digest})` : ""}.
        </p>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
      </body>
    </html>
  );
}
