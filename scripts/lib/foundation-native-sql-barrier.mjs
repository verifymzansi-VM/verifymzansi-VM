/** Track the actual child lifetime; explicit holds end only after the caller
 * has committed and verified its synthetic revocation. No elapsed-time proof.
 */
export function controlNativeSqlChild(child, statement, { hold = false } = {}) {
  let resolveBarrier,
    rejectBarrier,
    backendPid,
    reached = false,
    released = false;
  let captured = "";
  const barrier = new Promise((resolve, reject) => {
    resolveBarrier = resolve;
    rejectBarrier = reject;
  });
  const finish = (command) => {
    if (released || !hold) return;
    released = true;
    if (!child.stdin.destroyed) child.stdin.end(`\n${command};\n`);
  };
  const timeout = setTimeout(() => {
    rejectBarrier(new Error("Local evidence barrier timeout"));
    finish("rollback");
  }, 10000);
  child.stdout.on("data", (chunk) => {
    captured = (captured + chunk.toString()).slice(-4096);
    let newline;
    while ((newline = captured.indexOf("\n")) >= 0) {
      const line = captured.slice(0, newline).replace(/\r$/, "");
      captured = captured.slice(newline + 1);
      const match = line.match(/^EVIDENCE_LOCK_HELD(?::([1-9][0-9]*))?$/);
      if (match && (!hold || match[1])) {
        if (match[1]) backendPid = Number(match[1]);
        reached = true;
        clearTimeout(timeout);
        resolveBarrier();
      }
    }
  });
  child.stderr.resume();
  child.stdin.on("error", () => rejectBarrier(new Error("Local evidence input failed")));
  const done = new Promise((resolve) => {
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (!reached) rejectBarrier(new Error("Local evidence barrier missing"));
      resolve(code ?? -1);
    });
    child.once("error", () => {
      clearTimeout(timeout);
      rejectBarrier(new Error("Local evidence process failed"));
    });
  });
  if (hold) child.stdin.write(statement + "\n");
  else child.stdin.end(statement);
  return {
    barrier,
    done,
    get backendPid() {
      return backendPid;
    },
    release: () => finish("commit"),
    close: () => {
      clearTimeout(timeout);
      finish("rollback");
    },
  };
}
