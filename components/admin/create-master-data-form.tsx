"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// M27: one generic create form for the four Master Data entities
// (Insurer/Broker/Surveyor/Workshop) — they're all "a name plus a
// couple of optional text fields," so one parameterized component
// instead of four near-identical files. Surveyor's linkedUserId isn't
// exposed here (a dropdown of internal users would need its own prop
// wiring for one uncommon field) — still settable via the API directly;
// a deliberate minimal-UI scope call, not an oversight. See
// docs/MASTERS.md's M27 section.
export function CreateMasterDataForm({
  apiPath,
  fields,
  submitLabel,
}: {
  apiPath: string;
  fields: { name: string; label: string; maxLength?: number }[];
  submitLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const body: Record<string, string | undefined> = {};
    for (const field of fields) {
      body[field.name] = String(formData.get(field.name) ?? "") || undefined;
    }

    setPending(true);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to create.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      {fields.map((field, index) => (
        <div className="space-y-1" key={field.name}>
          <Label htmlFor={field.name}>{field.label}</Label>
          <Input
            id={field.name}
            name={field.name}
            required={index === 0}
            maxLength={field.maxLength ?? 200}
            className="w-48"
          />
        </div>
      ))}
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Creating…" : submitLabel}
      </Button>
    </form>
  );
}
