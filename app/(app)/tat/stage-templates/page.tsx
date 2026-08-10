import { verifySession } from "@/lib/dal";
import { listStageTemplates } from "@/lib/tat/stage-template";
import { CreateStageTemplateForm } from "@/components/tat/create-stage-template-form";

export default async function StageTemplatesPage() {
  const session = await verifySession();
  const templates = await listStageTemplates(session);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">
        TAT stage templates
      </h1>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Case type</th>
            <th className="py-2">#</th>
            <th className="py-2">Stage</th>
            <th className="py-2">Target</th>
            <th className="py-2">Active</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr key={template.id} className="border-border border-b">
              <td className="py-2">{template.caseType}</td>
              <td className="py-2">{template.sequenceOrder}</td>
              <td className="py-2">{template.stageName}</td>
              <td className="py-2">{template.targetHours}h</td>
              <td className="py-2">{template.isActive ? "Yes" : "No"}</td>
            </tr>
          ))}
          {templates.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="text-muted-foreground py-4 text-center"
              >
                No stage templates configured yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {session.user.role === "ORG_ADMIN" ? (
        <CreateStageTemplateForm />
      ) : (
        <p className="text-muted-foreground text-sm">
          Only ORG_ADMIN can configure stage templates.
        </p>
      )}
    </div>
  );
}
