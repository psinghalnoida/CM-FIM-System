import { verifySession } from "@/lib/dal";
import { listUsers } from "@/lib/admin/user";
import { listDepots } from "@/lib/masters/depot";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { UserStatusToggle } from "@/components/admin/user-status-toggle";

// M18: the first real user-management UI — previously the only way to
// create/manage a user was direct database access (prisma/seed.ts or
// manual SQL). ORG_ADMIN only. See docs/ADMIN_USERS.md.
export default async function AdminUsersPage() {
  const session = await verifySession();

  if (session.user.role !== "ORG_ADMIN") {
    return (
      <div className="p-8">
        <p className="text-muted-foreground text-sm">
          Only ORG_ADMIN can manage users.
        </p>
      </div>
    );
  }

  const [users, depots] = await Promise.all([
    listUsers(session),
    listDepots(session),
  ]);
  const depotNameById = new Map(depots.map((d) => [d.id, d.name]));

  return (
    <div className="p-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Users</h1>

      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Name</th>
            <th className="py-2">Email</th>
            <th className="py-2">Role</th>
            <th className="py-2">Depot</th>
            <th className="py-2">Status</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-border border-b">
              <td className="py-2 font-medium">{user.name}</td>
              <td className="text-muted-foreground py-2">{user.email}</td>
              <td className="py-2">{user.role}</td>
              <td className="text-muted-foreground py-2">
                {user.depotId ? (depotNameById.get(user.depotId) ?? "—") : "—"}
              </td>
              <td className="py-2">{user.status}</td>
              <td className="py-2">
                <UserStatusToggle
                  userId={user.id}
                  status={user.status}
                  isSelf={user.id === session.user.id}
                />
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="text-muted-foreground py-4 text-center"
              >
                No users yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        Create a user
      </h2>
      <CreateUserForm
        depots={depots.map((d) => ({ id: d.id, name: d.name }))}
      />
    </div>
  );
}
