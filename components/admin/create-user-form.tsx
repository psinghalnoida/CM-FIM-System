"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// SUPER_ADMIN and WHATSAPP_BOT are deliberately not offered here — see
// lib/admin/user.ts's ASSIGNABLE_ROLES for why.
const ASSIGNABLE_ROLES = [
  "ORG_ADMIN",
  "DEPOT_MANAGER",
  "CLAIMS_MANAGER",
  "SURVEYOR",
  "WORKSHOP_COORDINATOR",
  "FINANCE_OFFICER",
  "AUDITOR",
] as const;

export function CreateUserForm({
  depots,
}: {
  depots: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string>("CLAIMS_MANAGER");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const depotId = String(formData.get("depotId") ?? "") || undefined;
    const body = {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      role,
      depotId,
      password: String(formData.get("password") ?? ""),
    };

    setPending(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json();
        throw new Error(payload.error ?? "Failed to create user.");
      }
      (event.target as HTMLFormElement).reset();
      setRole("CLAIMS_MANAGER");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor="new-user-name">Name</Label>
        <Input id="new-user-name" name="name" required className="w-40" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-user-email">Email</Label>
        <Input
          id="new-user-email"
          name="email"
          type="email"
          required
          className="w-56"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-user-role">Role</Label>
        <select
          id="new-user-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-user-depot">
          Depot {role === "DEPOT_MANAGER" ? "(required)" : "(optional)"}
        </Label>
        <select
          id="new-user-depot"
          name="depotId"
          required={role === "DEPOT_MANAGER"}
          className="border-input bg-background h-9 w-40 rounded-md border px-2 text-sm"
        >
          <option value="">—</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-user-password">Initial password</Label>
        <Input
          id="new-user-password"
          name="password"
          type="password"
          minLength={8}
          required
          className="w-40"
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Creating…" : "Create user"}
      </Button>
    </form>
  );
}
