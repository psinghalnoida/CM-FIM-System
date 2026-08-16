# Global Search — M17

Status: implemented (`lib/search/search.ts`, `app/api/search/route.ts`,
`components/shell/global-search.tsx`) · verified via integration tests
and a real HTTP walkthrough against the built app (see "Verification"
below).

Covers: the header search box M16 left as a disabled placeholder
("coming in M17") is now real — search across incident/claim/vehicle
numbers, wired into a live dropdown with debounced fetch.

## Design decisions and why

**Starts narrow: incident/claim/vehicle number only.** The three fields
already indexed and cheap to search (`incidentNumber`, `claimNumber`,
`registrationNumber` all back a unique/lookup constraint already).
Driver and document search are an explicit follow-up if this isn't
enough — not built ahead of a stated need, matching this project's
practice throughout M1-M16.

**No new access model — reuses every list endpoint's exact scoping
pattern.** `globalSearch()` calls `scopedDb()` + `depotScopeFor()`
identically to `listIncidents`/`listClaims`/`listVehicles` (M4/M6/M7).
A `DEPOT_MANAGER` searching never sees another depot's incident or
vehicle; a search across orgs is structurally impossible (`scopedDb()`
injects `organizationId` into every query). Verified explicitly, not
assumed — see the cross-org and depot-confinement tests below.

**A `POST` body was considered and rejected in favor of a `GET ?q=`
query param.** Search is a read, has no side effects, and a `GET`
lets the browser (and any future caching layer) treat it as
idempotent/cacheable — no reason to deviate from REST convention here.

**5 results per entity type, not a single merged/ranked list.** Keeps
the dropdown small and the query cheap (three independent, bounded
`findMany` calls run in parallel via `Promise.all`, not a single complex
UNION query) — a reasonable simplification for "start typing an ID you
already mostly know," not a general-purpose ranked search engine.

**Update (M28):** the vehicle result now links to `/vehicles/{id}` —
the real Vehicle Detail page M28 built, per the note below it replaced.
See `docs/MASTERS.md`'s M28 section.

~~**The vehicle result links to `/vehicles/{id}/documents`, not
`/vehicles/{id}`.** No standalone vehicle-detail page exists yet — M28
("Vehicle Detail tabbed profile") is what actually builds one. Linking
to a page that 404s would be worse than linking to the one real page
that exists today. Re-point once M28 lands.~~

**Debounced (250ms) client-side fetch, no new dependency.** A plain
`setTimeout`-based debounce in `components/shell/global-search.tsx` —
this project doesn't reach for a search-specific library (Algolia,
Meilisearch, ...) for three `findMany` calls against Postgres; revisit
if result volume or ranking quality ever actually demands it.

## Verification

- **`lib/search/search.integration.test.ts`** (6 tests, real Postgres):
  case-insensitive partial match for each of incident/claim/vehicle
  number; a matching-looking query against another organization returns
  zero results (cross-org isolation, not just assumed from `scopedDb()`
  existing); a `DEPOT_MANAGER` searching their own depot's vehicle finds
  it, searching for another depot's vehicle (by its real registration
  number) finds nothing; a query under 2 characters is rejected.
- **Real HTTP, against the built app**: seeded a real
  incident/claim/vehicle, hit `GET /api/search?q=...` for each of the
  three (including a lowercase query against an uppercase claim number,
  confirming case-insensitivity live, not just in the test suite) — all
  200 with the right result; a 1-character query — **400** with the Zod
  validation message; an unauthenticated request — **401**; confirmed
  the header's real search input (not the old disabled placeholder) is
  what actually renders on a protected page.

## Deferred to a follow-up

- **Driver and org-wide document search** — the two entity types the
  design's search placeholder mentions that aren't covered yet. Add
  once incident/claim/vehicle search proves insufficient on its own.
- **Ranked/fuzzy matching** — today it's a plain `contains` (Postgres
  `ILIKE`); no typo-tolerance or relevance scoring. Fine for searching a
  mostly-known ID, not a general free-text search.
- **A dedicated `/vehicles/{id}` page** — tracked as M28; the search
  result's `href` gets updated in that same milestone.
