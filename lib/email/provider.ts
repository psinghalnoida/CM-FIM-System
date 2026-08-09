// No "server-only" guard: this module (via lib/escalations/scan.ts) is
// imported by workers/index.ts, a standalone `tsx` script outside Next's
// build — the M11 lesson (docs/OCR.md) applied from the start this time.
//
// M13: the EmailProvider contract, fixed in docs/SCOPE.md section 5.
// Resolved via EMAIL_PROVIDER (section 7's "adapters without real
// credentials fail closed or use an explicitly-named stub provider,
// never silent fake data") — same pattern as OCR_PROVIDER (M11).

import type { StorageRef } from "@/lib/ocr/provider";

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  attachments?: StorageRef[];
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/**
 * "console" (the default) is a real, committed implementation — no SMTP
 * credentials, no external calls, logs what would have been sent. A real
 * provider (SES, SendGrid, ...) is a follow-up once JBM's email sending
 * setup is decided; setting EMAIL_PROVIDER to anything else today fails
 * closed rather than silently pretending to send.
 */
export async function getEmailProvider(): Promise<EmailProvider> {
  const providerName = process.env.EMAIL_PROVIDER ?? "console";
  if (providerName === "console") {
    const { ConsoleEmailProvider } =
      await import("@/lib/email/console-provider");
    return new ConsoleEmailProvider();
  }
  throw new Error(
    `Unknown EMAIL_PROVIDER "${providerName}" — no adapter implements it yet.`,
  );
}
