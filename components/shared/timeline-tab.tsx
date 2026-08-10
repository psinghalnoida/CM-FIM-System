import type { listAuditLogForEntity } from "@/lib/audit";

// M19: the "Timeline" tab every sub-record detail page has — reuses the
// existing AuditLog directly (same approach M20's Claim-level Audit tab
// will take), no new event-log model.
export function TimelineTab({
  entries,
}: {
  entries: Awaited<ReturnType<typeof listAuditLogForEntity>>;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No activity recorded yet.
      </p>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="border-border grid grid-cols-[140px_1fr] gap-3 border-b pb-3 text-sm"
        >
          <div className="text-muted-foreground pt-0.5 text-xs">
            {new Date(entry.createdAt).toLocaleString()}
          </div>
          <div>
            <span className="font-medium">
              {entry.action.replaceAll("_", " ")}
            </span>
            {entry.actor && (
              <span className="text-muted-foreground">
                {" "}
                by {entry.actor.name}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
