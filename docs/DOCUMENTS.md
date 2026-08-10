# Document Repository — M5

Status: implemented (`lib/documents/*.ts`, `lib/s3.ts`,
`app/api/documents/**`, one demo page) · verified against a real S3-
compatible server (see "Verification" below) and real HTTP against the
built app.

Covers: presigned-URL file upload to S3-compatible storage, versioning
(BR-04, building on the `Document`/`DocumentVersion` schema from M2a),
validity-date fields, and linkage to Vehicle/Driver (the `DocumentLink`
generic join from M2a). OCR extraction hook-up is **not** this milestone —
that's M11.

## The upload flow

```mermaid
sequenceDiagram
    participant Browser
    participant API as Next.js API route
    participant S3 as S3 / MinIO

    Browser->>API: POST /api/documents/presign-upload<br/>{ linkedEntityType, linkedEntityId, fileName }
    API->>API: assertCanManageDocumentsFor() — RBAC + depot-scope, BEFORE issuing a URL
    API-->>Browser: { uploadUrl, storageKey } (5 min expiry)
    Browser->>S3: PUT uploadUrl, file bytes (direct, not through the Next.js server)
    S3-->>Browser: 200
    Browser->>API: POST /api/documents<br/>{ storageKey, fileName, documentType, title, linkedEntityType, linkedEntityId }
    API->>S3: HeadObject(storageKey) — authoritative size/content-type
    API->>API: reject + delete object if oversized
    API->>API: create Document + DocumentVersion(1) + DocumentLink, in one transaction
    API-->>Browser: 201, the Document with its current version
```

New versions of an existing document follow the same two-step shape
against `/api/documents/:id/versions/presign-upload` and
`/api/documents/:id/versions`.

## Design decisions and why

**Presigned URLs — the browser uploads directly to S3/MinIO, never through
the Next.js server.** The app server's job is authorization (deciding
*whether* an upload may happen and handing back a short-lived signed URL)
and bookkeeping (recording that it happened) — never moving the file bytes
themselves. This keeps the server's bandwidth/memory footprint flat
regardless of file size, which matters once video evidence (a later
milestone, same storage layer) is in play.

**The authoritative file size and content-type come from S3's own
`HeadObject`, never from client-reported values.** After the browser PUTs
the file, "complete" calls `HeadObjectCommand` before writing anything to
the database — a client could otherwise lie about either (report a small
size while uploading something huge, or claim a `mimeType` that doesn't
match the bytes). This also simplifies the "complete" request body: it
never needs to carry `fileSizeBytes`/`mimeType` at all.

**RBAC/depot-scoping is checked at presign time, not just at complete
time.** `assertCanManageDocumentsFor()` (`lib/documents/link-scope.ts`)
runs before a presigned URL is even issued — an unauthorized user never
gets a valid upload URL in the first place, not just a rejected "complete"
call afterward. It's checked again at complete time too (defense in
depth, since presign and complete are two independent requests).

**Document access is resolved through whatever it's linked to — currently
only VEHICLE and DRIVER.** `lib/documents/link-scope.ts` mirrors
`lib/masters/{vehicle,driver}.ts`'s RBAC exactly: ORG_ADMIN + DEPOT_MANAGER
can manage documents (create/version), DEPOT_MANAGER confined to their own
depot's vehicles/drivers (for both writes *and* reads, matching M4); every
other authenticated role reads org-wide. `INCIDENT`, `POLICY`, `CLAIM`,
`SURVEY`, `REPAIR_JOB` are already valid values in the `LinkedEntityType`
enum (M2a) but have no service/RBAC layer yet — linking a document to one
of them throws a clear "not supported yet" error rather than silently
succeeding with no access control. Each of those gets a case added to
`resolveDepotId()` when its owning module lands (M6 for Incident, M7+ for
the rest).

**A document has exactly one link, set at creation.** `CompleteNewDocumentSchema`
requires `linkedEntityType`/`linkedEntityId` — there's no "create an
orphan document, link it later" path in M5. Keeps scope-resolution
(`document.links[0]`) simple; revisit if a real need for multi-linked
documents (e.g. one estimate shared across two repair jobs) shows up.

**Storage keys are opaque UUIDs, not human-readable paths.**
`documents/{uuid}-{sanitized filename}`, the same shape whether it's a
brand-new document's first version or a later version of an existing one.
S3 keys don't need to be navigable by a person — they're only ever
resolved through the `DocumentVersion` row that owns them — so there's no
value in encoding `documentId`/version-number into the path, and doing so
would have needed a "rename" step to move a staging upload into a
canonical path (extra complexity for no real benefit).

**Presigned URLs expire in 5 minutes, both for upload and download.**
Long enough for a real upload/download to complete, short enough that a
leaked URL (logged somewhere, shared accidentally) stops working quickly.
Downloads are never a public bucket URL — every download goes through
`GET /api/documents/:id/download-url`, which re-checks read access before
minting a fresh signed URL.

**`DOCUMENT_MAX_FILE_SIZE_BYTES` is a runtime-configurable env var
(default 100MB), read fresh on every check rather than cached.** Doubles
as a real ops knob (tune the limit without a code change) and as the
mechanism that makes the size-limit rejection path actually testable
(`lib/documents/document.integration.test.ts` sets it to 5 bytes for one
test, rather than needing a 100MB fixture in the test suite).

## Deferred to a follow-up

- **Full document management UI.** M5 ships one demo page
  (`app/vehicles/[id]/documents/page.tsx`) with a bare upload form and a
  version-count list, proving the service/API layer end-to-end — not
  metadata editing, version-history browsing, or a documents view on the
  Driver side (the API/service layer already supports Driver, it just has
  no page yet).
- **Bulk/CSV-adjacent import.** Same reasoning as M4 — a distinct feature
  with its own UX questions.
- **Validity-date expiry alerting.** `validityStartDate`/`validityExpiryDate`
  are stored and can be queried, but nothing surfaces "this document
  expires soon" yet — that's M13 (Notifications/escalations)'s job, per
  `docs/SCOPE.md`.
- **Orphaned-upload cleanup.** A presigned upload that's issued but never
  completed (browser closed mid-upload, network failure) leaves an object
  in S3 with no DB row referencing it. Not cleaned up automatically — an
  S3 lifecycle policy (expire objects under `documents/` older than N
  days with no corresponding `DocumentVersion.storageKey`) would be the
  right fix, deferred until it's an actual operational problem rather than
  a theoretical one.
- **Content-type allow-listing / virus scanning.** Not enforced — a
  real content-security policy decision better made with actual
  requirements than guessed at now.

## Verification

- **`lib/documents/document.integration.test.ts`** (7 tests) — against a
  *real* S3-compatible server: [s3rver](https://github.com/jamhall/s3rver)
  started in-process in `beforeAll` (no Docker needed, unlike MinIO — see
  the note in `docs/SCOPE.md`/`README.md` about Docker Hub pulls being
  blocked in this sandbox). Every test exercises the actual presigned URL
  over real HTTP (`fetch(uploadUrl, { method: "PUT", body })`), not a
  mocked S3 client:
  - Full create flow: Document + first DocumentVersion + DocumentLink,
    with the stored `fileSizeBytes` matching what was actually uploaded
    (proving `HeadObject` is really what's used, not client input), plus
    a `CREATE` audit entry.
  - DEPOT_MANAGER can upload for their own depot's vehicle, forbidden for
    another depot's.
  - Oversized upload (via `DOCUMENT_MAX_FILE_SIZE_BYTES` set to 5 bytes
    for the test) is rejected, the S3 object is actually deleted
    (confirmed via a direct `HeadObject` 404), and no `Document` row is
    left behind.
  - New-version flow: version 2 created, `currentVersion` updated,
    `UPDATE` audit entry recorded.
  - A presigned download URL serves the exact bytes that were uploaded.
  - DEPOT_MANAGER cannot read a document linked to another depot's
    vehicle; a non-DEPOT_MANAGER role (CLAIMS_MANAGER) can.
  - `listDocumentsForEntity` returns only documents linked to the
    requested entity.
- **Real HTTP, against the built app + a separately-started s3rver
  instance**: the full presign → PUT → complete → list → download-URL →
  fetch round trip via `curl`, confirming the exact uploaded file content
  comes back byte-for-byte through the download URL, and that the demo
  page renders the uploaded document's title.
