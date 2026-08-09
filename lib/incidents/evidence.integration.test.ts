// Integration tests for M6 evidence upload (lib/incidents/evidence.ts)
// against real Postgres AND a real S3-compatible server (s3rver, started
// in-process — same approach as lib/documents/document.integration.test.ts).
//
// Uses a different port (4570) than the document repository's test s3rver
// (4569), since Vitest can run test files concurrently in separate worker
// processes and two files both binding 4569 would conflict.
//
// lib/s3.ts's S3 client is a module-load-time singleton that reads
// S3_ENDPOINT etc. from process.env when it's first imported. This file's
// own S3_* values are set in beforeAll — AFTER that point for a static
// `import ... from "@/lib/incidents/evidence"` at the top of the file, so
// everything that transitively touches lib/s3.ts is imported dynamically
// here instead, deferred until after beforeAll has set the right env.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import S3rver from "s3rver";
import type { HeadObjectCommand as HeadObjectCommandType } from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import type * as EvidenceModule from "@/lib/incidents/evidence";
import type * as IncidentModule from "@/lib/incidents/incident";
import type * as S3Module from "@/lib/s3";

let s3rverInstance: InstanceType<typeof S3rver>;
const s3TestDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "s3rver-evidence-test-"),
);
const EVIDENCE_S3_PORT = 4570;

let completeEvidenceUpload: typeof EvidenceModule.completeEvidenceUpload;
let getEvidenceDownloadUrl: typeof EvidenceModule.getEvidenceDownloadUrl;
let listEvidence: typeof EvidenceModule.listEvidence;
let presignEvidenceUpload: typeof EvidenceModule.presignEvidenceUpload;
let createIncident: typeof IncidentModule.createIncident;
let s3: typeof S3Module.s3;
let getDocumentsBucket: typeof S3Module.getDocumentsBucket;
let HeadObjectCommand: typeof HeadObjectCommandType;

beforeAll(async () => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
  process.env.SESSION_SECRET ??= "test-secret-do-not-use-in-real-environments";
  process.env.S3_ENDPOINT = `http://localhost:${EVIDENCE_S3_PORT}`;
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = "S3RVER";
  process.env.S3_SECRET_ACCESS_KEY = "S3RVER";
  process.env.S3_BUCKET = "cm-fim-documents-test";
  process.env.S3_FORCE_PATH_STYLE = "true";

  s3rverInstance = new S3rver({
    port: EVIDENCE_S3_PORT,
    address: "localhost",
    silent: true,
    directory: s3TestDir,
    configureBuckets: [{ name: "cm-fim-documents-test" }],
  });
  await s3rverInstance.run();

  // Dynamic, and only now — see the file header for why.
  ({
    completeEvidenceUpload,
    getEvidenceDownloadUrl,
    listEvidence,
    presignEvidenceUpload,
  } = await import("@/lib/incidents/evidence"));
  ({ createIncident } = await import("@/lib/incidents/incident"));
  ({ s3, getDocumentsBucket } = await import("@/lib/s3"));
  ({ HeadObjectCommand } = await import("@aws-sdk/client-s3"));
}, 20_000);

afterAll(async () => {
  await s3rverInstance.close();
  fs.rmSync(s3TestDir, { recursive: true, force: true });
});

const cleanup = {
  incidentIds: [] as string[],
  vehicleIds: [] as string[],
  userIds: [] as string[],
  depotIds: [] as string[],
  cityIds: [] as string[],
  orgIds: [] as string[],
};

afterEach(async () => {
  await db.auditLog.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.idCounter.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.evidence.deleteMany({
    where: { incidentId: { in: cleanup.incidentIds } },
  });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.incidentIds = [];
  cleanup.vehicleIds = [];
  cleanup.userIds = [];
  cleanup.depotIds = [];
  cleanup.cityIds = [];
  cleanup.orgIds = [];
});

let uniqueCounter = 0;
// See lib/incidents/incident.integration.test.ts for why the random
// suffix is needed, not just the counter — cross-file/cross-process
// collisions on User.email's global unique constraint.
function unique(label: string) {
  uniqueCounter += 1;
  return `${label}${uniqueCounter}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedIncidentInTwoDepotOrg() {
  const org = await db.organization.create({
    data: { code: unique("M6EV"), name: "M6 Evidence Test Org" },
  });
  cleanup.orgIds.push(org.id);
  const city = await db.city.create({
    data: { organizationId: org.id, name: "City" },
  });
  cleanup.cityIds.push(city.id);
  const depotA = await db.depot.create({
    data: {
      organizationId: org.id,
      cityId: city.id,
      code: unique("DA"),
      name: "Depot A",
    },
  });
  const depotB = await db.depot.create({
    data: {
      organizationId: org.id,
      cityId: city.id,
      code: unique("DB"),
      name: "Depot B",
    },
  });
  cleanup.depotIds.push(depotA.id, depotB.id);
  const vehicleA = await db.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depotA.id,
      registrationNumber: unique("VA"),
    },
  });
  const vehicleB = await db.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depotB.id,
      registrationNumber: unique("VB"),
    },
  });
  cleanup.vehicleIds.push(vehicleA.id, vehicleB.id);
  return { org, depotA, depotB, vehicleA, vehicleB };
}

async function userSessionWithRole(
  org: { id: string },
  depotId: string | null,
  role: "ORG_ADMIN" | "DEPOT_MANAGER" | "CLAIMS_MANAGER",
): Promise<AuthSession> {
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      depotId,
      name: role,
      email: `${unique(role)}@example.com`,
      role,
    },
  });
  cleanup.userIds.push(user.id);
  return {
    id: "fake-session",
    userId: user.id,
    expiresAt: new Date(Date.now() + 100_000),
    revokedAt: null,
    createdAt: new Date(),
    user,
  } as AuthSession;
}

async function createTestIncident(session: AuthSession, vehicleId: string) {
  const incident = await createIncident(session, {
    vehicleId,
    incidentDateTime: new Date(),
    incidentType: "ACCIDENT",
    description: "Test incident for evidence.",
  });
  cleanup.incidentIds.push(incident.id);
  return incident;
}

async function uploadViaPresign(
  session: AuthSession,
  incidentId: string,
  content: string,
  fileName = "photo1.jpg",
) {
  const { uploadUrl, storageKey } = await presignEvidenceUpload(
    session,
    incidentId,
    { fileName },
  );
  const putRes = await fetch(uploadUrl, { method: "PUT", body: content });
  expect(putRes.ok).toBe(true);
  return storageKey;
}

describe("Evidence upload", () => {
  it("creates an Evidence row from real S3 content, and records a CREATE audit entry", async () => {
    const { org, vehicleA } = await seedIncidentInTwoDepotOrg();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const incident = await createTestIncident(admin, vehicleA.id);

    const storageKey = await uploadViaPresign(
      admin,
      incident.id,
      "fake photo bytes",
    );
    const evidence = await completeEvidenceUpload(admin, incident.id, {
      storageKey,
      fileName: "photo1.jpg",
      evidenceType: "PHOTO",
      caption: "Front bumper damage",
    });

    expect(evidence.fileSizeBytes).toBe("fake photo bytes".length);
    expect(evidence.incidentId).toBe(incident.id);

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "Evidence",
        entityId: evidence.id,
        action: "CREATE",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("DEPOT_MANAGER can upload evidence for their own depot's incident, not another depot's", async () => {
    const { org, depotA, vehicleA, vehicleB } =
      await seedIncidentInTwoDepotOrg();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const incidentA = await createTestIncident(admin, vehicleA.id);
    const incidentB = await createTestIncident(admin, vehicleB.id);

    const storageKey = await uploadViaPresign(
      managerA,
      incidentA.id,
      "own depot",
    );
    const evidence = await completeEvidenceUpload(managerA, incidentA.id, {
      storageKey,
      fileName: "a.jpg",
      evidenceType: "PHOTO",
    });
    expect(evidence.id).toBeDefined();

    await expect(
      presignEvidenceUpload(managerA, incidentB.id, { fileName: "b.jpg" }),
    ).rejects.toThrow();
  });

  it("rejects an oversized upload (EVIDENCE_MAX_FILE_SIZE_BYTES) and deletes the S3 object", async () => {
    const { org, vehicleA } = await seedIncidentInTwoDepotOrg();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const incident = await createTestIncident(admin, vehicleA.id);

    const original = process.env.EVIDENCE_MAX_FILE_SIZE_BYTES;
    process.env.EVIDENCE_MAX_FILE_SIZE_BYTES = "5";
    try {
      const storageKey = await uploadViaPresign(
        admin,
        incident.id,
        "more than 5 bytes",
      );

      await expect(
        completeEvidenceUpload(admin, incident.id, {
          storageKey,
          fileName: "toobig.jpg",
          evidenceType: "PHOTO",
        }),
      ).rejects.toThrow(/exceeds the 5-byte limit/);

      await expect(
        s3.send(
          new HeadObjectCommand({
            Bucket: getDocumentsBucket(),
            Key: storageKey,
          }),
        ),
      ).rejects.toThrow();

      const remaining = await listEvidence(admin, incident.id);
      expect(remaining).toHaveLength(0);
    } finally {
      if (original === undefined)
        delete process.env.EVIDENCE_MAX_FILE_SIZE_BYTES;
      else process.env.EVIDENCE_MAX_FILE_SIZE_BYTES = original;
    }
  });
});

describe("Evidence reads", () => {
  it("a presigned download URL serves the exact uploaded content", async () => {
    const { org, vehicleA } = await seedIncidentInTwoDepotOrg();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const incident = await createTestIncident(admin, vehicleA.id);

    const storageKey = await uploadViaPresign(
      admin,
      incident.id,
      "the real evidence bytes",
    );
    const evidence = await completeEvidenceUpload(admin, incident.id, {
      storageKey,
      fileName: "evidence.jpg",
      evidenceType: "PHOTO",
    });

    const { downloadUrl, fileName } = await getEvidenceDownloadUrl(
      admin,
      evidence.id,
    );
    expect(fileName).toBe("evidence.jpg");
    const res = await fetch(downloadUrl);
    expect(await res.text()).toBe("the real evidence bytes");
  });

  it("DEPOT_MANAGER cannot read evidence for another depot's incident", async () => {
    const { org, depotA, vehicleB } = await seedIncidentInTwoDepotOrg();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const incidentB = await createTestIncident(admin, vehicleB.id);

    const storageKey = await uploadViaPresign(
      admin,
      incidentB.id,
      "depot B evidence",
    );
    const evidence = await completeEvidenceUpload(admin, incidentB.id, {
      storageKey,
      fileName: "b.jpg",
      evidenceType: "PHOTO",
    });

    await expect(
      getEvidenceDownloadUrl(managerA, evidence.id),
    ).rejects.toThrow();
  });
});
