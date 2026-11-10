/* The Cynex mark: an open C that opens to the right, warm ink, with a small
   amber square overlapping the upper tip at about one o'clock. Paired with
   the lowercase Instrument Sans wordmark. This is the real brand. */

export function CMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M 35.6 10.2 A 18 18 0 1 0 35.6 37.8" stroke="#1f1b16" strokeWidth="3.2" strokeLinecap="round" />
      <rect x="33.5" y="5.5" width="5.5" height="5.5" rx="1.2" fill="#f3923c" />
    </svg>
  );
}

export function Logo({ size = 28, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <CMark size={size} />
      {wordmark && (
        <span className="wordmark" style={{ fontWeight: 600, fontSize: 20, letterSpacing: "-0.01em", lineHeight: 1 }}>
          cynex
        </span>
      )}
    </span>
  );
}
