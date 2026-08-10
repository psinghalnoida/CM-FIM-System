"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// M22: the Document Viewer's "Request re-upload" action. There's no
// notification/paging mechanism to actually ask a specific person to
// re-upload (out of scope — no new models), so this is the practical
// version: it reveals the real re-upload path — M5's existing
// presign -> PUT -> complete new-version flow — right where the design
// puts the button, rather than a dead link.
export function UploadNewVersionForm({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const file = new FormData(form).get("file") as File | null;
    if (!file || file.size === 0) {
      setError("Choose a file first.");
      return;
    }

    setPending(true);
    try {
      const presignRes = await fetch(
        `/api/documents/${documentId}/versions/presign-upload`,
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
      if (!putRes.ok) throw new Error("Upload to storage failed.");

      const completeRes = await fetch(
        `/api/documents/${documentId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storageKey, fileName: file.name }),
        },
      );
      if (!completeRes.ok) {
        throw new Error(
          (await completeRes.json()).error ?? "Failed to save the new version.",
        );
      }

      form.reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        Request re-upload
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <Input name="file" type="file" required />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Uploading…" : "Upload new version"}
      </Button>
    </form>
  );
}
