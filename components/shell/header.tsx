import { Bell, HelpCircle } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/shell/global-search";

export function Header({
  user,
}: {
  user: { name: string; email: string; role: string };
}) {
  return (
    <header className="border-border flex items-center gap-4 border-b px-5 py-3">
      <GlobalSearch />

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
