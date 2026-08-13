import { verifySession } from "@/lib/dal";
import { listInsurers } from "@/lib/masters/insurer";
import { listBrokers } from "@/lib/masters/broker";
import { listSurveyors } from "@/lib/masters/surveyor";
import { listWorkshops } from "@/lib/masters/workshop";
import { DetailTabs } from "@/components/shared/detail-tabs";
import { CreateMasterDataForm } from "@/components/admin/create-master-data-form";

const TABS = [
  { key: "insurers", label: "Insurers" },
  { key: "brokers", label: "Brokers" },
  { key: "surveyors", label: "Surveyors" },
  { key: "workshops", label: "Workshops" },
];

// M27: Administration > Master Data — turns what was free text
// (surveyorName/workshopName/insurerName) into real, admin-managed
// entities. ORG_ADMIN only, same as every other master-data screen
// (Depots/Cities/TAT Stage Templates). See docs/MASTERS.md's M27
// section for the backfill plan and design decisions.
export default async function AdminMasterDataPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await verifySession();
  const { tab = "insurers" } = await searchParams;

  if (session.user.role !== "ORG_ADMIN") {
    return (
      <div className="p-8">
        <p className="text-muted-foreground text-sm">
          Only ORG_ADMIN can manage master data.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">
        Master Data
      </h1>
      <DetailTabs basePath="/admin/master-data" activeTab={tab} tabs={TABS} />

      {tab === "insurers" && <InsurersTab session={session} />}
      {tab === "brokers" && <BrokersTab session={session} />}
      {tab === "surveyors" && <SurveyorsTab session={session} />}
      {tab === "workshops" && <WorkshopsTab session={session} />}
    </div>
  );
}

async function InsurersTab({
  session,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
}) {
  const insurers = await listInsurers(session);
  return (
    <div>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Name</th>
          </tr>
        </thead>
        <tbody>
          {insurers.map((i) => (
            <tr key={i.id} className="border-border border-b">
              <td className="py-2">{i.name}</td>
            </tr>
          ))}
          {insurers.length === 0 && (
            <tr>
              <td className="text-muted-foreground py-4 text-center">
                No insurers yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CreateMasterDataForm
        apiPath="/api/admin/insurers"
        fields={[{ name: "name", label: "Name" }]}
        submitLabel="Add insurer"
      />
    </div>
  );
}

async function BrokersTab({
  session,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
}) {
  const brokers = await listBrokers(session);
  return (
    <div>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Name</th>
          </tr>
        </thead>
        <tbody>
          {brokers.map((b) => (
            <tr key={b.id} className="border-border border-b">
              <td className="py-2">{b.name}</td>
            </tr>
          ))}
          {brokers.length === 0 && (
            <tr>
              <td className="text-muted-foreground py-4 text-center">
                No brokers yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CreateMasterDataForm
        apiPath="/api/admin/brokers"
        fields={[{ name: "name", label: "Name" }]}
        submitLabel="Add broker"
      />
    </div>
  );
}

async function SurveyorsTab({
  session,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
}) {
  const surveyors = await listSurveyors(session);
  return (
    <div>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Name</th>
            <th className="py-2">Contact</th>
          </tr>
        </thead>
        <tbody>
          {surveyors.map((s) => (
            <tr key={s.id} className="border-border border-b">
              <td className="py-2">{s.name}</td>
              <td className="text-muted-foreground py-2">
                {s.contact ?? "—"}
              </td>
            </tr>
          ))}
          {surveyors.length === 0 && (
            <tr>
              <td colSpan={2} className="text-muted-foreground py-4 text-center">
                No surveyors yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CreateMasterDataForm
        apiPath="/api/admin/surveyors"
        fields={[
          { name: "name", label: "Name" },
          { name: "contact", label: "Contact (optional)", maxLength: 100 },
        ]}
        submitLabel="Add surveyor"
      />
    </div>
  );
}

async function WorkshopsTab({
  session,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
}) {
  const workshops = await listWorkshops(session);
  return (
    <div>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Name</th>
            <th className="py-2">Contact</th>
            <th className="py-2">Address</th>
          </tr>
        </thead>
        <tbody>
          {workshops.map((w) => (
            <tr key={w.id} className="border-border border-b">
              <td className="py-2">{w.name}</td>
              <td className="text-muted-foreground py-2">
                {w.contact ?? "—"}
              </td>
              <td className="text-muted-foreground py-2">
                {w.address ?? "—"}
              </td>
            </tr>
          ))}
          {workshops.length === 0 && (
            <tr>
              <td colSpan={3} className="text-muted-foreground py-4 text-center">
                No workshops yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CreateMasterDataForm
        apiPath="/api/admin/workshops"
        fields={[
          { name: "name", label: "Name" },
          { name: "contact", label: "Contact (optional)", maxLength: 100 },
          { name: "address", label: "Address (optional)", maxLength: 500 },
        ]}
        submitLabel="Add workshop"
      />
    </div>
  );
}
