/**
 * Cynex frontend client,  frontend scaffold.
 *
 * Read-only view client against the frozen contract API
 * (docs/contract-api.md, cynex-v1.0.0). Uses near-api-js v7:
 * JsonRpcProvider with callFunction, finality final.
 * No signing, no transactions, no hardcoded results. View return
 * shapes are returned as decoded JSON; callers convert numeric
 * fields to BigInt and confirm the shape against the deployed
 * contract in , when contract has a skeleton to query.
 */
import { JsonRpcProvider } from "near-api-js";

export const TESTNET_RPC_URL = "https://test.rpc.fastnear.com";

/**
 * Convert a u64 pagination value to the JSON number the
 * contract expects, refusing to round silently. NEAR JSON u64
 * is a number, not a string: sending strings failed live with
 * invalid type: string "0", expected u64. But Number() loses
 * precision above 2^53, so a value outside the safe integer
 * range throws here instead of being sent rounded. BigInt
 * cannot be sent directly, the contract takes a JSON number,
 * so throwing is the only honest option for such a value.
 */
export function toSafeJsonU64(value: bigint, name: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      "receipts " +
        name +
        " " +
        value.toString() +
        " is outside the safe integer range; the contract expects a JSON number, so it cannot be sent exactly",
    );
  }
  return Number(value);
}

export class CynexClient {
  private provider: JsonRpcProvider;
  readonly vaultId: string;

  constructor(vaultId: string, rpcUrl: string = TESTNET_RPC_URL) {
    this.vaultId = vaultId;
    this.provider = new JsonRpcProvider({ url: rpcUrl });
  }

  private async view(method: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.provider.callFunction({
      contractId: this.vaultId,
      method,
      args,
      blockQuery: { finality: "final" },
    });
    return result as unknown;
  }

  getPolicy(policy_id: string): Promise<unknown> {
    return this.view("get_policy", { policy_id });
  }

  getObligation(obligation_id: string): Promise<unknown> {
    return this.view("get_obligation", { obligation_id });
  }

  balances(policy_id: string): Promise<unknown> {
    return this.view("balances", { policy_id });
  }

  // Pagination values are checked against the safe integer
  // range before conversion (see toSafeJsonU64 above): a value
  // above 2^53 throws instead of silently rounding. Pagination
  // values are small in practice (receipt indices 0-15), so the
  // throw never fires in practice, but the conversion is now
  // correct in principle.
  receipts(start: bigint, limit: bigint): Promise<unknown> {
    return this.view("receipts", {
      start: toSafeJsonU64(start, "start"),
      limit: toSafeJsonU64(limit, "limit"),
    });
  }

  state(): Promise<unknown> {
    return this.view("state", {});
  }

  /** Key sandbox check: list access keys for an account. */
  viewAccessKeyList(accountId: string) {
    return this.provider.viewAccessKeyList({
      accountId,
      finalityQuery: { finality: "final" },
    });
  }
}
