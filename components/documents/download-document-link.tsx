"use client";

import { useState } from "react";

/** Fetches a short-lived presigned GET URL on click, then opens it — never a public bucket link. */
export function DownloadDocumentLink({ documentId }: { documentId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/download-url`);
      if (!res.ok) return;
      const { downloadUrl } = await res.json();
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="text-primary text-sm underline underline-offset-4"
    >
      {loading ? "…" : "Download"}
    </button>
  );
}
