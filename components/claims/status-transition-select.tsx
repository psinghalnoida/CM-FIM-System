"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Generic "pick a next status, POST it" control, reused for claims,
// surveys, and repair jobs — all three expose the same
// POST <resource>/status {status} shape (lib/claims/*.ts). `options` is
// the caller-supplied list of statuses valid from the record's *current*
// status; an empty list (a terminal status) renders nothing.
export function StatusTransitionSelect({
  endpoint,
  options,
}: {
  endpoint: string;
  options: string[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(options[0] ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (options.length === 0) return null;

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: value }),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to update status.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("_", " ")}
          </option>
        ))}
      </select>
      <Button variant="outline" onClick={handleClick} disabled={pending}>
        {pending ? "Updating…" : "Update status"}
      </Button>
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}
