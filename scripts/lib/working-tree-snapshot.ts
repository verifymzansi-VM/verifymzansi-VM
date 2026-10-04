import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

/** Mirror source edits, including staged deletions/renames, over a HEAD checkout. */
export async function copyWorkingTreeSnapshot(
  root: string,
  checkout: string,
  git: (args: string[]) => string
): Promise<void> {
  const files = new Set([
    ...git(["ls-tree", "-r", "--name-only", "-z", "HEAD"]).split("\0"),
    ...git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0"),
  ]);
  const checkoutRoot = path.resolve(checkout);
  for (const file of files) {
    if (!file || file.startsWith(".agents/skills/next-browser/")) continue;
    const target = path.resolve(checkoutRoot, file);
    if (!target.startsWith(checkoutRoot + path.sep)) throw new Error("Snapshot escaped checkout");
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await cp(path.join(root, file), target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await rm(target, { force: true });
    }
  }
}
