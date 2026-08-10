"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SupportedLinkType } from "@/lib/documents/link-scope";

const DOCUMENT_TYPES = [
  "REGISTRATION_CERTIFICATE",
  "INSURANCE_POLICY",
  "FITNESS_CERTIFICATE",
  "PERMIT",
  "PUC_CERTIFICATE",
  "DRIVING_LICENSE",
  "REPAIR_ESTIMATE",
  "OTHER",
] as const;

// Demo upload form proving M5's presigned two-step flow end-to-end:
// presign -> PUT direct to S3/MinIO -> complete. Not a polished document
// management UI — see docs/DOCUMENTS.md for what's deferred.
export function UploadDocumentForm({
  linkedEntityType,
  linkedEntityId,
}: {
  linkedEntityType: SupportedLinkType;
  linkedEntityId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file") as File | null;
    const title = String(formData.get("title") ?? "");
    const documentType = String(formData.get("documentType") ?? "OTHER");

    if (!file || file.size === 0) {
      setError("Choose a file first.");
      return;
    }

    setPending(true);
    try {
      const presignRes = await fetch("/api/documents/presign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedEntityType,
          linkedEntityId,
          fileName: file.name,
        }),
      });
      if (!presignRes.ok) {
        throw new Error(
          (await presignRes.json()).error ?? "Failed to get an upload URL.",
        );
      }
      const { uploadUrl, storageKey } = await presignRes.json();

      const putRes = await fetch(uploadUrl, { method: "PUT", body: file });
      if (!putRes.ok) {
        throw new Error("Upload to storage failed.");
      }

      const completeRes = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageKey,
          fileName: file.name,
          documentType,
          title,
          linkedEntityType,
          linkedEntityId,
        }),
      });
      if (!completeRes.ok) {
        throw new Error(
          (await completeRes.json()).error ?? "Failed to save the document.",
        );
      }

      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="space-y-1">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required maxLength={200} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="documentType">Document type</Label>
        <select
          id="documentType"
          name="documentType"
          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          defaultValue="OTHER"
        >
          {DOCUMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="file">File</Label>
        <Input id="file" name="file" type="file" required />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}
