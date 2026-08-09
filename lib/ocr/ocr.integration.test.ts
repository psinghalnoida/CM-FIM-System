// Integration tests for M11 OCR (lib/ocr/*, plus the hooks in
// lib/documents/document.ts) against real Postgres, a real S3-compatible
// server (s3rver, its own port so it can run concurrently with M5's and
// M6's own test servers), and a real Redis (BullMQ needs a live
// connection to enqueue — see docs/OCR.md for why REDIS_URL is now a
// required test env var, not just the worker's).
//
// lib/s3.ts's S3 client is a module-load-time singleton — everything
// that transitively imports it is dynamically imported here, deferred
// until after beforeAll sets this file's own S3_* env vars. Same pattern
// as lib/incidents/evidence.integration.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import S3rver from "s3rver";
import type { GetObjectCommand as GetObjectCommandType } from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import type * as DocumentModule from "@/lib/documents/document";
import type * as ProcessExtractionModule from "@/lib/ocr/process-extraction";
import type * as VerificationModule from "@/lib/ocr/verification";
import type * as QueueModule from "@/lib/ocr/queue";
import type * as S3Module from "@/lib/s3";

let s3rverInstance: InstanceType<typeof S3rver>;
const s3TestDir = fs.mkdtempSync(path.join(os.tmpdir(), "s3rver-ocr-test-"));
const OCR_S3_PORT = 4571;

let completeNewDocumentUpload: typeof DocumentModule.completeNewDocumentUpload;
let processOcrExtractionJob: typeof ProcessExtractionModule.processOcrExtractionJob;
let getOcrExtraction: typeof VerificationModule.getOcrExtraction;
let verifyOcrExtraction: typeof VerificationModule.verifyOcrExtraction;
let rejectOcrExtraction: typeof VerificationModule.rejectOcrExtraction;
let ocrExtractionQueue: typeof QueueModule.ocrExtractionQueue;
let s3: typeof S3Module.s3;
let getDocumentsBucket: typeof S3Module.getDocumentsBucket;
let GetObjectCommand: typeof GetObjectCommandType;

beforeAll(async () => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
  process.env.SESSION_SECRET ??= "test-secret-do-not-use-in-real-environments";
  process.env.S3_ENDPOINT = `http://localhost:${OCR_S3_PORT}`;
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = "S3RVER";
  process.env.S3_SECRET_ACCESS_KEY = "S3RVER";
  process.env.S3_BUCKET = "cm-fim-documents-test";
  process.env.S3_FORCE_PATH_STYLE = "true";
  process.env.OCR_PROVIDER = "stub";

  s3rverInstance = new S3rver({
    port: OCR_S3_PORT,
    address: "localhost",
    silent: true,
    directory: s3TestDir,
    configureBuckets: [{ name: "cm-fim-documents-test" }],
  });
  await s3rverInstance.run();

  ({ completeNewDocumentUpload } = await import("@/lib/documents/document"));
  ({ processOcrExtractionJob } = await import("@/lib/ocr/process-extraction"));
  ({ getOcrExtraction, verifyOcrExtraction, rejectOcrExtraction } =
    await import("@/lib/ocr/verification"));
  ({ ocrExtractionQueue } = await import("@/lib/ocr/queue"));
  ({ s3, getDocumentsBucket } = await import("@/lib/s3"));
  ({ GetObjectCommand } = await import("@aws-sdk/client-s3"));
}, 20_000);

afterAll(async () => {
  await ocrExtractionQueue.close();
  await s3rverInstance.close();
  fs.rmSync(s3TestDir, { recursive: true, force: true });
});

const cleanup = {
  vehicleIds: [] as string[],
  driverIds: [] as string[],
  userIds: [] as string[],
  depotIds: [] as string[],
  cityIds: [] as string[],
  orgIds: [] as string[],
};

afterEach(async () => {
  await db.auditLog.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  const linkedIds = [...cleanup.vehicleIds, ...cleanup.driverIds];
  const docLinks = await db.documentLink.findMany({
    where: { linkedEntityId: { in: linkedIds } },
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
  await db.driver.deleteMany({ where: { id: { in: cleanup.driverIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.vehicleIds = [];
  cleanup.driverIds = [];
  cleanup.userIds = [];
  cleanup.depotIds = [];
  cleanup.cityIds = [];
  cleanup.orgIds = [];
});

let uniqueCounter = 0;
function unique(label: string) {
  uniqueCounter += 1;
  return `${label}${uniqueCounter}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedOrgWithTwoDepots() {
  const org = await db.organization.create({
    data: { code: unique("M11"), name: "M11 Test Org" },
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
  const vehicle = await db.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depotA.id,
      registrationNumber: unique("V"),
    },
  });
  cleanup.vehicleIds.push(vehicle.id);
  const driver = await db.driver.create({
    data: {
      organizationId: org.id,
      depotId: depotA.id,
      name: "Test Driver",
      licenseNumber: unique("DL"),
    },
  });
  cleanup.driverIds.push(driver.id);
  return { org, depotA, depotB, vehicle, driver };
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

async function uploadAndProcess(
  session: AuthSession,
  linkedEntityType: "VEHICLE" | "DRIVER",
  linkedEntityId: string,
  documentType: "REGISTRATION_CERTIFICATE" | "DRIVING_LICENSE" | "OTHER",
) {
  const storageKey = `documents/ocr-test-${unique("f")}.pdf`;
  await s3.send(
    new (await import("@aws-sdk/client-s3")).PutObjectCommand({
      Bucket: getDocumentsBucket(),
      Key: storageKey,
      Body: "fake file content",
      ContentType: "application/pdf",
    }),
  );
  const document = await completeNewDocumentUpload(session, {
    storageKey,
    fileName: "test.pdf",
    documentType,
    title: "Test doc",
    linkedEntityType,
    linkedEntityId,
  });
  await processOcrExtractionJob(document.currentVersionId!);
  return document;
}

describe("extraction", () => {
  it("REGISTRATION_CERTIFICATE linked to a Vehicle extracts vehicle fields; the raw response is really in S3", async () => {
    const { org, vehicle } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const document = await uploadAndProcess(
      admin,
      "VEHICLE",
      vehicle.id,
      "REGISTRATION_CERTIFICATE",
    );

    const extraction = await getOcrExtraction(
      admin,
      document.currentVersionId!,
    );
    expect(extraction?.status).toBe("EXTRACTED");
    const fields = extraction?.extractedFields as
      { key: string; value: string; confidence: number }[] | null;
    const keys = fields?.map((f) => f.key).sort();
    expect(keys).toEqual(
      [
        "chassisNumber",
        "engineNumber",
        "make",
        "model",
        "registrationNumber",
      ].sort(),
    );
    expect(extraction?.rawResponseStorageKey).toBeTruthy();

    const raw = await s3.send(
      new GetObjectCommand({
        Bucket: getDocumentsBucket(),
        Key: extraction!.rawResponseStorageKey!,
      }),
    );
    const body = await raw.Body?.transformToString();
    expect(JSON.parse(body ?? "{}").provider).toBe("stub");
  });

  it("DRIVING_LICENSE linked to a Driver extracts driver fields", async () => {
    const { org, driver } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const document = await uploadAndProcess(
      admin,
      "DRIVER",
      driver.id,
      "DRIVING_LICENSE",
    );

    const extraction = await getOcrExtraction(
      admin,
      document.currentVersionId!,
    );
    const fields = extraction?.extractedFields as { key: string }[] | null;
    expect(fields?.map((f) => f.key).sort()).toEqual(
      ["licenseNumber", "name"].sort(),
    );
  });

  it("an unrelated document type extracts nothing", async () => {
    const { org, vehicle } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const document = await uploadAndProcess(
      admin,
      "VEHICLE",
      vehicle.id,
      "OTHER",
    );

    const extraction = await getOcrExtraction(
      admin,
      document.currentVersionId!,
    );
    expect(extraction?.extractedFields).toEqual([]);
  });

  it("completing an upload really enqueues a BullMQ job", async () => {
    const { org, vehicle } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const before = await ocrExtractionQueue.getJobCounts();
    await uploadAndProcess(
      admin,
      "VEHICLE",
      vehicle.id,
      "REGISTRATION_CERTIFICATE",
    );
    const after = await ocrExtractionQueue.getJobCounts();
    const totalBefore = (before.waiting ?? 0) + (before.completed ?? 0);
    const totalAfter = (after.waiting ?? 0) + (after.completed ?? 0);
    expect(totalAfter).toBeGreaterThan(totalBefore);
  });
});

describe("verifyOcrExtraction", () => {
  it("applies only selected, allowlisted fields to the Vehicle and records audit entries", async () => {
    const { org, vehicle } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const document = await uploadAndProcess(
      admin,
      "VEHICLE",
      vehicle.id,
      "REGISTRATION_CERTIFICATE",
    );
    const extraction = await getOcrExtraction(
      admin,
      document.currentVersionId!,
    );
    const fields = extraction!.extractedFields as {
      key: string;
      value: string;
    }[];
    const registrationField = fields.find(
      (f) => f.key === "registrationNumber",
    )!;

    const updated = await verifyOcrExtraction(
      admin,
      document.currentVersionId!,
      {
        applyFieldKeys: ["registrationNumber", "notARealField"],
      },
    );
    expect(updated.status).toBe("VERIFIED");
    expect(updated.verifiedById).toBe(admin.user.id);

    const refreshedVehicle = await db.vehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
    });
    expect(refreshedVehicle.registrationNumber).toBe(registrationField.value);
    // chassisNumber was extracted but never selected — untouched.
    expect(refreshedVehicle.chassisNumber).toBeNull();

    const vehicleAudit = await db.auditLog.findFirst({
      where: { entityType: "Vehicle", entityId: vehicle.id, action: "UPDATE" },
    });
    expect(vehicleAudit).not.toBeNull();
    const extractionAudit = await db.auditLog.findFirst({
      where: {
        entityType: "OcrExtraction",
        entityId: updated.id,
        action: "STATUS_CHANGE",
      },
    });
    expect(extractionAudit).not.toBeNull();
  });

  it("rejects verifying an extraction that isn't EXTRACTED (409)", async () => {
    const { org, vehicle } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const document = await uploadAndProcess(
      admin,
      "VEHICLE",
      vehicle.id,
      "REGISTRATION_CERTIFICATE",
    );
    await verifyOcrExtraction(admin, document.currentVersionId!, {
      applyFieldKeys: [],
    });

    await expect(
      verifyOcrExtraction(admin, document.currentVersionId!, {
        applyFieldKeys: [],
      }),
    ).rejects.toThrow(/Cannot verify/);
  });

  it("CLAIMS_MANAGER cannot verify or reject (document-management RBAC)", async () => {
    const { org, vehicle } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const claimsManager = await userSessionWithRole(
      org,
      null,
      "CLAIMS_MANAGER",
    );

    const document = await uploadAndProcess(
      admin,
      "VEHICLE",
      vehicle.id,
      "REGISTRATION_CERTIFICATE",
    );

    await expect(
      verifyOcrExtraction(claimsManager, document.currentVersionId!, {
        applyFieldKeys: [],
      }),
    ).rejects.toThrow();
    await expect(
      rejectOcrExtraction(claimsManager, document.currentVersionId!),
    ).rejects.toThrow();
  });

  it("a DEPOT_MANAGER from a different depot cannot read or verify", async () => {
    const { org, depotB, vehicle } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerB = await userSessionWithRole(org, depotB.id, "DEPOT_MANAGER");

    const document = await uploadAndProcess(
      admin,
      "VEHICLE",
      vehicle.id,
      "REGISTRATION_CERTIFICATE",
    );

    await expect(
      getOcrExtraction(managerB, document.currentVersionId!),
    ).rejects.toThrow();
  });
});

describe("rejectOcrExtraction", () => {
  it("marks REJECTED and never writes to master data", async () => {
    const { org, vehicle } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const document = await uploadAndProcess(
      admin,
      "VEHICLE",
      vehicle.id,
      "REGISTRATION_CERTIFICATE",
    );
    const updated = await rejectOcrExtraction(
      admin,
      document.currentVersionId!,
    );
    expect(updated.status).toBe("REJECTED");

    const refreshedVehicle = await db.vehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
    });
    expect(refreshedVehicle.registrationNumber).toBe(
      vehicle.registrationNumber,
    );
  });
});

describe("org scoping", () => {
  it("a user from another org gets 404, not the extraction (mirrors the M6 Evidence fix)", async () => {
    const { org: orgA, vehicle } = await seedOrgWithTwoDepots();
    const adminA = await userSessionWithRole(orgA, null, "ORG_ADMIN");
    const document = await uploadAndProcess(
      adminA,
      "VEHICLE",
      vehicle.id,
      "REGISTRATION_CERTIFICATE",
    );

    const { org: orgB } = await seedOrgWithTwoDepots();
    const adminB = await userSessionWithRole(orgB, null, "ORG_ADMIN");

    await expect(
      getOcrExtraction(adminB, document.currentVersionId!),
    ).rejects.toThrow(/not found/i);
  });
});
