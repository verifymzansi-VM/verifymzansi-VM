const path = require("node:path");

function projectFiles(files) {
  return files.filter((file) => {
    const relative = path.relative(__dirname, file).split(path.sep).join("/");
    if (relative.startsWith("../") || path.isAbsolute(relative))
      throw new Error("Staged file is outside the project");
    // This upstream developer tool has its own configuration. Website rules
    // still cover application code, root configs and maintained project skills.
    return !relative.startsWith(".agents/skills/next-browser/");
  });
}

function commands(files, tools) {
  const selected = projectFiles(files);
  if (!selected.length) return [];
  // lint-staged parses these as argv and uses tinyexec without a shell.
  const args = selected.map((file) => JSON.stringify(file.split(path.sep).join("/"))).join(" ");
  return tools.map((tool) => `${tool} ${args}`);
}

module.exports = {
  "**/*.{ts,tsx}": (files) =>
    commands(files, ["pnpm exec eslint --fix --max-warnings=0", "pnpm exec prettier --write"]),
  "**/*.{json,css,md}": (files) => commands(files, ["pnpm exec prettier --write"]),
};
