// Guards against ORG_SCOPED_MODELS (lib/scoped-db.ts) drifting from
// prisma/schema.prisma: every model with a direct organizationId column
// must be listed, and nothing without one should be.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORG_SCOPED_MODELS } from "@/lib/scoped-db";

function findModelsWithOrganizationId(schemaPath: string): Set<string> {
  const lines = readFileSync(schemaPath, "utf-8").split("\n");
  const modelsWithOrgId = new Set<string>();
  let currentModel: string | null = null;

  for (const line of lines) {
    const modelStart = line.match(/^model (\w+) \{/);
    if (modelStart) {
      currentModel = modelStart[1];
      continue;
    }
    if (currentModel && line.trim() === "}") {
      currentModel = null;
      continue;
    }
    if (currentModel && /^\s*organizationId\s+String\b/.test(line)) {
      modelsWithOrgId.add(currentModel);
    }
  }

  return modelsWithOrgId;
}

describe("ORG_SCOPED_MODELS", () => {
  it("matches exactly the models with a direct organizationId column in schema.prisma", () => {
    const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
    const actual = findModelsWithOrganizationId(schemaPath);
    const declared = new Set<string>(ORG_SCOPED_MODELS);

    const missingFromList = [...actual].filter((m) => !declared.has(m));
    const extraInList = [...declared].filter((m) => !actual.has(m));

    expect(
      missingFromList,
      `These models have organizationId in schema.prisma but are missing from ORG_SCOPED_MODELS in lib/scoped-db.ts: ${missingFromList.join(", ")}`,
    ).toEqual([]);
    expect(
      extraInList,
      `These models are in ORG_SCOPED_MODELS but have no organizationId column in schema.prisma: ${extraInList.join(", ")}`,
    ).toEqual([]);
  });
});
