/* Formatting helpers. Hashes truncate for display only. Copy always gets
   the full value, and explorers always get the full hash. */

export function shortHash(h: string, head = 6, tail = 4): string {
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function explorerTx(hash: string): string {
  return `https://testnet.nearblocks.io/txns/${hash}`;
}

export function explorerAccount(account: string): string {
  return `https://testnet.nearblocks.io/address/${account}`;
}

/** NEAR nanosecond timestamp -> compact UTC string. */
export function nsToUtc(ns: number | string): string {
  const ms = Number(ns) / 1e6;
  const d = new Date(ms);
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

/** Token base units -> decimal string with unit label. The test token has
    6 decimals. Never mixed with native NEAR anywhere in this app. */
export function baseUnits(v: string | number, decimals = 6): string {
  const s = String(v);
  const pad = s.padStart(decimals + 1, "0");
  const whole = pad.slice(0, -decimals);
  const frac = pad.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export async function copyText(t: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    // Clipboard denied is not a crash. The full value is still visible on tap.
  }
}
