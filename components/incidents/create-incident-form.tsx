"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INCIDENT_TYPES = [
  "ACCIDENT",
  "THEFT",
  "FIRE",
  "BREAKDOWN",
  "NATURAL_DISASTER",
  "THIRD_PARTY_DAMAGE",
  "OTHER",
] as const;

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

interface Option {
  id: string;
  label: string;
}

// Demo form proving M6's incident creation end-to-end. Not a polished
// incident-reporting UI — see docs/INCIDENTS.md for what's deferred.
export function CreateIncidentForm({
  vehicles,
  drivers,
}: {
  vehicles: Option[];
  drivers: Option[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);

    const body = {
      vehicleId: String(formData.get("vehicleId") ?? ""),
      driverId: formData.get("driverId")
        ? String(formData.get("driverId"))
        : undefined,
      incidentDateTime: String(formData.get("incidentDateTime") ?? ""),
      incidentType: String(formData.get("incidentType") ?? "OTHER"),
      severity: String(formData.get("severity") ?? "MEDIUM"),
      locationAddress:
        String(formData.get("locationAddress") ?? "") || undefined,
      description: String(formData.get("description") ?? ""),
    };

    setPending(true);
    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to create incident.");
      }
      const incident = await res.json();
      router.push(`/incidents/${incident.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create incident.",
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="space-y-1">
        <Label htmlFor="vehicleId">Vehicle</Label>
        <select
          id="vehicleId"
          name="vehicleId"
          required
          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        >
          <option value="">Select a vehicle…</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="driverId">Driver (optional)</Label>
        <select
          id="driverId"
          name="driverId"
          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        >
          <option value="">Unknown / not applicable</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="incidentDateTime">When did it happen?</Label>
        <Input
          id="incidentDateTime"
          name="incidentDateTime"
          type="datetime-local"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="incidentType">Type</Label>
          <select
            id="incidentType"
            name="incidentType"
            className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            defaultValue="ACCIDENT"
          >
            {INCIDENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="severity">Severity</Label>
          <select
            id="severity"
            name="severity"
            className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            defaultValue="MEDIUM"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="locationAddress">Location (optional)</Label>
        <Input id="locationAddress" name="locationAddress" maxLength={500} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          name="description"
          required
          rows={4}
          maxLength={4000}
          className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Reporting…" : "Report incident"}
      </Button>
    </form>
  );
}
