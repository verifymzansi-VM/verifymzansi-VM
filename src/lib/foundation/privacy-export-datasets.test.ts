/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  PRIVACY_EXPORT_DATASET_SETS,
  isAcceptedPrivacyExportDatasetSet,
} from "./privacy-export-datasets";
import { registryDatasetNames, snapshotDatasetNames } from "@/test/privacy-export-registry";

describe("access export datasets", () => {
  it("accepts the registry of the committed database snapshot", () => {
    const names = snapshotDatasetNames();
    expect(new Set(names).size).toBe(names.length);
    expect(isAcceptedPrivacyExportDatasetSet(names)).toBe(true);
    // The snapshot is one of the accepted sets exactly, not merely as large.
    expect(
      PRIVACY_EXPORT_DATASET_SETS.some(
        (set) => [...set].sort().join(",") === [...names].sort().join(",")
      )
    ).toBe(true);
  });

  it("keeps every accepted set unique and well formed", () => {
    expect(PRIVACY_EXPORT_DATASET_SETS.length).toBeGreaterThan(0);
    for (const set of PRIVACY_EXPORT_DATASET_SETS) {
      expect(new Set(set).size).toBe(set.length);
      for (const name of set) expect(name).toMatch(/^[a-z_]{1,40}$/);
    }
  });

  it("refuses a missing, extra, renamed or repeated dataset", () => {
    const [set] = PRIVACY_EXPORT_DATASET_SETS;
    expect(isAcceptedPrivacyExportDatasetSet([...set])).toBe(true);
    expect(isAcceptedPrivacyExportDatasetSet([...set].reverse())).toBe(true);
    expect(isAcceptedPrivacyExportDatasetSet(set.slice(1))).toBe(false);
    expect(isAcceptedPrivacyExportDatasetSet([...set, "extra_set"])).toBe(false);
    expect(isAcceptedPrivacyExportDatasetSet([...set.slice(1), "profile_v2"])).toBe(false);
    expect(isAcceptedPrivacyExportDatasetSet([...set.slice(1), set[1]])).toBe(false);
    expect(isAcceptedPrivacyExportDatasetSet([])).toBe(false);
  });

  it("accepts either set during a transition", () => {
    const sets = [
      ["a", "b"],
      ["a", "b", "c"],
    ];
    expect(isAcceptedPrivacyExportDatasetSet(["b", "a"], sets)).toBe(true);
    expect(isAcceptedPrivacyExportDatasetSet(["c", "a", "b"], sets)).toBe(true);
    expect(isAcceptedPrivacyExportDatasetSet(["a", "c"], sets)).toBe(false);
  });
});

describe("registry reader", () => {
  const define = (registry: string) => `CREATE OR REPLACE FUNCTION internal.f(p uuid)
 RETURNS jsonb LANGUAGE plpgsql AS $function$
declare entry record;
begin
  -- ('commented_out',$q$select 1$q$),
  for entry in select * from (values
    ${registry}
  ) as registry(dataset,statement) loop null; end loop;
end$function$;`;

  it("reads names regardless of layout, comments and quoted SQL", () => {
    const names = registryDatasetNames(
      define(`('one',$q$select 'it''s',$x$('fake',$y$ from t /* ('also_fake', */$q$),
      /* ('hidden',$q$select 1$q$), */
      ( 'two' , $q$select 1 -- ('not_a_name',
        from t$q$ ),('three',$q$select '('''')' x$q$)`)
    );
    expect(names).toEqual(["one", "two", "three"]);
  });

  it("refuses a registry of another shape", () => {
    expect(() => registryDatasetNames(define(`('one',$q$select 1$q$,'extra')`))).toThrow(
      /Registry entry 1/
    );
    expect(() => registryDatasetNames(define(`(one,$q$select 1$q$)`))).toThrow(/Registry entry 1/);
    expect(() =>
      registryDatasetNames(define(`('one',$q$select 1$q$)`).replace("as registry", "as other"))
    ).toThrow(/as registry/);
    expect(() =>
      registryDatasetNames(
        define(`('one',$q$select 1$q$)`).replace(
          "loop null;",
          "loop select * from (values (1)) v; "
        )
      )
    ).toThrow(/Expected one registry/);
  });
});
