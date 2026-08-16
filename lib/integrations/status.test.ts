// Plain unit test, not integration — getOcrProvider()/getEmailProvider()
// resolve in-process (module import + a constructor call), no DB/Redis/S3
// needed, same reason lib/dal.test.ts is a plain test too.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getIntegrationStatuses } from "@/lib/integrations/status";

describe("getIntegrationStatuses (M29)", () => {
  const originalOcr = process.env.OCR_PROVIDER;
  const originalEmail = process.env.EMAIL_PROVIDER;

  beforeEach(() => {
    delete process.env.OCR_PROVIDER;
    delete process.env.EMAIL_PROVIDER;
  });

  afterEach(() => {
    if (originalOcr === undefined) delete process.env.OCR_PROVIDER;
    else process.env.OCR_PROVIDER = originalOcr;
    if (originalEmail === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = originalEmail;
  });

  it("reports OK for the default stub OCR and console Email providers", async () => {
    const statuses = await getIntegrationStatuses();
    const ocr = statuses.find((s) => s.key === "ocr");
    const email = statuses.find((s) => s.key === "email");
    expect(ocr).toMatchObject({ configuredProvider: "stub", health: "OK" });
    expect(email).toMatchObject({ configuredProvider: "console", health: "OK" });
  });

  it("reports MISCONFIGURED for an unknown OCR_PROVIDER/EMAIL_PROVIDER value, fails closed", async () => {
    process.env.OCR_PROVIDER = "textract";
    process.env.EMAIL_PROVIDER = "sendgrid";
    const statuses = await getIntegrationStatuses();
    const ocr = statuses.find((s) => s.key === "ocr");
    const email = statuses.find((s) => s.key === "email");
    expect(ocr).toMatchObject({ configuredProvider: "textract", health: "MISCONFIGURED" });
    expect(email).toMatchObject({ configuredProvider: "sendgrid", health: "MISCONFIGURED" });
  });

  it("reports NOT_BUILT for WhatsApp and Telematics — no adapter exists to check (M10/M12)", async () => {
    const statuses = await getIntegrationStatuses();
    const whatsapp = statuses.find((s) => s.key === "whatsapp");
    const telematics = statuses.find((s) => s.key === "telematics");
    expect(whatsapp).toMatchObject({ configuredProvider: null, health: "NOT_BUILT" });
    expect(telematics).toMatchObject({ configuredProvider: null, health: "NOT_BUILT" });
  });
});
