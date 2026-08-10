"use client";

import { useState } from "react";

export function DownloadEvidenceLink({
  incidentId,
  evidenceId,
}: {
  incidentId: string;
  evidenceId: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/incidents/${incidentId}/evidence/${evidenceId}/download-url`,
      );
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
