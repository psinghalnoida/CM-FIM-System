import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getVehicle } from "@/lib/masters/vehicle";
import { listDocumentsForEntity } from "@/lib/documents/document";
import { UploadDocumentForm } from "@/components/documents/upload-document-form";
import { DownloadDocumentLink } from "@/components/documents/download-document-link";

// Simple demo page proving M5's document repository end-to-end against a
// real entity. Full document management UI (edit metadata, version
// history browsing, OCR-verification once M11 lands) is deferred — see
// docs/DOCUMENTS.md.
export default async function VehicleDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await verifySession();
  const { id } = await params;

  const vehicle = await getVehicle(session, id);
  if (!vehicle) notFound();

  const documents = await listDocumentsForEntity(session, {
    linkedEntityType: "VEHICLE",
    linkedEntityId: id,
  });

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href="/vehicles"
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Vehicles
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-semibold tracking-tight">
        Documents — {vehicle.registrationNumber}
      </h1>

      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Title</th>
            <th className="py-2">Type</th>
            <th className="py-2">Version</th>
            <th className="py-2">File</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-border border-b">
              <td className="py-2">{doc.title}</td>
              <td className="py-2">{doc.documentType}</td>
              <td className="py-2">
                v{doc.currentVersion?.versionNumber ?? "—"}
              </td>
              <td className="py-2">{doc.currentVersion?.fileName ?? "—"}</td>
              <td className="py-2">
                <DownloadDocumentLink documentId={doc.id} />
              </td>
            </tr>
          ))}
          {documents.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="text-muted-foreground py-4 text-center"
              >
                No documents yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <UploadDocumentForm linkedEntityType="VEHICLE" linkedEntityId={id} />
    </div>
  );
}
