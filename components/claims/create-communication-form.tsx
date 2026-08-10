"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// M20: the Claim Detail "Communication" tab — logs a manually-entered
// note (correspondence with the insurer/surveyor/workshop) against the
// claim. See lib/claims/communication.ts.
export function CreateCommunicationForm({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    setPending(true);
    try {
      const res = await fetch(`/api/claims/${claimId}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: String(formData.get("description")),
        }),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to log communication.");
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to log communication.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-3">
      <textarea
        name="description"
        maxLength={2000}
        rows={3}
        required
        placeholder="Called the insurer, sent an email, appointed a surveyor…"
        className="border-input w-full rounded-md border bg-transparent p-2 text-sm"
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        {pending ? "Logging…" : "Log communication"}
      </Button>
    </form>
  );
}
