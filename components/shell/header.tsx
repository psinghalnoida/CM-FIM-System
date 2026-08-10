import { Bell, HelpCircle, Search } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Header({
  user,
}: {
  user: { name: string; email: string; role: string };
}) {
  return (
    <header className="border-border flex items-center gap-4 border-b px-5 py-3">
      <div className="relative max-w-[360px] flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          disabled
          placeholder="Search bus no., incident no., claim no… (coming in M17)"
          className="pl-9"
        />
      </div>

      <div className="ml-auto flex items-center gap-4 text-sm">
        <Bell
          className="text-muted-foreground size-4"
          aria-label="Notifications (not yet wired up)"
        />
        <HelpCircle
          className="text-muted-foreground size-4"
          aria-label="Help (not yet wired up)"
        />
        <span className="font-medium">
          {user.name}{" "}
          <span className="text-muted-foreground font-normal">
            · {user.role}
          </span>
        </span>
        <form action={logout}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
