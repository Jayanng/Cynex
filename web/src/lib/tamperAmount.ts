/* Free-form tamper amount: a whole number of base units, normalized
   through BigInt so 0100 and 100 tamper to the same amount. Returns
   null for anything that is not a whole number. */
export function normalizeTamperAmount(input: string): string | null {
  const v = input.trim();
  if (!/^\d+$/.test(v)) return null;
  return BigInt(v).toString();
}
