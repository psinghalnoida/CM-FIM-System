// Integration tests for the M5 document repository (lib/documents/*)
// against real Postgres AND a real S3-compatible server (s3rver, started
// in-process — no Docker needed, unlike MinIO). Exercises the actual
// presign -> PUT -> complete flow over real HTTP, not mocked S3 calls.
//
// Requires DATABASE_URL, SESSION_SECRET, and S3_ENDPOINT/S3_REGION/
// S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_BUCKET pointed at the s3rver
// instance this file starts itself (see beforeAll) — see package.json's
// test script / README for the exact values.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import S3rver from "s3rver";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { s3, getDocumentsBucket } from "@/lib/s3";
import type { AuthSession } from "@/lib/dal";
import {
  completeNewDocumentUpload,
  completeNewVersionUpload,
  getDocument,
  getDownloadUrl,
  listDocumentsForEntity,
  presignDocumentUpload,
  presignVersionUpload,
} from "@/lib/documents/document";

let s3rverInstance: InstanceType<typeof S3rver>;
const s3TestDir = fs.mkdtempSync(path.join(os.tmpdir(), "s3rver-test-"));

beforeAll(async () => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
  process.env.SESSION_SECRET ??= "test-secret-do-not-use-in-real-environments";

  s3rverInstance = new S3rver({
    port: 4569,
    address: "localhost",
    silent: true,
    directory: s3TestDir,
    configureBuckets: [
      { name: process.env.S3_BUCKET ?? "cm-fim-documents-test" },
    ],
  });
  await s3rverInstance.run();
}, 20_000);

afterAll(async () => {
  await s3rverInstance.close();
  fs.rmSync(s3TestDir, { recursive: true, force: true });
});

const cleanup = {
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
  // documentVersion/documentLink/document cascade via document deletion in
  // most ORM setups, but this schema has no ON DELETE CASCADE — delete
  // explicitly, scoped to this org via its vehicles.
  const docLinks = await db.documentLink.findMany({
    where: {
      linkedEntityType: "VEHICLE",
      linkedEntityId: { in: cleanup.vehicleIds },
    },
  });
  const documentIds = docLinks.map((l) => l.documentId);
  await db.document.updateMany({
    where: { id: { in: documentIds } },
    data: { currentVersionId: null },
  });
  await db.documentLink.deleteMany({
    where: { documentId: { in: documentIds } },
  });
  await db.ocrExtraction.deleteMany({
    where: { documentVersion: { documentId: { in: documentIds } } },
  });
  await db.documentVersion.deleteMany({
    where: { documentId: { in: documentIds } },
  });
  await db.document.deleteMany({ where: { id: { in: documentIds } } });

  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.vehicleIds = [];
  cleanup.userIds = [];
  cleanup.depotIds = [];
  cleanup.cityIds = [];
  cleanup.orgIds = [];
});

let uniqueCounter = 0;
function unique(label: string) {
  uniqueCounter += 1;
  return `${label}${uniqueCounter}`;
}

async function seedOrgWithTwoDepotsAndVehicles() {
  const org = await db.organization.create({
    data: { code: unique("M5"), name: "M5 Test Org" },
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

async function uploadViaPresign(
  session: AuthSession,
  linkedEntityId: string,
  fileContent: string,
  fileName = "rc.pdf",
) {
  const { uploadUrl, storageKey } = await presignDocumentUpload(session, {
    linkedEntityType: "VEHICLE",
    linkedEntityId,
    fileName,
  });
  const putRes = await fetch(uploadUrl, { method: "PUT", body: fileContent });
  expect(putRes.ok).toBe(true);
  return storageKey;
}

describe("Document upload (presign -> PUT -> complete)", () => {
  it("creates Document + first DocumentVersion + DocumentLink, and records a CREATE audit entry", async () => {
    const { org, vehicleA } = await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const storageKey = await uploadViaPresign(
      admin,
      vehicleA.id,
      "hello RC contents",
    );
    const document = await completeNewDocumentUpload(admin, {
      storageKey,
      fileName: "rc.pdf",
      documentType: "REGISTRATION_CERTIFICATE",
      title: "RC — test vehicle",
      linkedEntityType: "VEHICLE",
      linkedEntityId: vehicleA.id,
    });

    expect(document.currentVersion?.versionNumber).toBe(1);
    expect(document.currentVersion?.fileName).toBe("rc.pdf");
    // The authoritative size/type come from S3's HeadObject, not client input.
    expect(document.currentVersion?.fileSizeBytes).toBe(
      "hello RC contents".length,
    );
    expect(document.links[0]?.linkedEntityId).toBe(vehicleA.id);

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "Document",
        entityId: document.id,
        action: "CREATE",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("DEPOT_MANAGER can upload for their own depot's vehicle, not another depot's", async () => {
    const { org, depotA, vehicleA, vehicleB } =
      await seedOrgWithTwoDepotsAndVehicles();
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const storageKey = await uploadViaPresign(
      managerA,
      vehicleA.id,
      "own depot doc",
    );
    const document = await completeNewDocumentUpload(managerA, {
      storageKey,
      fileName: "rc.pdf",
      documentType: "REGISTRATION_CERTIFICATE",
      title: "RC",
      linkedEntityType: "VEHICLE",
      linkedEntityId: vehicleA.id,
    });
    expect(document.id).toBeDefined();

    await expect(
      presignDocumentUpload(managerA, {
        linkedEntityType: "VEHICLE",
        linkedEntityId: vehicleB.id,
        fileName: "x.pdf",
      }),
    ).rejects.toThrow();
  });

  it("rejects an upload exceeding the size limit (DOCUMENT_MAX_FILE_SIZE_BYTES) and deletes the S3 object", async () => {
    const { org, vehicleA } = await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const original = process.env.DOCUMENT_MAX_FILE_SIZE_BYTES;
    process.env.DOCUMENT_MAX_FILE_SIZE_BYTES = "5"; // bytes — makes any real fixture "too big"
    try {
      const storageKey = await uploadViaPresign(
        admin,
        vehicleA.id,
        "this is more than 5 bytes",
      );

      await expect(
        completeNewDocumentUpload(admin, {
          storageKey,
          fileName: "toobig.txt",
          documentType: "OTHER",
          title: "Too big",
          linkedEntityType: "VEHICLE",
          linkedEntityId: vehicleA.id,
        }),
      ).rejects.toThrow(/exceeds the 5-byte limit/);

      // The rejected object was deleted from S3, not just refused at the
      // DB layer — a direct HeadObject against its key now 404s.
      await expect(
        s3.send(
          new HeadObjectCommand({
            Bucket: getDocumentsBucket(),
            Key: storageKey,
          }),
        ),
      ).rejects.toThrow();

      // No Document row was created for the rejected upload either.
      const documents = await listDocumentsForEntity(admin, {
        linkedEntityType: "VEHICLE",
        linkedEntityId: vehicleA.id,
      });
      expect(documents).toHaveLength(0);
    } finally {
      if (original === undefined)
        delete process.env.DOCUMENT_MAX_FILE_SIZE_BYTES;
      else process.env.DOCUMENT_MAX_FILE_SIZE_BYTES = original;
    }
  });
});

describe("Document versioning", () => {
  it("adds a new version, updates currentVersion, and records an UPDATE audit entry", async () => {
    const { org, vehicleA } = await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const storageKey1 = await uploadViaPresign(
      admin,
      vehicleA.id,
      "v1 contents",
    );
    const document = await completeNewDocumentUpload(admin, {
      storageKey: storageKey1,
      fileName: "policy-v1.pdf",
      documentType: "INSURANCE_POLICY",
      title: "Insurance Policy",
      linkedEntityType: "VEHICLE",
      linkedEntityId: vehicleA.id,
    });

    const { uploadUrl, storageKey: storageKey2 } = await presignVersionUpload(
      admin,
      document.id,
      "policy-v2.pdf",
    );
    await fetch(uploadUrl, { method: "PUT", body: "v2 contents, renewed" });

    const version2 = await completeNewVersionUpload(admin, document.id, {
      storageKey: storageKey2,
      fileName: "policy-v2.pdf",
    });
    expect(version2.versionNumber).toBe(2);

    const refetched = await getDocument(admin, document.id);
    expect(refetched?.currentVersion?.id).toBe(version2.id);
    expect(refetched?.versions).toHaveLength(2);

    const updateAudit = await db.auditLog.findFirst({
      where: {
        entityType: "Document",
        entityId: document.id,
        action: "UPDATE",
      },
    });
    expect(updateAudit).not.toBeNull();
  });
});

describe("Document reads", () => {
  it("a presigned download URL actually serves the current version's content", async () => {
    const { org, vehicleA } = await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const storageKey = await uploadViaPresign(
      admin,
      vehicleA.id,
      "the actual file bytes",
    );
    const document = await completeNewDocumentUpload(admin, {
      storageKey,
      fileName: "doc.txt",
      documentType: "OTHER",
      title: "Doc",
      linkedEntityType: "VEHICLE",
      linkedEntityId: vehicleA.id,
    });

    const { downloadUrl, fileName } = await getDownloadUrl(admin, document.id);
    expect(fileName).toBe("doc.txt");
    const res = await fetch(downloadUrl);
    expect(await res.text()).toBe("the actual file bytes");
  });

  it("DEPOT_MANAGER cannot read documents linked to another depot's vehicle; other roles can", async () => {
    const { org, depotA, vehicleB } = await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const claimsManager = await userSessionWithRole(
      org,
      depotA.id,
      "CLAIMS_MANAGER",
    );

    const storageKey = await uploadViaPresign(
      admin,
      vehicleB.id,
      "depot B doc",
    );
    const document = await completeNewDocumentUpload(admin, {
      storageKey,
      fileName: "doc.txt",
      documentType: "OTHER",
      title: "Depot B doc",
      linkedEntityType: "VEHICLE",
      linkedEntityId: vehicleB.id,
    });

    await expect(getDocument(managerA, document.id)).rejects.toThrow();
    // CLAIMS_MANAGER isn't depot-restricted — full org read access (docs/MASTERS.md).
    const asClaimsManager = await getDocument(claimsManager, document.id);
    expect(asClaimsManager?.id).toBe(document.id);
  });

  it("listDocumentsForEntity returns only documents linked to that entity", async () => {
    const { org, vehicleA, vehicleB } = await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const keyA = await uploadViaPresign(admin, vehicleA.id, "for A");
    await completeNewDocumentUpload(admin, {
      storageKey: keyA,
      fileName: "a.txt",
      documentType: "OTHER",
      title: "For vehicle A",
      linkedEntityType: "VEHICLE",
      linkedEntityId: vehicleA.id,
    });
    const keyB = await uploadViaPresign(admin, vehicleB.id, "for B");
    await completeNewDocumentUpload(admin, {
      storageKey: keyB,
      fileName: "b.txt",
      documentType: "OTHER",
      title: "For vehicle B",
      linkedEntityType: "VEHICLE",
      linkedEntityId: vehicleB.id,
    });

    const docsForA = await listDocumentsForEntity(admin, {
      linkedEntityType: "VEHICLE",
      linkedEntityId: vehicleA.id,
    });
    expect(docsForA.map((d) => d.title)).toEqual(["For vehicle A"]);
  });
});
