/** Up to two letters for an avatar: "Sunset Grill" -> "SG", "budi" -> "B", "D'Spa" -> "DS". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0];
  const letters = words.length > 1 ? first[0] + words[1][0] : first.slice(0, 1);
  return letters.toUpperCase();
}
