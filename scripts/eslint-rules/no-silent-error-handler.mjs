/**
 * Refuses error handlers that throw an error away without a trace:
 *
 *   try { ... } catch {}
 *   promise.catch(() => {})
 *   promise.catch(() => undefined)
 *   promise.then(onDone, () => {})
 *
 * A handler passes when it does something (logs, rethrows, returns a real value
 * such as null that the caller checks) or when it holds a comment saying why
 * ignoring the error is safe. The comment is the explicit, reviewable
 * annotation; a bare TODO, FIXME or XXX note is not a reason.
 */

const PLACEHOLDER = /^(?:todo|fixme|xxx)\b/i;

function hasReason(node, sourceCode) {
  return sourceCode.getCommentsInside(node).some((comment) => {
    const text = comment.value.replace(/^[\s*]+/, "").trim();
    return text.length > 0 && !PLACEHOLDER.test(text);
  });
}

function isUndefinedValue(node) {
  return (
    (node.type === "Identifier" && node.name === "undefined") ||
    (node.type === "UnaryExpression" &&
      node.operator === "void" &&
      node.argument.type === "Literal")
  );
}

function isSilentFunction(node, sourceCode) {
  if (!node || (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression"))
    return false;
  const empty =
    node.body.type === "BlockStatement" ? node.body.body.length === 0 : isUndefinedValue(node.body);
  return empty && !hasReason(node, sourceCode);
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
const noSilentErrorHandler = {
  meta: {
    type: "problem",
    docs: { description: "Refuse silent error handlers in server code" },
    schema: [],
    messages: { silent: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    // Browser code ("use client") is out of scope: this rule is for server code.
    const clientModule = sourceCode.ast.body.some(
      (statement) =>
        statement.type === "ExpressionStatement" && statement.directive === "use client"
    );
    if (clientModule) return {};
    return {
      CatchClause(node) {
        if (node.body.body.length === 0 && !hasReason(node.body, sourceCode))
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
