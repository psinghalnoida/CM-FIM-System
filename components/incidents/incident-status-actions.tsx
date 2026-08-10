"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function IncidentStatusActions({
  incidentId,
  status,
}: {
  incidentId: string;
  status: "OPEN" | "CLOSED";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const action = status === "OPEN" ? "close" : "reopen";
      const res = await fetch(`/api/incidents/${incidentId}/${action}`, {
        method: "POST",
      });
      if (res.ok) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={pending}>
      {status === "OPEN" ? "Close incident" : "Reopen incident"}
    </Button>
  );
}
