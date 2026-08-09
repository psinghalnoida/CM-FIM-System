"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EVIDENCE_TYPES = ["PHOTO", "VIDEO", "DOCUMENT"] as const;

// Same presigned two-step flow as components/documents/upload-document-form.tsx
// (see docs/DOCUMENTS.md), applied to incident evidence instead.
export function UploadEvidenceForm({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file") as File | null;
    const evidenceType = String(formData.get("evidenceType") ?? "PHOTO");
    const caption = String(formData.get("caption") ?? "") || undefined;

    if (!file || file.size === 0) {
      setError("Choose a file first.");
      return;
    }

    setPending(true);
    try {
      const presignRes = await fetch(
        `/api/incidents/${incidentId}/evidence/presign-upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name }),
        },
      );
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

      const completeRes = await fetch(`/api/incidents/${incidentId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageKey,
          fileName: file.name,
          evidenceType,
          caption,
        }),
      });
      if (!completeRes.ok) {
        throw new Error(
          (await completeRes.json()).error ?? "Failed to save the evidence.",
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
        <Label htmlFor="evidenceType">Type</Label>
        <select
          id="evidenceType"
          name="evidenceType"
          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          defaultValue="PHOTO"
        >
          {EVIDENCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="caption">Caption (optional)</Label>
        <Input id="caption" name="caption" maxLength={500} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="file">File</Label>
        <Input id="file" name="file" type="file" required />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload evidence"}
      </Button>
    </form>
  );
}
