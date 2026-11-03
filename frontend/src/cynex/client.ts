/**
 * Cynex frontend client, Phase 1 Lane B scaffold.
 *
 * Read-only view client against the frozen contract API
 * (docs/contract-api.md, cynex-v1.0.0). Uses near-api-js v7:
 * JsonRpcProvider with callFunction, finality final.
 * No signing, no transactions, no hardcoded results. View return
 * shapes are returned as decoded JSON; callers convert numeric
 * fields to BigInt and confirm the shape against the deployed
 * contract in Phase 2, when Lane A has a skeleton to query.
 */
import { JsonRpcProvider } from "near-api-js";

export const TESTNET_RPC_URL = "https://test.rpc.fastnear.com";

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

    // NEAR JSON u64 is a number, not a string. Sending strings failed live with: invalid type: string "0", expected u64. Pagination values are small, so Number() loses no precision here.
  receipts(start: bigint, limit: bigint): Promise<unknown> {
    return this.view("receipts", { start: Number(start), limit: Number(limit) });
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
