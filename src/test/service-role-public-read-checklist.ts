import { readFile } from "node:fs/promises";
import path from "node:path";

export const SERVICE_ROLE_PUBLIC_READ_MARKER = "SERVICE_ROLE_PUBLIC_READ_CHECKLIST";

export type ServiceRolePublicReadRoute = {
  file: string;
  method: "GET";
  table: string;
  requiredFilters: readonly string[];
};

export const SERVICE_ROLE_PUBLIC_READ_ROUTES: readonly ServiceRolePublicReadRoute[] = [
  {
    file: "src/app/api/listings/route.ts",
    method: "GET",
    table: "listings",
    requiredFilters: ['.eq("status", "live")', '.eq("area", AREA)'],
  },
  {
    file: "src/app/api/businesses/route.ts",
    method: "GET",
    table: "businesses",
    requiredFilters: ['.eq("status", "live")'],
  },
  {
    file: "src/app/api/promotions/route.ts",
    method: "GET",
    table: "promotions",
    requiredFilters: ['.eq("status", "live")'],
  },
] as const;

export async function readRouteSource(route: ServiceRolePublicReadRoute): Promise<string> {
  return readFile(path.join(process.cwd(), route.file), "utf8");
}

export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function extractExportedFunctionBody(source: string, functionName: string): string {
  const withoutComments = stripComments(source);
  const signature = `export async function ${functionName}`;
  const signatureIndex = withoutComments.indexOf(signature);
  if (signatureIndex === -1) {
    throw new Error(`Missing exported function ${functionName}`);
  }

  const bodyStart = withoutComments.indexOf("{", signatureIndex);
  if (bodyStart === -1) {
    throw new Error(`Missing body for exported function ${functionName}`);
  }

  let depth = 0;
  for (let index = bodyStart; index < withoutComments.length; index += 1) {
    const char = withoutComments[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return withoutComments.slice(bodyStart, index + 1);
      }
    }
  }

  throw new Error(`Unclosed body for exported function ${functionName}`);
}
