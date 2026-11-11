/* Policy spent percentage from u128 base units, computed with BigInt
   arithmetic so large values never lose precision through Number.
   Returns the whole percent, rounded, or null when the limit is not
   a positive number. */
export function policySpentPct(
  spent: number | string,
  limit: number | string,
): number | null {
  try {
    const s = BigInt(spent);
    const l = BigInt(limit);
    if (l <= 0n || s < 0n) return null;
    const bp = (s * 10000n) / l;
    const capped = bp > 1000000n ? 1000000n : bp;
    return Math.round(Number(capped) / 100);
  } catch {
    return null;
  }
}
