import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { listVehicleDocuments } from "@/lib/documents/document";
import { listDepots } from "@/lib/masters/depot";
import { DocumentType } from "@/lib/generated/prisma/enums";
import type { VehicleDocumentStatus } from "@/lib/documents/document";

const DOCUMENT_TYPES = Object.values(DocumentType);
const STATUSES: VehicleDocumentStatus[] = [
  "VALID",
  "EXPIRING_SOON",
  "EXPIRED",
  "NO_EXPIRY",
];
const STATUS_LABELS: Record<VehicleDocumentStatus, string> = {
  VALID: "Valid",
  EXPIRING_SOON: "Expiring soon",
  EXPIRED: "Expired",
  NO_EXPIRY: "No expiry",
};
const STATUS_CLASSES: Record<VehicleDocumentStatus, string> = {
  VALID: "bg-status-green-bg text-status-green-fg",
  EXPIRING_SOON: "bg-status-amber-bg text-status-amber-fg",
  EXPIRED: "bg-status-red-bg text-status-red-fg",
  NO_EXPIRY: "bg-muted text-muted-foreground",
};

// M22: the org-wide "Document Repository" — vehicle-linked documents
// only (see lib/documents/document.ts's listVehicleDocuments doc
// comment for why). Extends M5's per-vehicle-only list.
export default async function DocumentRepositoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    documentType?: string;
    depotId?: string;
    status?: string;
    view?: string;
  }>;
}) {
  const session = await verifySession();
  const params = await searchParams;

  const documentType =
    params.documentType &&
    (DOCUMENT_TYPES as string[]).includes(params.documentType)
      ? (params.documentType as DocumentType)
      : undefined;
  // The KPI tiles double as filter shortcuts (?view=expiring etc.), the
  // same "tile onClick sets a filter" behavior the design specifies.
  const viewStatus: VehicleDocumentStatus | undefined =
    params.view === "expiring"
      ? "EXPIRING_SOON"
      : params.view === "expired"
        ? "EXPIRED"
        : undefined;
  const status =
    viewStatus ??
    (params.status && (STATUSES as string[]).includes(params.status)
      ? (params.status as VehicleDocumentStatus)
      : undefined);

  const [allDocuments, depots] = await Promise.all([
    listVehicleDocuments(session, { depotId: params.depotId || undefined }),
    listDepots(session),
  ]);

  const documents = allDocuments
    .filter((d) => !documentType || d.documentType === documentType)
    .filter((d) => !status || d.status === status)
    .filter((d) => {
      if (!params.search) return true;
      const needle = params.search.toLowerCase();
      return (
        d.vehicleRegistration.toLowerCase().includes(needle) ||
        d.title.toLowerCase().includes(needle)
      );
    });

  const counts = {
    all: allDocuments.length,
    expiring: allDocuments.filter((d) => d.status === "EXPIRING_SOON").length,
    expired: allDocuments.filter((d) => d.status === "EXPIRED").length,
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Document Repository
        </h1>
        <p className="text-muted-foreground text-sm">
          {documents.length} documents
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link
          href="/documents"
          className="border-border rounded-md border p-3"
        >
          <div className="text-muted-foreground text-xs">All documents</div>
          <div className="font-heading text-2xl">{counts.all}</div>
        </Link>
        <Link
          href="/documents?view=expiring"
          className="border-border rounded-md border p-3"
        >
          <div className="text-status-amber-fg text-xs font-semibold">
            Expiring soon
          </div>
          <div className="font-heading text-2xl">{counts.expiring}</div>
        </Link>
        <Link
          href="/documents?view=expired"
          className="border-border rounded-md border p-3"
        >
          <div className="text-status-red-fg text-xs font-semibold">
            Expired
          </div>
          <div className="font-heading text-2xl">{counts.expired}</div>
        </Link>
      </div>

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 text-sm"
      >
        <div className="space-y-1">
          <label htmlFor="search" className="text-muted-foreground block">
            Search
          </label>
          <input
            id="search"
            name="search"
            defaultValue={params.search ?? ""}
            placeholder="Bus no., title…"
            className="border-input h-9 rounded-md border bg-transparent px-2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="documentType" className="text-muted-foreground block">
            Type
          </label>
          <select
            id="documentType"
            name="documentType"
            defaultValue={documentType ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
          >
            <option value="">All types</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        {depots.length > 1 && (
          <div className="space-y-1">
            <label htmlFor="depotId" className="text-muted-foreground block">
              Depot
            </label>
            <select
              id="depotId"
              name="depotId"
              defaultValue={params.depotId ?? ""}
              className="border-input h-9 rounded-md border bg-transparent px-2"
            >
              <option value="">All depots</option>
              {depots.map((depot) => (
                <option key={depot.id} value={depot.id}>
                  {depot.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="status" className="text-muted-foreground block">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="border-input h-9 rounded-md border px-3">
          Apply
        </button>
      </form>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Bus No.</th>
            <th className="py-2">Depot</th>
            <th className="py-2">Document</th>
            <th className="py-2">Title</th>
            <th className="py-2">Expiry</th>
            <th className="py-2">Status</th>
            <th className="py-2">OCR confidence</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-border border-b">
              <td className="py-2 font-medium">
                <Link
                  href={`/documents/${doc.id}/ocr`}
                  className="text-primary underline underline-offset-4"
                >
                  {doc.vehicleRegistration}
                </Link>
              </td>
              <td className="py-2">{doc.depotName}</td>
              <td className="py-2">{doc.documentType.replaceAll("_", " ")}</td>
              <td className="text-muted-foreground py-2">{doc.title}</td>
              <td className="text-muted-foreground py-2">
                {doc.validityExpiryDate
                  ? new Date(doc.validityExpiryDate).toLocaleDateString()
                  : "—"}
              </td>
              <td className="py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[doc.status]}`}
                >
                  {STATUS_LABELS[doc.status]}
                </span>
              </td>
              <td className="text-muted-foreground py-2">
                {doc.ocrConfidencePercent === null
                  ? "—"
                  : `${doc.ocrConfidencePercent}%`}
              </td>
            </tr>
          ))}
          {documents.length === 0 && (
            <tr>
              <td
                colSpan={7}
                className="text-muted-foreground py-6 text-center"
              >
                No documents match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
