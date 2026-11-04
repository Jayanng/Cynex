/**
 * Cynex per-token budget display, Phase 4 Lane B.
 *
 * Pure rendering of a budget read from the contract: the balances view
 * returns spent, reserved, limit, funded, and native_headroom for one
 * policy. Token units and native NEAR are never mixed: the token
 * budget is computed in token base units only, and native headroom is
 * reported separately in yoctoNEAR.
 *
 * The invariant mirrors the contract assert_policy_invariant exactly:
 * spent <= limit, reserved <= limit, spent + reserved <= limit, and
 * spent + reserved <= funded. Headroom for new settlements is
 * min(limit, funded) minus spent minus reserved, and is zero when the
 * invariant does not hold, so a broken invariant is flagged, never
 * rendered as a negative budget.
 *
 * Token figures must be exact: a JS number outside the safe integer
 * range throws instead of rendering a rounded budget. Native headroom
 * is often above that range, so it is reported with an exact flag
 * instead: when the decoded value is already rounded, the display
 * says approximate and the exact value needs a raw RPC read.
 */

export interface BalancesRow {
  spent: unknown;
  reserved: unknown;
  limit: unknown;
  funded: unknown;
  native_headroom?: unknown;
}

export interface NativeHeadroom {
  yocto: bigint;
  exact: boolean;
}

export interface BudgetDisplay {
  limit: bigint;
  spent: bigint;
  reserved: bigint;
  funded: bigint;
  headroom: bigint;
  invariantOk: boolean;
  invariantDetail: string;
  nativeHeadroom: NativeHeadroom | null;
}

function parseTokenU128(value: unknown, name: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch (e) {
      throw new Error("budget " + name + " is not a valid u128: " + String(value));
    }
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("budget " + name + " is not exactly representable as a JS number: " + String(value));
    }
    return BigInt(value);
  }
  throw new Error("budget " + name + " has an unsupported type");
}

function parseNative(value: unknown): NativeHeadroom {
  if (typeof value === "bigint") {
    return { yocto: value, exact: true };
  }
  if (typeof value === "string") {
    try {
      return { yocto: BigInt(value), exact: true };
    } catch (e) {
      throw new Error("budget native_headroom is not a valid u128: " + String(value));
    }
  }
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) {
      return { yocto: BigInt(value), exact: true };
    }
    return { yocto: BigInt(value), exact: false };
  }
  throw new Error("budget native_headroom has an unsupported type");
}

export function describeBudget(row: BalancesRow): BudgetDisplay {
  const limit = parseTokenU128(row.limit, "limit");
  const spent = parseTokenU128(row.spent, "spent");
  const reserved = parseTokenU128(row.reserved, "reserved");
  const funded = parseTokenU128(row.funded, "funded");
  const total = spent + reserved;
  const invariantOk =
    spent <= limit && reserved <= limit && total <= limit && total <= funded;
  const cap = limit < funded ? limit : funded;
  const headroom = invariantOk ? cap - total : 0n;
  const nativeHeadroom =
    row.native_headroom === undefined || row.native_headroom === null
      ? null
      : parseNative(row.native_headroom);
  return {
    limit: limit,
    spent: spent,
    reserved: reserved,
    funded: funded,
    headroom: headroom,
    invariantOk: invariantOk,
    invariantDetail: invariantOk
      ? "spent + reserved <= limit and <= funded"
      : "spent + reserved exceeds limit or funded",
    nativeHeadroom: nativeHeadroom,
  };
}
