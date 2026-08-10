"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// M19: JBM records a *response* to the insurer's settlement offer, not
// an approval/rejection decision — JBM is the insured, not an approving
// authority. See docs/PAYMENTS.md.
export function SettlementResponseActions({
  claimId,
  settlementId,
}: {
  claimId: string;
  settlementId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function act(action: "accept" | "dispute" | "request-review") {
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
      <Button variant="outline" disabled={pending} onClick={() => act("accept")}>
        Accept
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => act("dispute")}
      >
        Dispute
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => act("request-review")}
      >
        Request review
      </Button>
    </div>
  );
}
