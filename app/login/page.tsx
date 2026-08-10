"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <form
        action={action}
        className="border-border w-full max-w-sm space-y-4 rounded-lg border p-6"
      >
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            CM FIM System
          </h1>
          <p className="text-muted-foreground text-sm">Sign in to continue</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
          />
          {state?.errors && "email" in state.errors && state.errors.email && (
            <p className="text-destructive text-sm">{state.errors.email[0]}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
          {state?.errors &&
            "password" in state.errors &&
            state.errors.password && (
              <p className="text-destructive text-sm">
                {state.errors.password[0]}
              </p>
            )}
        </div>

        {state?.errors && "form" in state.errors && state.errors.form && (
          <p className="text-destructive text-sm">{state.errors.form[0]}</p>
        )}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
