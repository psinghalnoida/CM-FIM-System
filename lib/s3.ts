import { S3Client } from "@aws-sdk/client-s3";

// S3-compatible object storage client (MinIO locally, AWS S3 in prod) —
// see docs/DOCUMENTS.md. Config is entirely env-based so swapping the
// provider (or pointing tests at a local S3-compatible test server) never
// touches application code.
const globalForS3 = globalThis as unknown as {
  s3: S3Client | undefined;
};

function createS3Client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3_ENDPOINT/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY are not set. Copy .env.example to .env.",
    );
  }
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    // MinIO (and this project's local test server) need path-style URLs;
    // AWS S3 in prod sets S3_FORCE_PATH_STYLE=false. See .env.example.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  });
}

export const s3 = globalForS3.s3 ?? createS3Client();

if (process.env.NODE_ENV !== "production") {
  globalForS3.s3 = s3;
}

export function getDocumentsBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error("S3_BUCKET is not set. Copy .env.example to .env.");
  }
  return bucket;
}
