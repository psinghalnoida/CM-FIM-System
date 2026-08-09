"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ScanResult {
  breachedStageCount: number;
  fired: {
    caseLabel: string;
    stageName: string;
    escalationLevel: number;
    notifiedEmails: string[];
  }[];
  skippedNonEmailCount: number;
}

// Manual trigger for the reminder scheduler (docs/ESCALATIONS.md) — the
// real schedule is a repeatable worker job; this is for ops/demo use
// without waiting for the next tick.
export function ScanNowButton() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/escalations/scan", { method: "POST" });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Scan failed.");
      }
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" onClick={handleClick} disabled={pending}>
        {pending ? "Scanning…" : "Fire escalation scan now"}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {result && (
        <p className="text-muted-foreground text-sm">
          {result.breachedStageCount} breached stage(s) found,{" "}
          {result.fired.length} escalation(s) fired
          {result.skippedNonEmailCount > 0
            ? `, ${result.skippedNonEmailCount} skipped (non-EMAIL channel)`
            : ""}
          .
          {result.fired.map((f) => (
            <span key={`${f.caseLabel}-${f.escalationLevel}`} className="block">
              → {f.caseLabel} / {f.stageName} (level {f.escalationLevel}) to{" "}
              {f.notifiedEmails.join(", ")}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
