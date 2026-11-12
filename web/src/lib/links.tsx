/* Cynex web, explorer link helper.
   One place for every link out to the NEAR testnet explorer, so a
   transaction hash, an account, or an obligation id never renders as
   plain text a judge cannot click. Display text may be truncated for
   space, but the href always carries the full hash or account. An
   obligation id links to the vault account page, since obligations
   have no explorer page of their own. The URL builders live in
   lib/data.ts and are reused here, so the two cannot drift apart. */

import type { ReactNode } from "react";
import { EX_ADDR, EX_TX, EXPLORER_BASE } from "./data.js";

export { EXPLORER_BASE };
export const txUrl = EX_TX;
export const accountUrl = EX_ADDR;

/* Truncate display text only: first 8 characters, "...", last 6. The
   href built from the same hash keeps the full value. */
export function shortHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return hash.slice(0, 8) + "..." + hash.slice(-6);
}

export function TxLink({
  hash,
  className,
  title,
  children,
}: {
  hash: string;
  className?: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noopener" className={className ?? "hash"} title={title}>
      {children ?? hash}
    </a>
  );
}

export function AccountLink({
  account,
  className,
  title,
  children,
}: {
  account: string;
  className?: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <a href={accountUrl(account)} target="_blank" rel="noopener" className={className} title={title}>
      {children ?? account}
    </a>
  );
}
