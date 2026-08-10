// s3rver ships no types; this is a minimal shape covering what
// lib/documents/document.integration.test.ts actually uses.
declare module "s3rver" {
  interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory?: string;
    resetOnClose?: boolean;
    configureBuckets?: Array<{ name: string }>;
  }

  export default class S3rver {
    constructor(options?: S3rverOptions);
    run(
      callback?: (
        err: unknown,
        info?: { address: string; port: number },
      ) => void,
    ): Promise<{
      address: string;
      port: number;
    }>;
    close(callback?: (err?: unknown) => void): Promise<void>;
  }
}
