/** @vitest-environment node */
import { expect, it } from "vitest";
import { Linter } from "eslint";
import localRules from "../../scripts/eslint-rules/no-silent-error-handler.mjs";

function problems(code: string) {
  const linter = new Linter({ configType: "flat" });
  return linter
    .verify(code, [
      {
        plugins: { local: localRules },
        rules: { "local/no-silent-error-handler": "error" },
        languageOptions: { ecmaVersion: 2024, sourceType: "module" },
      },
    ])
    .map((problem) => `${problem.line}:${problem.ruleId}`);
}

it("refuses empty catch blocks and empty promise error handlers", () => {
  expect(problems("try { run(); } catch {}")).toEqual(["1:local/no-silent-error-handler"]);
  expect(problems("try { run(); } catch (error) {}")).toHaveLength(1);
  expect(problems("work().catch(() => {});")).toHaveLength(1);
  expect(problems("work().catch(function () {});")).toHaveLength(1);
  expect(problems("work().then(done, () => {});")).toHaveLength(1);
  expect(problems("work().catch(() => undefined);")).toHaveLength(1);
  expect(problems("work().catch(() => void 0);")).toHaveLength(1);
});

it("does not accept a bare TODO or FIXME note as the reason", () => {
  expect(problems("try { run(); } catch { /* TODO */ }")).toHaveLength(1);
  expect(problems("work().catch(() => {\n  // FIXME: handle this\n});")).toHaveLength(1);
  expect(problems("try { run(); } catch {\n  // XXX later\n}")).toHaveLength(1);
});

it("leaves browser modules alone", () => {
  expect(problems('"use client";\ntry { run(); } catch {}')).toEqual([]);
  expect(problems('"use server";\ntry { run(); } catch {}')).toHaveLength(1);
});

it("accepts handlers that act, and empty ones that explain themselves", () => {
  expect(problems("try { run(); } catch (error) { log.error('failed', { error }); }")).toEqual([]);
  expect(problems("try { run(); } catch { /* cleanup only; the reply is decided */ }")).toEqual([]);
  expect(problems("work().catch(() => {\n  // stream already refused\n});")).toEqual([]);
  expect(problems("work().catch(() => null);")).toEqual([]);
  expect(problems("work().then(() => {});")).toEqual([]);
  expect(problems("items.forEach(() => {});")).toEqual([]);
});
