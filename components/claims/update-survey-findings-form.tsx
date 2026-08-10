"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// M19: the Survey Detail page's "Observations" tab — reuses the
// existing Survey.findings field (lib/claims/survey.ts already accepts
// it via updateSurvey), just the first UI to edit it.
export function UpdateSurveyFindingsForm({
  claimId,
  surveyId,
  findings,
}: {
  claimId: string;
  surveyId: string;
  findings: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    setPending(true);
    try {
      const res = await fetch(`/api/claims/${claimId}/surveys/${surveyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings: String(formData.get("findings")) }),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to save observations.");
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save observations.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-3">
      <textarea
        name="findings"
        defaultValue={findings ?? ""}
        maxLength={4000}
        rows={6}
        placeholder="Survey observations…"
        className="border-input w-full rounded-md border bg-transparent p-2 text-sm"
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save observations"}
      </Button>
    </form>
  );
}
