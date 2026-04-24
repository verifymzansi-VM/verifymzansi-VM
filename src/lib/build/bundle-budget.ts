import path from "node:path";

export type RouteBundle = {
  route: string;
  sizeBytes: number;
  files: string[];
};

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function stripAppRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

export function routeFromAppChunk(appChunksDir: string, filePath: string): string | null {
  const relativePath = toPosixPath(path.relative(appChunksDir, filePath));
  if (
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath) ||
    !relativePath.endsWith(".js")
  ) {
    return null;
  }

  const segments = relativePath.split("/").filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) {
    return null;
  }

  const chunkName = fileName.replace(/-[a-f0-9]+\.js$/i, "").replace(/\.js$/i, "");
  const routeSegments = segments.filter((segment) => !stripAppRouteGroup(segment));

  if (chunkName !== "page") {
    routeSegments.push(chunkName);
  }

  return routeSegments.length > 0 ? `/${routeSegments.join("/")}` : "/";
}

export function collectAppRouteBundles(
  appChunkFiles: string[],
  appChunksDir: string,
  getFileSize: (filePath: string) => number
): RouteBundle[] {
  const byRoute = new Map<string, RouteBundle>();

  for (const filePath of appChunkFiles) {
    const route = routeFromAppChunk(appChunksDir, filePath);
    if (!route) {
      continue;
    }

    const existing = byRoute.get(route);
    if (existing) {
      existing.sizeBytes += getFileSize(filePath);
      existing.files.push(filePath);
      continue;
    }

    byRoute.set(route, {
      route,
      sizeBytes: getFileSize(filePath),
      files: [filePath],
    });
  }

  return [...byRoute.values()];
}
