import { Info } from "lucide-react";
import {
  editScreenRules,
  type PostKind,
  type PackageRulePolicy,
} from "@/lib/posting/package-rules";

/** The edit, re-post and expiry rules, shown at the top of every edit screen. */
export function PackageRulesNote({
  kind,
  policy = "source",
}: {
  kind: PostKind;
  policy?: PackageRulePolicy;
}) {
  return (
    <aside
      aria-label="How editing works"
      className="flex gap-3 rounded-2xl border border-border bg-muted/50 p-4 text-sm"
    >
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <ul className="space-y-1.5 text-muted-foreground">
        {editScreenRules(kind, policy).map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </aside>
  );
}
