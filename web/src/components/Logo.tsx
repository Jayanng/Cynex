/* Cynex C mark. A near-black open circle, a C that opens to the right,
   stroke #1f1b16, with a small orange square at the top right of the C,
   overlapping the upper tip, about 1 to 2 o'clock. Plus the wordmark
   "cynex" in lowercase Instrument Sans, weight 600. */
export function CMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M 35.6 10.2 A 18 18 0 1 0 35.6 37.8"
        stroke="#1f1b16"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <rect x="33.5" y="5.5" width="5.5" height="5.5" rx="1.2" fill="#f3923c" />
    </svg>
  );
}

export function Logo({ markSize = 28 }: { markSize?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CMark size={markSize} />
      <span
        className="leading-none"
        style={{ fontWeight: 600, fontSize: 18, color: "#1f1b16" }}
      >
        cynex
      </span>
    </span>
  );
}
