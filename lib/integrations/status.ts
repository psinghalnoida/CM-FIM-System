// No "server-only" guard: mirrors lib/ocr/provider.ts and
// lib/email/provider.ts (both imported by workers/index.ts, a standalone
// `tsx` script outside Next's build) — this module will be imported by
// the same /api/health route the worker's own healthcheck job doc points
// at, so it stays reachable from either context.
//
// M29: "is this configured and reachable" for every adapter this system
// has an interface for (docs/SCOPE.md section 5/7) — OCR and Email are
// real, resolvable providers today (M11/M13); WhatsApp and Telematics
// (M10/M12) were never built, so there is no code path to check. Reusing
// getOcrProvider()/getEmailProvider() directly (rather than re-reading
// env vars and guessing) means this reports exactly what the app itself
// would do on the next real OCR extraction or escalation email — never a
// second, drifting notion of "configured".

import { getOcrProvider } from "@/lib/ocr/provider";
import { getEmailProvider } from "@/lib/email/provider";

export type IntegrationHealth = "OK" | "MISCONFIGURED" | "NOT_BUILT";

export interface IntegrationStatus {
  key: string;
  name: string;
  /** The provider name currently resolved (env var or its documented
   * default) — null when there's no adapter to configure at all. */
  configuredProvider: string | null;
  health: IntegrationHealth;
  detail: string;
}

async function checkOcr(): Promise<IntegrationStatus> {
  const configuredProvider = process.env.OCR_PROVIDER ?? "stub";
  try {
    // getOcrProvider() transitively imports lib/s3.ts, whose client is a
    // module-load-time singleton that throws if S3_* isn't set — so this
    // legitimately fails MISCONFIGURED if S3 storage isn't configured
    // too, not just OCR_PROVIDER. Honest: the stub provider really does
    // write its raw response to S3 (see lib/ocr/stub-provider.ts).
    await getOcrProvider();
    return {
      key: "ocr",
      name: "OCR / Document Parsing",
      configuredProvider,
      health: "OK",
      detail: `Provider "${configuredProvider}" resolved and ready.`,
    };
  } catch (err) {
    return {
      key: "ocr",
      name: "OCR / Document Parsing",
      configuredProvider,
      health: "MISCONFIGURED",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkEmail(): Promise<IntegrationStatus> {
  const configuredProvider = process.env.EMAIL_PROVIDER ?? "console";
  try {
    await getEmailProvider();
    return {
      key: "email",
      name: "Email / Escalations",
      configuredProvider,
      health: "OK",
      detail: `Provider "${configuredProvider}" resolved and ready.`,
    };
  } catch (err) {
    return {
      key: "email",
      name: "Email / Escalations",
      configuredProvider,
      health: "MISCONFIGURED",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function notBuilt(key: string, name: string, milestone: string): IntegrationStatus {
  return {
    key,
    name,
    configuredProvider: null,
    health: "NOT_BUILT",
    detail: `Not implemented yet — planned for ${milestone} (see docs/SCOPE.md).`,
  };
}

/**
 * Every adapter this system has (or has documented) an interface for.
 * OCR/Email get a real "does this resolve" check; WhatsApp/Telematics
 * report a static NOT_BUILT status rather than a fabricated reachability
 * result, since M10/M12 never shipped an adapter to check.
 */
export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const [ocr, email] = await Promise.all([checkOcr(), checkEmail()]);
  return [
    ocr,
    email,
    notBuilt("whatsapp", "WhatsApp", "M10"),
    notBuilt("telematics", "Telematics", "M12"),
  ];
}
