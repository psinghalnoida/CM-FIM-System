"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SettlementActions({
  claimId,
  settlementId,
}: {
  claimId: string;
  settlementId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function act(action: "approve" | "reject") {
    setPending(true);
    try {
      const res = await fetch(
        `/api/claims/${claimId}/settlements/${settlementId}/${action}`,
        { method: "POST" },
      );
      if (res.ok) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => act("approve")}
      >
        Approve
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => act("reject")}
      >
        Reject
      </Button>
    </div>
  );
}
