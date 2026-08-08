// Minimal dev/demo seed — enough to log in and exercise M3's auth flow
// locally. This is NOT the "realistic JBM demonstration environment" seed
// called for in the brief (masters data, sample incidents/claims, etc.) —
// that's a later milestone once there's real business data to seed. Never
// run against a production database: the admin password is a fixed,
// publicly-known dev default.
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";

const DEV_ADMIN_EMAIL = "admin@jbm.example";
const DEV_ADMIN_PASSWORD = "ChangeMe123!";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run the dev seed against NODE_ENV=production.",
    );
  }

  const org = await db.organization.upsert({
    where: { code: "JBM" },
    create: { code: "JBM", name: "JBM Group" },
    update: {},
  });

  const city = await db.city.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: "Gurugram" },
    },
    create: { organizationId: org.id, name: "Gurugram", state: "Haryana" },
    update: {},
  });

  const depot = await db.depot.upsert({
    where: { organizationId_code: { organizationId: org.id, code: "GGN-01" } },
    create: {
      organizationId: org.id,
      cityId: city.id,
      code: "GGN-01",
      name: "Gurugram Depot",
    },
    update: {},
  });

  const passwordHash = await hashPassword(DEV_ADMIN_PASSWORD);

  const admin = await db.user.upsert({
    where: { email: DEV_ADMIN_EMAIL },
    create: {
      organizationId: org.id,
      depotId: depot.id,
      name: "JBM Admin",
      email: DEV_ADMIN_EMAIL,
      passwordHash,
      role: "ORG_ADMIN",
    },
    update: { passwordHash },
  });

  console.log("Seeded:");
  console.log(`  Organization: ${org.name} (${org.code})`);
  console.log(`  Depot:        ${depot.name}`);
  console.log(`  Admin login:  ${admin.email} / ${DEV_ADMIN_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
