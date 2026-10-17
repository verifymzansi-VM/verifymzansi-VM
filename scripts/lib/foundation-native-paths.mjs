import { lstatSync, realpathSync, mkdirSync } from "node:fs";
import path from "node:path";

function parts(relative) {
  const result = relative.split(/[\\/]/);
  if (path.isAbsolute(relative) || result.some((part) => !part || part === "." || part === ".."))
    throw new Error("Invalid fixture relative path");
  return result;
}
/** Reject reparse points at every existing path component; never create a directory through one. */
export function assertFixturePath(root, relative, { allowMissing = false, type } = {}) {
  const physical = realpathSync(root);
  let current = path.resolve(root);
  const segments = parts(relative);
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (!info) {
      if (allowMissing) return path.resolve(root, relative);
      throw new Error("Missing fixture path");
    }
    const expected = path.join(physical, ...segments.slice(0, index + 1));
    if (info.isSymbolicLink() || path.relative(expected, realpathSync(current)) !== "")
      throw new Error("Fixture reparse path prohibited");
    if (index < segments.length - 1 && !info.isDirectory())
      throw new Error("Fixture parent is not a directory");
    if (
      index === segments.length - 1 &&
      ((type === "directory" && !info.isDirectory()) || (type === "file" && !info.isFile()))
    )
      throw new Error("Unexpected fixture path type");
  }
  return current;
}
export function ensureFixtureDirectory(root, relative) {
  const segments = parts(relative);
  for (let index = 1; index <= segments.length; index++) {
    const child = segments.slice(0, index).join(path.sep);
    const target = assertFixturePath(root, child, { allowMissing: true, type: "directory" });
    if (!lstatSync(target, { throwIfNoEntry: false })) mkdirSync(target);
    assertFixturePath(root, child, { type: "directory" });
  }
  return path.resolve(root, relative);
}
