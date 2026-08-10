import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { listStageTemplates } from "@/lib/tat/stage-template";
import { listEscalationRulesForStageTemplate } from "@/lib/escalations/escalation-rule";
import { CreateEscalationRuleForm } from "@/components/escalations/create-escalation-rule-form";
import { ScanNowButton } from "@/components/escalations/scan-now-button";

// Demo page proving M13's escalation configuration + manual scan
// end-to-end. Not a polished admin UI — see docs/ESCALATIONS.md for what's
// deferred.
export default async function EscalationRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ stageTemplateId?: string }>;
}) {
  const session = await verifySession();
  const { stageTemplateId } = await searchParams;

  const templates = await listStageTemplates(session);
  const rules = stageTemplateId
    ? await listEscalationRulesForStageTemplate(session, stageTemplateId)
    : [];
  const selectedTemplate = templates.find((t) => t.id === stageTemplateId);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Escalation rules
        </h1>
        {session.user.role === "ORG_ADMIN" && <ScanNowButton />}
      </div>

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        Stage templates
      </h2>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Case type</th>
            <th className="py-2">Stage</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr key={template.id} className="border-border border-b">
              <td className="py-2">{template.caseType}</td>
              <td className="py-2">{template.stageName}</td>
              <td className="py-2">
                <Link
                  href={`/escalation-rules?stageTemplateId=${template.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  Rules
                </Link>
              </td>
            </tr>
          ))}
          {templates.length === 0 && (
            <tr>
              <td
                colSpan={3}
                className="text-muted-foreground py-4 text-center"
              >
                No stage templates configured yet — see{" "}
                <Link
                  href="/tat/stage-templates"
                  className="text-primary underline underline-offset-4"
                >
                  TAT stage templates
                </Link>
                .
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {selectedTemplate && (
        <>
          <h2 className="mb-2 text-lg font-semibold tracking-tight">
            Rules for &ldquo;{selectedTemplate.stageName}&rdquo;
          </h2>
          <table className="mb-4 w-full text-left text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className="py-2">Level</th>
                <th className="py-2">Hours past TAT</th>
                <th className="py-2">Notify</th>
                <th className="py-2">Channel</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-border border-b">
                  <td className="py-2">{rule.escalationLevel}</td>
                  <td className="py-2">{rule.triggerAfterHoursBeyondTat}h</td>
                  <td className="py-2">
                    {rule.notifyRole ?? rule.notifyUserId}
                  </td>
                  <td className="py-2">{rule.channel}</td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="text-muted-foreground py-4 text-center"
                  >
                    No escalation rules for this stage yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {session.user.role === "ORG_ADMIN" ? (
            <CreateEscalationRuleForm stageTemplateId={selectedTemplate.id} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Only ORG_ADMIN can configure escalation rules.
            </p>
          )}
        </>
      )}
    </div>
  );
}
