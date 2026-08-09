# OCR / Document Parsing — M11

Status: implemented (`lib/ocr/*.ts`, hooks in `lib/documents/document.ts`,
`app/api/documents/[id]/versions/[versionId]/ocr/**`,
`app/documents/[id]/ocr`) · verified via integration tests and real HTTP
+ a real worker process against the built app (see "Verification" below).

Covers: the `OCRProvider` adapter (fixed contract from `docs/SCOPE.md`) +
a deterministic stub implementation, an async extraction job queued via
BullMQ on every document upload/version, and a human-verification step
that — per BR-07 — is the only path by which extracted fields ever touch
master data (Vehicle/Driver).

## Design decisions and why

**The stub provider is a real, committed implementation — not a
placeholder.** `OCR_PROVIDER` defaults to `"stub"`: no external calls, no
AWS credentials, deterministic (same `documentVersionId` always produces
the same fields, via a SHA-256-derived token — not `Math.random()`, so
tests and demos are repeatable). A real Textract adapter is a follow-up
once AWS credentials are confirmed for JBM; setting `OCR_PROVIDER` to
anything else today throws a clear error rather than silently falling
back to fake data (`docs/SCOPE.md` section 7's "adapters without real
credentials fail closed").

**What the stub extracts depends on the document's own type and
linkage, looked up from the DB — not passed through the `OCRProvider`
interface.** The interface is fixed to `extract(documentVersionId,
fileRef)` (section 5); it doesn't carry `documentType`. The stub honors
that contract exactly and does its own lookup internally: a
`REGISTRATION_CERTIFICATE` linked to a `Vehicle` proposes vehicle fields;
a `DRIVING_LICENSE` linked to a `Driver` proposes driver fields; anything
else proposes nothing — a real OCR engine would also find nothing useful
on an unrelated document, so this isn't a special case, it's realistic
behavior.

**Every document upload/version enqueues an extraction — no
per-document-type gating at the call site.** `completeNewDocumentUpload`/
`completeNewVersionUpload` always create a `PENDING` `OcrExtraction` row
and always enqueue the job; the provider is what decides whether there's
anything to extract. Keeping this decision in one place (the provider)
rather than duplicating "does this type need OCR?" logic at every upload
call site was simpler and won't drift as document types are added.

**`verifyOcrExtraction` is one combined action: select fields, apply
them.** Per the explicit choice made before building this: a reviewer
sees each proposed `{key, value, confidence}`, picks which ones to trust,
and one call both marks the extraction `VERIFIED` and writes only the
selected fields to the linked Vehicle/Driver — matching BR-07's
"explicitly reviews and confirms them" as a single deliberate act, not a
"verify" step that has no effect until some later, separate "apply" step
someone might forget to take. Unselected fields, and any selected key
that isn't in that entity type's write allowlist, are silently skipped —
not an error; that's the normal case (e.g. a Vehicle-linked document's
fields never touch a `Driver`).

**Applicable fields are a small, explicit allowlist per entity type**
(`VEHICLE_APPLICABLE_FIELDS`/`DRIVER_APPLICABLE_FIELDS` in
`lib/ocr/verification.ts`), not "whatever key the extraction happens to
contain." This is defense in depth on top of BR-07's human-review gate —
even a compromised or buggy provider can't write to an arbitrary column
by choosing a matching key name; only Vehicle's
registrationNumber/chassisNumber/engineNumber/make/model/
manufactureYear/registrationDate and Driver's
name/licenseNumber/licenseExpiryDate are reachable at all.

**Only Vehicle- and Driver-linked documents get master-data application —
matching `lib/documents/link-scope.ts`'s `SUPPORTED_LINK_TYPES`
exactly**, the only entity types with a real service/RBAC layer today.
Incident-linked documents (once M6's incident linking is added there)
and Policy-linked documents (no service layer exists yet) can still be
uploaded/verified/rejected — they just have an empty allowlist, so
nothing gets applied even if selected.

**Verification RBAC reuses `assertCanManageDocumentsFor`/
`assertCanReadDocumentsFor` exactly** — ORG_ADMIN + depot-scoped
DEPOT_MANAGER can verify/reject; every authenticated role can read,
still depot-scoped. No new "OCR reviewer" role — this is the same
document-management permission M5 already established, not a reason to
invent a new one.

**`OcrExtraction` has no `organizationId` column — access resolves
through `DocumentVersion` → `Document` (which is org-scoped) →
`DocumentLink`**, the same pattern M6's `Evidence` and M7's
`WorkshopActivity` established, applied here from the start rather than
found as a bug later. A cross-org request gets a 404, not a 403 — don't
confirm cross-org existence.

## A real bug found and fixed while building this

**The "server-only" guard broke the worker process, discovered only by
actually running it.** `lib/ocr/queue.ts`, `lib/ocr/process-extraction.ts`,
`lib/ocr/provider.ts`, and `lib/ocr/stub-provider.ts` were all written
with `import "server-only"` at the top, following the pattern used
everywhere else in `lib/`. But `workers/index.ts` runs as a standalone
`tsx` script — outside Next's build entirely, per M1's design — and the
`server-only` package's fallback implementation (used when Next's own
bundler isn't the one loading it) unconditionally throws. The worker
crashed on boot the moment it tried to import the new OCR queue/job
modules. `tsc`, `eslint`, `prettier`, and all 122 vitest tests were clean
and gave no signal — vitest's config already aliases `server-only` to a
stub (see `lib/test/server-only-stub.ts`), which is exactly why the guard
never causes tests to fail while still being wrong for the real worker.
Only running `npm run worker:start` for real (part of this milestone's
HTTP+worker walkthrough) surfaced it. Fixed by removing the guard from
all four files, matching `lib/db.ts`/`lib/redis.ts`'s existing precedent:
files genuinely shared between the Next.js app and the standalone worker
don't get `server-only`, since the worker isn't a place that guard
protects anything by being there. `lib/ocr/verification.ts` keeps the
guard — it's only ever called from API routes, never from the worker.

## Verification

- **`lib/ocr/ocr.integration.test.ts`** (10 tests, real Postgres, a real
  S3-compatible server on its own port, and a real Redis — BullMQ needs a
  live connection to enqueue, so `REDIS_URL` is now a required test env
  var alongside `DATABASE_URL`/`S3_*`, not just the worker's): a
  `REGISTRATION_CERTIFICATE`/Vehicle upload extracts the expected vehicle
  field keys, and the raw response is genuinely readable back from S3
  (not just a key string nothing wrote); a `DRIVING_LICENSE`/Driver
  upload extracts driver fields; an unrelated document type extracts
  nothing; completing an upload really adds a job to the BullMQ queue
  (checked via `getJobCounts()`, not just that the enqueue call didn't
  throw); `verifyOcrExtraction` applies only selected+allowlisted fields
  and leaves an unselected-but-extracted field untouched, with both a
  `Vehicle` UPDATE audit entry and an `OcrExtraction` STATUS_CHANGE audit
  entry; re-verifying a non-`EXTRACTED` extraction is rejected (409);
  `CLAIMS_MANAGER` cannot verify or reject; a `DEPOT_MANAGER` from a
  different depot cannot even read the extraction; `rejectOcrExtraction`
  never writes to master data; a user from another organization gets 404
  (mirroring the M6 `Evidence` fix, tested explicitly here).
- **Real HTTP + a real worker process, against the built app**: uploaded
  a `REGISTRATION_CERTIFICATE` via the actual presign→PUT→complete flow
  (a standalone `s3rver` instance for the walkthrough, since there's no
  persistent MinIO/S3 in this sandbox) → the real `workers/index.ts`
  process (not a direct function call) picked the job off Redis and
  processed it → `GET .../ocr` showed `status: EXTRACTED` with the
  correct fields → `POST .../verify` selecting only `registrationNumber`
  and `make` → the Vehicle's `registrationNumber`/`make` updated to the
  extracted values while `chassisNumber` (extracted but not selected)
  stayed `null` → re-verifying rejected with **409** → `/documents/[id]/ocr`
  rendered correctly. This walkthrough is what caught the `server-only`
  bug above — the worker crashed on the first attempt, was fixed, and
  the walkthrough was re-run clean.

## Deferred to a follow-up

- **A real Textract adapter** — `OCR_PROVIDER=aws-textract` (or similar)
  once AWS credentials are confirmed for JBM. The interface is already
  fixed and the stub proves the whole pipeline around it works.
- **Incident/Policy document OCR application** — uploadable and
  verifiable today (per `SUPPORTED_LINK_TYPES`'s current scope), but
  their allowlist is empty since neither has a master-data write target
  yet in this system.
- **Confidence-based UI hints** (pre-checking high-confidence fields) —
  the reviewer sees the confidence percentage but nothing is
  pre-selected; a deliberately conservative default, not an oversight.
- **A `FAILED` extraction status** — the schema's `OcrStatus` only has
  PENDING/EXTRACTED/VERIFIED/REJECTED; a provider error today leaves the
  row `PENDING` (retryable) and relies on BullMQ's own failure logging,
  rather than inventing a new terminal status this milestone doesn't
  need.
