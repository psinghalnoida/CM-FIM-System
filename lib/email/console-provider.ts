// No "server-only" guard — see lib/email/provider.ts's comment; this
// module is dynamically imported by lib/email/provider.ts, which
// workers/index.ts (a standalone `tsx` script outside Next's build)
// reaches transitively via lib/escalations/scan.ts.

import type { EmailMessage, EmailProvider } from "@/lib/email/provider";

/**
 * Logs the message rather than sending it — a real, deterministic
 * implementation for local dev/test/demo, not a placeholder. Tests spy on
 * this via the module import rather than needing a real inbox.
 */
export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      `[email:console] to=${message.to.join(",")} subject="${message.subject}"`,
    );
  }
}
