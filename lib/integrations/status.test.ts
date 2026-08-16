// Plain unit test, not integration — getOcrProvider()/getEmailProvider()/
// getAssistantProvider() (for "stub") resolve in-process (module import +
// a constructor call), no DB/Redis/S3 needed, same reason lib/dal.test.ts
// is a plain test too.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getIntegrationStatuses } from "@/lib/integrations/status";

describe("getIntegrationStatuses (M29/M30)", () => {
  const originalOcr = process.env.OCR_PROVIDER;
  const originalEmail = process.env.EMAIL_PROVIDER;
  const originalAssistant = process.env.ASSISTANT_PROVIDER;

  beforeEach(() => {
    delete process.env.OCR_PROVIDER;
    delete process.env.EMAIL_PROVIDER;
    delete process.env.ASSISTANT_PROVIDER;
  });

  afterEach(() => {
    if (originalOcr === undefined) delete process.env.OCR_PROVIDER;
    else process.env.OCR_PROVIDER = originalOcr;
    if (originalEmail === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = originalEmail;
    if (originalAssistant === undefined) delete process.env.ASSISTANT_PROVIDER;
    else process.env.ASSISTANT_PROVIDER = originalAssistant;
  });

  it("reports OK for the default stub OCR, console Email, and stub Assistant providers", async () => {
    const statuses = await getIntegrationStatuses();
    const ocr = statuses.find((s) => s.key === "ocr");
    const email = statuses.find((s) => s.key === "email");
    const assistant = statuses.find((s) => s.key === "assistant");
    expect(ocr).toMatchObject({ configuredProvider: "stub", health: "OK" });
    expect(email).toMatchObject({ configuredProvider: "console", health: "OK" });
    expect(assistant).toMatchObject({ configuredProvider: "stub", health: "OK" });
  });

  it("reports MISCONFIGURED for an unknown OCR_PROVIDER/EMAIL_PROVIDER/ASSISTANT_PROVIDER value, fails closed", async () => {
    process.env.OCR_PROVIDER = "textract";
    process.env.EMAIL_PROVIDER = "sendgrid";
    process.env.ASSISTANT_PROVIDER = "gpt";
    const statuses = await getIntegrationStatuses();
    const ocr = statuses.find((s) => s.key === "ocr");
    const email = statuses.find((s) => s.key === "email");
    const assistant = statuses.find((s) => s.key === "assistant");
    expect(ocr).toMatchObject({ configuredProvider: "textract", health: "MISCONFIGURED" });
    expect(email).toMatchObject({ configuredProvider: "sendgrid", health: "MISCONFIGURED" });
    expect(assistant).toMatchObject({ configuredProvider: "gpt", health: "MISCONFIGURED" });
  });

  it("reports MISCONFIGURED for ASSISTANT_PROVIDER=claude with no ANTHROPIC_API_KEY set, fails closed", async () => {
    process.env.ASSISTANT_PROVIDER = "claude";
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const statuses = await getIntegrationStatuses();
      const assistant = statuses.find((s) => s.key === "assistant");
      expect(assistant).toMatchObject({ configuredProvider: "claude", health: "MISCONFIGURED" });
    } finally {
      if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  it("reports NOT_BUILT for WhatsApp and Telematics — no adapter exists to check (M10/M12)", async () => {
    const statuses = await getIntegrationStatuses();
    const whatsapp = statuses.find((s) => s.key === "whatsapp");
    const telematics = statuses.find((s) => s.key === "telematics");
    expect(whatsapp).toMatchObject({ configuredProvider: null, health: "NOT_BUILT" });
    expect(telematics).toMatchObject({ configuredProvider: null, health: "NOT_BUILT" });
  });
});
