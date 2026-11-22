/** Up to two initials of a name ("Sample Motors" -> "SM"), or `fallback`. */
export function initialsOf(name: string | null | undefined, fallback: string) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return letters || fallback;
}
