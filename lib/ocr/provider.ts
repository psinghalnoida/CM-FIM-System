// No "server-only" guard — see lib/ocr/queue.ts's comment; this module
// (via lib/ocr/process-extraction.ts) is imported by workers/index.ts, a
// standalone `tsx` script outside Next's build.
//
// M11: the OCRProvider contract, fixed in docs/SCOPE.md section 5 so
// downstream code (lib/ocr/process-extraction.ts, the worker) codes
// against a stable shape regardless of which implementation is
// configured. Resolved via OCR_PROVIDER (section 7's "adapters without
// real credentials fail closed or use an explicitly-named stub provider,
// never silent fake data") — never a hardcoded import in domain code.

export interface StorageRef {
  bucket: string;
  key: string;
}

export interface ExtractedField {
  key: string;
  value: string;
  confidence: number;
}

export interface OCRProvider {
  extract(
    documentVersionId: string,
    fileRef: StorageRef,
  ): Promise<{
    fields: ExtractedField[];
    rawResponseRef: StorageRef;
  }>;
}

/**
 * Resolves the configured provider. "stub" (the default) is a real,
 * committed implementation — deterministic, no external calls — not a
 * placeholder for "not implemented yet". A real Textract adapter is a
 * follow-up (needs AWS credentials not yet confirmed for JBM); asking for
 * one today fails closed with a clear error rather than silently falling
 * back to fake data.
 */
export async function getOcrProvider(): Promise<OCRProvider> {
  const providerName = process.env.OCR_PROVIDER ?? "stub";
  if (providerName === "stub") {
    const { StubOcrProvider } = await import("@/lib/ocr/stub-provider");
    return new StubOcrProvider();
  }
  throw new Error(
    `Unknown OCR_PROVIDER "${providerName}" — no adapter implements it yet.`,
  );
}
