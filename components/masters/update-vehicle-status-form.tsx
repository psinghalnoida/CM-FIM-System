"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const VEHICLE_STATUSES = ["ACTIVE", "INACTIVE", "SOLD", "SCRAPPED"] as const;

// M28: the Vehicle Detail page's Status tab — a small inline PATCH
// form, same shape as M21's UpdateIncidentDriverInfoForm. Reuses the
// existing PATCH /api/vehicles/[id] (lib/masters/vehicle.ts's
// updateVehicle()), not a new endpoint.
export function UpdateVehicleStatusForm({
  vehicleId,
  status,
}: {
  vehicleId: string;
  status: string;
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
      const res = await fetch(`/api/vehicles/${vehicleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: formData.get("status") }),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to update status.");
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update status.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <select
        name="status"
        defaultValue={status}
        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
      >
        {VEHICLE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Update status"}
      </Button>
    </form>
  );
}
