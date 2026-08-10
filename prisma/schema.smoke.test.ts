// Schema smoke test for M2a. Exercises the real relations (FKs, uniques,
// the DocumentLink/AuditLog "generic reference" pattern, the IdCounter
// pattern for human-readable IDs) against a real Postgres instance.
//
// Requires DATABASE_URL to point at a running Postgres (e.g.
// `docker compose up postgres -d`). Everything runs inside one transaction
// that's always rolled back at the end, so it never leaves data behind and
// is safe to run against a shared dev database.
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";

class IntentionalRollback extends Error {}

/**
 * Runs `fn` inside a transaction that is always rolled back, regardless of
 * whether `fn` throws. Returns whatever `fn` returned (or its thrown error,
 * re-thrown, if it wasn't the rollback sentinel).
 */
async function runAndRollback<T>(
  fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    await db.$transaction(async (tx) => {
      result = await fn(tx);
      throw new IntentionalRollback();
    });
  } catch (err) {
    if (err instanceof IntentionalRollback) {
      return result!;
    }
    throw err;
  }
  throw new Error("unreachable");
}

describe("M2a schema", () => {
  it("supports the full masters -> document -> incident -> evidence -> audit chain", async () => {
    await runAndRollback(async (tx) => {
      const org = await tx.organization.create({
        data: { code: `TEST-${Date.now()}`, name: "Test Fleet Org" },
      });

      const city = await tx.city.create({
        data: { organizationId: org.id, name: "Gurugram", state: "Haryana" },
      });

      const depot = await tx.depot.create({
        data: {
          organizationId: org.id,
          cityId: city.id,
          code: "GGN-01",
          name: "Gurugram Depot",
        },
      });

      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          depotId: depot.id,
          name: "Depot Manager",
          email: `dm-${Date.now()}@example.com`,
          role: "DEPOT_MANAGER",
        },
      });

      const vehicle = await tx.vehicle.create({
        data: {
          organizationId: org.id,
          depotId: depot.id,
          registrationNumber: "HR55AB1234",
          vehicleType: "TRUCK",
        },
      });

      const driver = await tx.driver.create({
        data: {
          organizationId: org.id,
          depotId: depot.id,
          name: "Test Driver",
          licenseNumber: "DL-12345",
        },
      });

      // --- document repository: create Document, then its first version,
      // then point the document at it (BR-04: versioned) ---
      const document = await tx.document.create({
        data: {
          organizationId: org.id,
          documentType: "REGISTRATION_CERTIFICATE",
          title: "RC — HR55AB1234",
          createdById: user.id,
        },
      });

      const version1 = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: 1,
          storageBucket: "cm-fim-documents",
          storageKey: `documents/${document.id}/v1.pdf`,
          fileName: "rc.pdf",
          mimeType: "application/pdf",
          fileSizeBytes: 1024,
          uploadedById: user.id,
        },
      });

      await tx.document.update({
        where: { id: document.id },
        data: { currentVersionId: version1.id },
      });

      // BR-07: OCR result is proposed only, pending verification.
      await tx.ocrExtraction.create({
        data: {
          documentVersionId: version1.id,
          provider: "aws-textract",
          status: "EXTRACTED",
          extractedFields: [
            {
              key: "registrationNumber",
              value: "HR55AB1234",
              confidence: 0.98,
            },
          ],
        },
      });

      // Generic document -> vehicle link (no DB FK on linkedEntityId).
      await tx.documentLink.create({
        data: {
          documentId: document.id,
          linkedEntityType: "VEHICLE",
          linkedEntityId: vehicle.id,
        },
      });

      // --- human-readable incident ID via IdCounter, inside this same tx ---
      const year = new Date().getFullYear();
      const counter = await tx.idCounter.upsert({
        where: {
          organizationId_entityType_year: {
            organizationId: org.id,
            entityType: "INCIDENT",
            year,
          },
        },
        create: {
          organizationId: org.id,
          entityType: "INCIDENT",
          year,
          lastNumber: 1,
        },
        update: { lastNumber: { increment: 1 } },
      });
      const incidentNumber = `INC-${year}-${String(counter.lastNumber).padStart(6, "0")}`;
      expect(incidentNumber).toMatch(/^INC-\d{4}-\d{6}$/);

      const incident = await tx.incident.create({
        data: {
          organizationId: org.id,
          incidentNumber,
          vehicleId: vehicle.id,
          driverId: driver.id,
          depotId: depot.id,
          incidentDateTime: new Date(),
          reportedById: user.id,
          reportedVia: "WEB",
          incidentType: "ACCIDENT",
          description: "Minor collision at depot gate.",
        },
      });

      await tx.evidence.create({
        data: {
          incidentId: incident.id,
          evidenceType: "PHOTO",
          storageBucket: "cm-fim-documents",
          storageKey: `evidence/${incident.id}/photo1.jpg`,
          fileName: "photo1.jpg",
          mimeType: "image/jpeg",
          fileSizeBytes: 2048,
          uploadedById: user.id,
        },
      });

      // BR-06: one immutable snapshot per incident.
      await tx.telematicsSnapshot.create({
        data: {
          incidentId: incident.id,
          providerName: "stub",
          vehicleExternalId: "STUB-VEHICLE-1",
          capturedAt: new Date(),
          speedKmh: 42.5,
          rawPayload: { source: "stub-provider" },
        },
      });

      await tx.activityTimelineEvent.create({
        data: {
          incidentId: incident.id,
          eventType: "STATUS_CHANGE",
          actorId: user.id,
          description: "Incident reported.",
        },
      });

      // BR-08: every important action creates an audit record.
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          entityType: "Incident",
          entityId: incident.id,
          action: "CREATE",
          actorId: user.id,
          afterData: { incidentNumber },
          sourceChannel: "WEB",
        },
      });

      const fetched = await tx.incident.findUniqueOrThrow({
        where: { id: incident.id },
        include: {
          evidence: true,
          telematicsSnapshot: true,
          timelineEvents: true,
          vehicle: true,
          driver: true,
        },
      });

      expect(fetched.incidentNumber).toBe(incidentNumber);
      expect(fetched.evidence).toHaveLength(1);
      expect(fetched.telematicsSnapshot?.providerName).toBe("stub");
      expect(fetched.timelineEvents).toHaveLength(1);
      expect(fetched.vehicle.registrationNumber).toBe("HR55AB1234");
      expect(fetched.driver?.licenseNumber).toBe("DL-12345");

      return null;
    });
  });

  it("enforces one human-readable ID per organization/year via IdCounter uniqueness", async () => {
    await runAndRollback(async (tx) => {
      const org = await tx.organization.create({
        data: { code: `TEST2-${Date.now()}`, name: "Test Fleet Org 2" },
      });
      const year = new Date().getFullYear();

      await tx.idCounter.create({
        data: {
          organizationId: org.id,
          entityType: "INCIDENT",
          year,
          lastNumber: 1,
        },
      });

      await expect(
        tx.idCounter.create({
          data: {
            organizationId: org.id,
            entityType: "INCIDENT",
            year,
            lastNumber: 2,
          },
        }),
      ).rejects.toThrow();

      return null;
    });
  });
});
