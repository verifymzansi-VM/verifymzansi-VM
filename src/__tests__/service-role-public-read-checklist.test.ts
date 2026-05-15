import { describe, expect, it } from "vitest";
import {
  extractExportedFunctionBody,
  readRouteSource,
  SERVICE_ROLE_PUBLIC_READ_MARKER,
  SERVICE_ROLE_PUBLIC_READ_ROUTES,
  stripComments,
} from "@/test/service-role-public-read-checklist";

describe("service-role public read checklist", () => {
  it.each(SERVICE_ROLE_PUBLIC_READ_ROUTES)(
    "$file documents and enforces the service-role public-read boundary",
    async (route) => {
      const source = await readRouteSource(route);
      const executableSource = stripComments(source);
      const getBody = extractExportedFunctionBody(source, route.method);

      expect(source).toContain(SERVICE_ROLE_PUBLIC_READ_MARKER);
      expect(executableSource).toContain("createAdminClient");
      expect(executableSource).toContain(`export async function ${route.method}`);
      expect(getBody).toContain(`.from("${route.table}")`);

      for (const requiredFilter of route.requiredFilters) {
        expect(getBody).toContain(requiredFilter);
      }
    }
  );
});
