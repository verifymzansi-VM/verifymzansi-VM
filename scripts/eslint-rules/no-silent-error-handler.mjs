/**
 * Refuses error handlers that throw an error away without a trace:
 *
 *   try { ... } catch {}
 *   promise.catch(() => {})
 *   promise.then(onDone, () => {})
 *
 * A handler passes when it does something (logs, rethrows, returns a value the
 * caller checks) or when it holds a comment saying why ignoring the error is
 * safe. The comment is the explicit, reviewable annotation.
 */

function isSilentFunction(node, sourceCode) {
  if (!node || (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression"))
    return false;
  return (
    node.body.type === "BlockStatement" &&
    node.body.body.length === 0 &&
    sourceCode.getCommentsInside(node.body).length === 0
  );
}

function calledMethod(node) {
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  return callee.property.type === "Identifier" ? callee.property.name : null;
}

const MESSAGE =
  "This error handler discards the error silently. Log it with a stable reason, " +
  "rethrow it, or add a comment saying why ignoring it is safe.";

/** @type {import("eslint").Rule.RuleModule} */
export const noSilentErrorHandler = {
  meta: {
    type: "problem",
    docs: { description: "Refuse empty error handlers in server code" },
    schema: [],
    messages: { silent: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      CatchClause(node) {
        if (node.body.body.length === 0 && sourceCode.getCommentsInside(node.body).length === 0)
          context.report({ node, messageId: "silent" });
      },
      CallExpression(node) {
        const method = calledMethod(node);
        const handler =
          method === "catch" ? node.arguments[0] : method === "then" ? node.arguments[1] : null;
        if (isSilentFunction(handler, sourceCode))
          context.report({ node: handler, messageId: "silent" });
      },
    };
  },
};

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "verifymzansi-local" },
  rules: { "no-silent-error-handler": noSilentErrorHandler },
};

export default plugin;
