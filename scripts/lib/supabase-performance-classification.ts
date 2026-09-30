export type AdvisorLint = {
  name: string;
  title: string;
  level: string;
  categories?: string[];
  description?: string;
  detail?: string;
  remediation?: string;
  metadata?: Record<string, unknown>;
};

export type IndexMetadataRow = {
  schema_name: string;
  table_name: string;
  index_name: string;
  index_columns: Array<string | null>;
  index_key_count: number;
  index_predicate: string | null;
  is_valid: boolean;
  is_partial: boolean;
  matching_foreign_keys: string[];
};

type ClassifiedLint = {
  lint: AdvisorLint;
  state: "actionable" | "accepted";
  reason: string;
};

const acceptedApplicationIndexes: Record<string, string> = {
  idx_account_profiles_suspended_active:
    "Partial guardrail for suspended-account checks used by auth gates and admin intelligence pages.",
};

/** Only the canonical, single-column non-null predicate covers every FK equality check. */
function coversNullableForeignKey(index: IndexMetadataRow): boolean {
  if (
    !index.is_valid ||
    index.index_key_count !== 1 ||
    !Array.isArray(index.index_columns) ||
    index.index_columns.length !== 1 ||
    index.matching_foreign_keys.length === 0
  ) {
    return false;
  }

  const predicate = index.index_predicate?.match(
    /^\(\s*(?:"((?:[^"]|"")+)"|([a-z_][a-z0-9_$]*))\s+IS\s+NOT\s+NULL\s*\)$/iu
  );
  if (!predicate) return false;
  const column = predicate[1]?.replaceAll('""', '"') ?? predicate[2]?.toLowerCase();
  return column === index.index_columns[0];
}

export function classifyLint(
  lint: AdvisorLint,
  indexMetadata: Map<string, IndexMetadataRow>
): ClassifiedLint {
  if (lint.name !== "unused_index") {
    return {
      lint,
      state: "actionable",
      reason: "This performance finding is not part of the accepted unused-index baseline.",
    };
  }

  const indexName = lint.detail?.match(/Index \\?`([^`\\]+)\\?`/u)?.[1];
  if (!indexName) {
    return {
      lint,
      state: "actionable",
      reason: "The advisor finding did not include a parseable index name.",
    };
  }

  const applicationReason = acceptedApplicationIndexes[indexName];
  if (applicationReason) return { lint, state: "accepted", reason: applicationReason };

  const index = indexMetadata.get(indexName);
  if (index && index.matching_foreign_keys.length > 0) {
    if (!index.is_partial && index.is_valid) {
      return {
        lint,
        state: "accepted",
        reason: `Keeps foreign key checks indexed for ${index.matching_foreign_keys.join(", ")}.`,
      };
    }
    if (coversNullableForeignKey(index)) {
      return {
        lint,
        state: "accepted",
        reason: `The exact non-null predicate covers foreign key equality checks for ${index.matching_foreign_keys.join(", ")}.`,
      };
    }
  }

  return {
    lint,
    state: "actionable",
    reason:
      "Unused index is not recognized as a foreign-key support index or documented application guardrail.",
  };
}
