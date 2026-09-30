// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  classifyLint,
  type AdvisorLint,
  type IndexMetadataRow,
} from "../../scripts/lib/supabase-performance-classification";

const lint: AdvisorLint = {
  name: "unused_index",
  title: "Unused Index",
  level: "INFO",
  detail: "Index \\`nullable_parent_idx\\` on table \\`public.child\\` has not been used",
};
const metadata: IndexMetadataRow = {
  schema_name: "public",
  table_name: "child",
  index_name: "nullable_parent_idx",
  index_columns: ["parent_id"],
  index_key_count: 1,
  index_predicate: "(parent_id IS NOT NULL)",
  is_valid: true,
  is_partial: true,
  matching_foreign_keys: ["child_parent_id_fkey"],
};
const classify = (changes: Partial<IndexMetadataRow> = {}) =>
  classifyLint(lint, new Map([[metadata.index_name, { ...metadata, ...changes }]]));

describe("Supabase unused-index classification", () => {
  it("accepts the exact nullable FK predicate and preserves the original finding", () => {
    const result = classify();
    expect(result.state).toBe("accepted");
    expect(result.reason).toContain("child_parent_id_fkey");
    expect(result.lint).toBe(lint);
    expect(result.lint.level).toBe("INFO");
    expect(result.lint.detail).toBe(lint.detail);
  });

  it("accepts canonical quoted identifiers without conflating their case", () => {
    expect(classify({ index_predicate: '("parent_id" IS NOT NULL)' }).state).toBe("accepted");
    expect(classify({ index_predicate: '("Parent_Id" IS NOT NULL)' }).state).toBe("actionable");
  });

  it.each([
    "(parent_id IS NULL)",
    "(parent_id IS NOT NULL AND status = 'active')",
    "(parent_id IS NOT NULL OR status = 'active')",
    "(reverted_at IS NULL)",
    "(other_parent_id IS NOT NULL)",
    "(COALESCE(parent_id, '00000000-0000-0000-0000-000000000000') IS NOT NULL)",
    "((parent_id IS NOT NULL))",
    "true",
    null,
  ])("keeps unsupported predicate %s actionable", (index_predicate) => {
    expect(classify({ index_predicate }).state).toBe("actionable");
  });

  it.each([
    { matching_foreign_keys: [] },
    { is_valid: false },
    { index_key_count: 2 },
    { index_columns: ["parent_id", "status"] },
    { index_columns: [] },
    { index_columns: [null] },
  ])("requires complete valid single-column FK metadata: %j", (changes) => {
    expect(classify(changes).state).toBe("actionable");
  });

  it("preserves existing unconditional FK acceptance", () => {
    expect(classify({ is_partial: false, index_predicate: null }).state).toBe("accepted");
    expect(classify({ is_partial: false, index_predicate: null, is_valid: false }).state).toBe(
      "actionable"
    );
  });

  it("fails closed when metadata contains a PostgreSQL array string instead of JSON", () => {
    expect(classify({ index_columns: "{parent_id}" as unknown as string[] }).state).toBe(
      "actionable"
    );
  });

  it("does not accept unknown metadata, malformed details or different advisor warnings", () => {
    expect(classifyLint(lint, new Map()).state).toBe("actionable");
    expect(classifyLint({ ...lint, detail: "No index name" }, new Map()).state).toBe("actionable");
    expect(classifyLint({ ...lint, name: "unindexed_foreign_keys" }, new Map()).state).toBe(
      "actionable"
    );
  });

  it("leaves non-FK guardrails and unused indexes outside the explicit baseline actionable", () => {
    for (const name of [
      "idx_account_acquisition_source",
      "dsar_cases_subject_idx",
      "idx_listings_expired_delete",
      "content_effects_open_row_idx",
      "content_effects_restriction_idx",
    ]) {
      expect(
        classifyLint({ ...lint, detail: `Index \`${name}\` has not been used` }, new Map()).state
      ).toBe("actionable");
    }
  });

  it("Postgres can use the non-null index for parameterized FK equality and preserve null children", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE parent(id integer PRIMARY KEY);
        CREATE TABLE child(id integer PRIMARY KEY, parent_id integer REFERENCES parent(id) ON DELETE SET NULL);
        INSERT INTO parent VALUES (1),(2);
        INSERT INTO child VALUES (1,1),(2,NULL),(3,2);
        CREATE INDEX nullable_parent_idx ON child(parent_id) WHERE parent_id IS NOT NULL;
        SET enable_seqscan = off;
      `);
      const plan = await db.query<{ "QUERY PLAN": string }>(
        "EXPLAIN SELECT id FROM child WHERE parent_id = $1",
        [1]
      );
      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("nullable_parent_idx");
      await db.exec("DELETE FROM parent WHERE id = 1;");
      const children = await db.query<{ id: number; parent_id: number | null }>(
        "SELECT id,parent_id FROM child ORDER BY id"
      );
      expect(children.rows).toEqual([
        { id: 1, parent_id: null },
        { id: 2, parent_id: null },
        { id: 3, parent_id: 2 },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);
});
