/** Inventory movements must never contribute to wastage demand. */
export function isExcludedWastageReason(value: string): boolean {
  const reason = value.toLowerCase().replace(/[_\s-]+/g, " ").trim();
  return /\bstore\s*use\b/.test(reason)
    || /\b(?:stock\s*)?(?:transfers?|tanfers?)\b/.test(reason)
    || /\bstock\s*(?:(?:take|taking)\s*)?(?:corrections?|adjustments?)\b/.test(reason)
    || /consider as credit note/.test(reason);
}

export function extractWastageReason(text: string): string | null {
  const description = text.match(/reason\s*description\s*:\s*(.+)/i);
  if (description) return description[1].trim();
  const adjustment = text.match(/adjustment\s*reason\s*:\s*(.+)/i);
  return adjustment?.[1]?.trim() ?? null;
}
