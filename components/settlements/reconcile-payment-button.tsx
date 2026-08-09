"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ReconcilePaymentButton({
  claimId,
  settlementId,
  paymentId,
}: {
  claimId: string;
  settlementId: string;
  paymentId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const res = await fetch(
        `/api/claims/${claimId}/settlements/${settlementId}/payments/${paymentId}/reconcile`,
        { method: "POST" },
      );
      if (res.ok) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={pending}>
      Reconcile
    </Button>
  );
}
