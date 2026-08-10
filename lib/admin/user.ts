import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { DomainError } from "@/lib/domain-error";
import { hashPassword } from "@/lib/password";
import { UserStatus } from "@/lib/generated/prisma/enums";
import type { User } from "@/lib/generated/prisma/client";

// M18: user management — the first real way to create/manage an account
// other than direct database access (previously only prisma/seed.ts).
// ORG_ADMIN only, same tier as every other Administration-level config
// (TatStageTemplate/M8, EscalationRule/M13). See docs/ADMIN_USERS.md.

const WRITE_ROLES = ["ORG_ADMIN"] as const;

// SUPER_ADMIN ("cross-org, support only" — docs/SCOPE.md's RBAC list)
// and WHATSAPP_BOT (a system principal, not a person) are deliberately
// not assignable through this self-service UI — both are platform-level
// roles, not something an org's own admin should be able to grant
// themselves or anyone else.
const ASSIGNABLE_ROLES = [
  "ORG_ADMIN",
  "DEPOT_MANAGER",
  "CLAIMS_MANAGER",
  "SURVEYOR",
  "WORKSHOP_COORDINATOR",
  "FINANCE_OFFICER",
  "AUDITOR",
] as const;

export const CreateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email(),
    role: z.enum(ASSIGNABLE_ROLES),
    depotId: z.uuid().optional(),
    phone: z.string().trim().max(20).optional(),
    // No invite-email flow yet (EmailProvider is console-only, M13) — the
    // admin sets an initial password directly, same as prisma/seed.ts.
    // Self-service reset is a follow-up once real email sending exists.
    password: z.string().min(8).max(200),
  })
  .refine((data) => data.role !== "DEPOT_MANAGER" || Boolean(data.depotId), {
    message: "depotId is required when role is DEPOT_MANAGER.",
    path: ["depotId"],
  });
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  depotId: z.uuid().nullable().optional(),
  phone: z.string().trim().max(20).optional(),
  status: z.enum(UserStatus).optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/** Never let a User row (which carries passwordHash) reach a response or an audit log entry as-is. */
function redact(user: User) {
  // Destructure-to-omit: the whole point is that `passwordHash` goes unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = user;
  return rest;
}

export async function listUsers(session: AuthSession) {
  requireRole(session, ...WRITE_ROLES);
  const scoped = scopedDb(session.user.organizationId);
  const users = await scoped.user.findMany({ orderBy: { name: "asc" } });
  return users.map(redact);
}

export async function getUser(session: AuthSession, id: string) {
  requireRole(session, ...WRITE_ROLES);
  const scoped = scopedDb(session.user.organizationId);
  const user = await scoped.user.findUnique({ where: { id } });
  return user ? redact(user) : null;
}

export async function createUser(session: AuthSession, input: unknown) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateUserSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  if (data.depotId) {
    // Confirms the depot exists (and belongs to this org, via scopedDb).
    await scoped.depot.findUniqueOrThrow({ where: { id: data.depotId } });
  }

  const passwordHash = await hashPassword(data.password);
  const user = await scoped.user.create({
    data: {
      organizationId: session.user.organizationId,
      name: data.name,
      email: data.email,
      role: data.role,
      depotId: data.depotId,
      phone: data.phone,
      passwordHash,
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "User",
    entityId: user.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: redact(user),
    sourceChannel: "WEB",
  });

  return redact(user);
}

export async function updateUser(
  session: AuthSession,
  id: string,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = UpdateUserSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.user.findUniqueOrThrow({ where: { id } });

  // Never let an admin lock themselves out — the one guard that applies
  // regardless of which field changed.
  if (id === session.user.id && data.status === "INACTIVE") {
    throw new DomainError("You cannot deactivate your own account.", 409);
  }

  const nextRole = data.role ?? before.role;
  const nextDepotId =
    data.depotId === undefined ? before.depotId : data.depotId;
  if (nextRole === "DEPOT_MANAGER" && !nextDepotId) {
    throw new DomainError(
      "A DEPOT_MANAGER must have a depotId — set one in the same request.",
      409,
    );
  }
  if (nextDepotId) {
    await scoped.depot.findUniqueOrThrow({ where: { id: nextDepotId } });
  }

  const user = await scoped.user.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "User",
    entityId: user.id,
    action: data.status ? "STATUS_CHANGE" : "UPDATE",
    actorId: session.user.id,
    beforeData: redact(before),
    afterData: redact(user),
    sourceChannel: "WEB",
  });

  return redact(user);
}

/** One-click deactivate — a thin wrapper over updateUser's status change, mirroring lib/masters/driver.ts's archiveDriver(). */
export async function deactivateUser(session: AuthSession, id: string) {
  return updateUser(session, id, { status: "INACTIVE" });
}
