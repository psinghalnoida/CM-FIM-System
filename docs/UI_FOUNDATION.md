# UI Foundation — M16

Status: implemented (`app/(app)/layout.tsx`, `components/shell/*`,
`app/globals.css`, `app/layout.tsx`) · verified via a real HTTP
walkthrough against the built app (see "Verification" below).

Covers: the nav shell every protected page now renders inside (sidebar +
header), and the Claims Mitra design's color/type/spacing tokens adopted
app-wide. First milestone scoped from the Claims Mitra UI design
(`docs/SCOPE.md`'s "UI/UX alignment" section, M16-M30) — no new data, no
new routes, a shell + restyle over M1-M15's existing pages.

## Design decisions and why

**A route group (`app/(app)/`), not per-page edits.** Route-group parens
don't affect the URL (confirmed against this Next.js version's own docs
before touching anything, per `AGENTS.md`'s "check the version's own
docs first" rule) — so every existing protected page moved into
`app/(app)/**` unchanged, picks up the shared layout automatically, and
every URL stays exactly what it was. `/login` and the root `/` page
deliberately stay *outside* the group — no sidebar/header for a
logged-out visitor. `app/api/**` is untouched (route handlers don't take
page layouts).

**The nav list only links to pages that exist today.** The design's own
sidebar lists 11 items (Dashboard, Incidents, Claims, Surveys, Repairs,
Payments, Fleet, Documents, TAT & Escalations, Reports & MIS,
Administration) — several of those are screens M17-M29 haven't built
yet. `components/shell/nav-items.ts` lists exactly the 9 routes that are
real (Dashboard, Incidents, Claims, Vehicles, Drivers, Depots, Cities,
TAT Stage Templates, Escalation Rules) — never a link that 404s. Grows
as each later milestone lands.

**"Claims Mitra" as the product wordmark, "CM FIM" as a small module
tag beneath it** — confirmed with the user: the design's product name
stays as-is, but this deployment is specifically the Fleet Incident &
claims Management module (as opposed to any sibling CM modules), so the
tag disambiguates which one a user is in. Same placement the design uses
for its own tagline.

**Design tokens mapped onto shadcn/ui's existing variable names**
(`--background`, `--primary`, `--border`, ...) rather than a parallel
token set — every component built across M1-M15 (`Button`, `Input`,
every card/table) picks up the new palette automatically with zero
per-component edits. `--destructive` (form/error red) is kept distinct
from the design's status-tag colors (`--status-green/amber/red-*`, used
for TAT breach state, document validity, etc.) — conflating "this form
field is invalid" with "this case is TAT-breached" would be confusing
even though both are visually "red" in casual terms.

**Poppins (headings) / Inter (body)** replace the scaffold's Geist
fonts, matching the design exactly. Geist Mono is kept for `--font-mono`
— the design has no code/monospace content to match against, so no
reason to change it.

**The `/dashboard` nav-hub page is simplified, not removed.** It used to
be a flat list of links to every module (from M3, before any shared nav
existed) — now redundant with the sidebar. Kept as the post-login
landing page (a welcome message + a link to the real M9 dashboard at
`/dashboards`) rather than deleted outright, since `app/actions/auth.ts`
still redirects here after login and removing the route is a separate
decision nobody asked for.

**Global search is a disabled placeholder, not built yet.** The header
has the input in the right place with the right copy ("coming in M17")
— M17 is exactly the next milestone in `docs/SCOPE.md` and wires it up
for real. Building a fake/non-functional-looking search box would be
worse than an honestly-disabled one.

## Verification

- `tsc`/`eslint`/`prettier` clean repo-wide after the move.
- Full test suite: 149/149 passing, unaffected by the page relocation
  (every test operates at the `lib/` service layer, never imports a page
  by file path — confirmed by grep before moving anything).
- Production build succeeds; the route table is byte-identical to
  before the move (same URLs, same dynamic/static split).
- **Real HTTP walkthrough against the built app**: confirmed the shell
  (sidebar + header, user identity, "Claims Mitra"/"CM FIM" wordmark)
  renders on `/dashboard`, `/claims`, and a nested route (`/incidents/new`);
  confirmed it's genuinely *absent* on `/login` and `/` (only the
  `<title>` tag matches "Claims Mitra" there — the actual sidebar markup
  isn't present, checked explicitly, not just eyeballed); confirmed an
  unauthenticated request to `/dashboard` still redirects to `/login`
  (proxy.ts's matcher is URL-based, unaffected by the file-structure
  change, but verified live rather than assumed).

## Deferred to a follow-up

- **Global search** — M17, the very next milestone.
- **Notifications/Help icons** are static placeholders (`aria-label`
  only, no click handler) — wiring them up isn't scoped to any milestone
  yet; notifications in particular probably wants to pull from M13's
  `EscalationEvent` data, a real design question for whenever that gets
  scoped.
- **Dark mode** — the design defines no dark variant; the scaffold's
  `.dark` CSS block is left as dead weight (unused, no toggle exists)
  rather than deleted, since removing it isn't part of this milestone's
  scope either.
