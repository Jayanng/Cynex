/**
 * Reputation service scaffold, Phase 1 Lane B.
 *
 * Signals must carry a source. A signal without a source is
 * never scored, and a counterparty with too little sourced
 * history maps to WARN, never to a guessed score. The full
 * reputation engine is a Phase 7 item and is not built here.
 */
export interface ReputationSignal {
  source: string;
  value: number;
}

export interface ReputationOutcome {
  score: number | null;
  warnInsufficientHistory: boolean;
}

export function evaluateReputation(signals: ReputationSignal[]): ReputationOutcome {
  const sourced = signals.filter((s) => s.source.trim().length > 0);
  if (sourced.length === 0) {
    return { score: null, warnInsufficientHistory: true };
  }
  const total = sourced.reduce((sum, s) => sum + s.value, 0);
  return { score: total / sourced.length, warnInsufficientHistory: false };
}
