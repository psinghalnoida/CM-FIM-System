"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// M21: the Overview tab's Driver section — injuries/thirdPartyInvolved
// are the two new structured fields the design shows there. No separate
// "edit incident" page exists yet (out of scope for this milestone —
// this form is the minimal path to setting these two fields), so this
// is a small inline PATCH form, the same shape as M19's
// UpdateSurveyFindingsForm.
export function UpdateIncidentDriverInfoForm({
  incidentId,
  injuries,
  thirdPartyInvolved,
}: {
  incidentId: string;
  injuries: string | null;
  thirdPartyInvolved: boolean | null;
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
      const res = await fetch(`/api/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          injuries: String(formData.get("injuries") ?? ""),
          thirdPartyInvolved: formData.get("thirdPartyInvolved") === "on",
        }),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to save.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-3">
      <div className="space-y-1">
        <label htmlFor="injuries" className="text-muted-foreground text-xs">
          Injuries
        </label>
        <textarea
          id="injuries"
          name="injuries"
          defaultValue={injuries ?? ""}
          maxLength={2000}
          rows={2}
          placeholder="None reported"
          className="border-input w-full rounded-md border bg-transparent p-2 text-sm"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="thirdPartyInvolved"
          defaultChecked={thirdPartyInvolved ?? false}
        />
        Third party involved
      </label>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
