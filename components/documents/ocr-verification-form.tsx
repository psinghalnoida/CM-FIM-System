"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export interface OcrFieldRow {
  key: string;
  value: string;
  confidence: number;
  applicable: boolean;
}

// Demo form proving M11's human-verification step end-to-end: a reviewer
// picks which extracted fields to trust, and only those get written to
// master data on submit (BR-07) — see docs/OCR.md for what's deferred.
export function OcrVerificationForm({
  documentId,
  versionId,
  fields,
}: {
  documentId: string;
  versionId: string;
  fields: OcrFieldRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function post(path: string, body?: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/versions/${versionId}/ocr${path}`,
        {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Action failed.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2"></th>
            <th className="py-2">Field</th>
            <th className="py-2">Proposed value</th>
            <th className="py-2">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.key} className="border-border border-b">
              <td className="py-2">
                <input
                  type="checkbox"
                  disabled={!field.applicable}
                  checked={selected.has(field.key)}
                  onChange={() => toggle(field.key)}
                />
              </td>
              <td className="py-2">{field.key}</td>
              <td className="py-2">{field.value}</td>
              <td className="py-2">{Math.round(field.confidence * 100)}%</td>
            </tr>
          ))}
          {fields.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="text-muted-foreground py-4 text-center"
              >
                Nothing extracted from this document.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button
          disabled={pending}
          onClick={() => post("/verify", { applyFieldKeys: [...selected] })}
        >
          {pending ? "Working…" : "Verify"}
          {selected.size > 0
            ? ` and apply ${selected.size} field${selected.size === 1 ? "" : "s"}`
            : " (apply nothing)"}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => post("/reject")}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
