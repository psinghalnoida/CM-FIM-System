"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CASE_TYPES = [
  "INCIDENT",
  "INSURANCE_CLAIM",
  "WARRANTY_CLAIM",
  "MAINTENANCE_CLAIM",
  "OPERATIONAL_CLAIM",
  "THIRD_PARTY_RECOVERY_CLAIM",
  "MIXED_CLAIM",
] as const;

// Demo form proving M8's stage-template configuration end-to-end. Not a
// polished admin UI — see docs/TAT.md for what's deferred.
export function CreateStageTemplateForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body = {
      caseType: String(formData.get("caseType") ?? "INCIDENT"),
      stageKey: String(formData.get("stageKey") ?? "")
        .trim()
        .toUpperCase()
        .replaceAll(" ", "_"),
      stageName: String(formData.get("stageName") ?? ""),
      sequenceOrder: Number(formData.get("sequenceOrder") ?? 0),
      targetHours: Number(formData.get("targetHours") ?? 24),
    };

    setPending(true);
    try {
      const res = await fetch("/api/tat/stage-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to create stage template.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create stage template.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="caseType">Case type</Label>
          <select
            id="caseType"
            name="caseType"
            className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            defaultValue="INCIDENT"
          >
            {CASE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="stageKey">Stage key</Label>
          <Input
            id="stageKey"
            name="stageKey"
            required
            maxLength={100}
            placeholder="SURVEY_SCHEDULING"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="stageName">Stage name</Label>
        <Input id="stageName" name="stageName" required maxLength={200} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="sequenceOrder">Sequence order</Label>
          <Input
            id="sequenceOrder"
            name="sequenceOrder"
            type="number"
            min="0"
            required
            defaultValue={0}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="targetHours">Target hours</Label>
          <Input
            id="targetHours"
            name="targetHours"
            type="number"
            min="1"
            required
            defaultValue={24}
          />
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create stage template"}
      </Button>
    </form>
  );
}
