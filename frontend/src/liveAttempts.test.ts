/* Tests for the live attempts persistence used by BreakIt: saving
 * writes to localStorage, loading restores what was saved, corrupt
 * stored JSON falls back to an empty list, and the cap is enforced.
 * Invalid stored entries are dropped on load, and only the known
 * fields are kept. Saving or clearing an empty list removes the key
 * instead of writing "[]".
 * A small in-memory Storage stand-in is used so the tests do not
 * depend on a browser or on jsdom localStorage. */

import {
  LIVE_ATTEMPTS_STORAGE_KEY,
  MAX_LIVE_ATTEMPTS,
  addLiveAttempt,
  clearLiveAttempts,
  loadLiveAttempts,
  nextAttemptId,
  saveLiveAttempts,
  type LiveAttempt,
} from "../../web/src/lib/liveAttempts.js";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function attempt(overrides: Partial<LiveAttempt> = {}): LiveAttempt {
  return {
    id: 1,
    kind: "change_recipient",
    obligationId: "demo-live-007",
    recipient: "cynexmaster.testnet",
    amount: "100",
    outcome: "refused",
    code: "ERR_RECIPIENT_SUBSTITUTION",
    txHash: "attacktx123",
    receiptIndex: null,
    error: "Recipient does not match the locked terms.",
    at: "17:00:00",
    ...overrides,
  };
}

describe("live attempts persistence", () => {
  it("uses the versioned storage key", () => {
    expect(LIVE_ATTEMPTS_STORAGE_KEY).toBe("cynex-live-attempts-v1");
  });

  it("saving an attempt writes it to localStorage", () => {
    const storage = memoryStorage();
    saveLiveAttempts([attempt()], storage);
    const raw = storage.getItem(LIVE_ATTEMPTS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as LiveAttempt[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].obligationId).toBe("demo-live-007");
    expect(parsed[0].outcome).toBe("refused");
    expect(parsed[0].txHash).toBe("attacktx123");
  });

  it("save and load helpers restore a saved attempt", () => {
    const storage = memoryStorage();
    saveLiveAttempts([attempt({ id: 7 })], storage);
    expect(loadLiveAttempts(storage)).toEqual([attempt({ id: 7 })]);
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadLiveAttempts(memoryStorage())).toEqual([]);
  });

  it("corrupt stored JSON falls back to an empty list", () => {
    const storage = memoryStorage({ [LIVE_ATTEMPTS_STORAGE_KEY]: "{not json" });
    expect(loadLiveAttempts(storage)).toEqual([]);
  });

  it("a stored non-array falls back to an empty list", () => {
    const storage = memoryStorage({ [LIVE_ATTEMPTS_STORAGE_KEY]: '{"id": 1}' });
    expect(loadLiveAttempts(storage)).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones", () => {
    const storage = memoryStorage({
      [LIVE_ATTEMPTS_STORAGE_KEY]: JSON.stringify([
        attempt({ id: 2 }),
        { id: "bad", outcome: "refused" },
        attempt({ id: 3, outcome: "paid", code: null, receiptIndex: 36, obligationId: "demo-live-006" }),
      ]),
    });
    const loaded = loadLiveAttempts(storage);
    expect(loaded.map((a) => a.id)).toEqual([2, 3]);
  });

  it("a throwing storage falls back to an empty list and never throws on save or clear", () => {
    const broken = {
      get length() {
        return 0;
      },
      clear: () => {},
      getItem: () => {
        throw new Error("denied");
      },
      key: () => null,
      removeItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as Storage;
    expect(loadLiveAttempts(broken)).toEqual([]);
    expect(() => saveLiveAttempts([attempt()], broken)).not.toThrow();
    expect(() => clearLiveAttempts(broken)).not.toThrow();
  });

  it("addLiveAttempt prepends the newest attempt first", () => {
    const prev = [attempt({ id: 1 })];
    const next = addLiveAttempt(prev, attempt({ id: 2 }));
    expect(next.map((a) => a.id)).toEqual([2, 1]);
  });

  it("the cap keeps only the most recent 20 attempts", () => {
    expect(MAX_LIVE_ATTEMPTS).toBe(20);
    let list: LiveAttempt[] = [];
    for (let i = 1; i <= 25; i++) {
      list = addLiveAttempt(list, attempt({ id: i }));
    }
    expect(list).toHaveLength(20);
    expect(list[0].id).toBe(25);
    expect(list[19].id).toBe(6);
  });

  it("saving caps the stored list at 20", () => {
    const storage = memoryStorage();
    const many = Array.from({ length: 25 }, (_, i) => attempt({ id: i + 1 }));
    saveLiveAttempts(many, storage);
    const raw = JSON.parse(storage.getItem(LIVE_ATTEMPTS_STORAGE_KEY) as string) as LiveAttempt[];
    expect(raw).toHaveLength(20);
    expect(loadLiveAttempts(storage)).toHaveLength(20);
  });

  it("clearing removes the stored attempts", () => {
    const storage = memoryStorage();
    saveLiveAttempts([attempt()], storage);
    clearLiveAttempts(storage);
    expect(storage.getItem(LIVE_ATTEMPTS_STORAGE_KEY)).toBeNull();
    expect(loadLiveAttempts(storage)).toEqual([]);
  });

  it("nextAttemptId continues past the highest restored id", () => {
    expect(nextAttemptId([])).toBe(1);
    expect(nextAttemptId([attempt({ id: 4 }), attempt({ id: 9 })])).toBe(10);
  });

  it("a save and load round trip restores attempts and the next id resumes past the highest", () => {
    const storage = memoryStorage();
    saveLiveAttempts([attempt({ id: 4 }), attempt({ id: 9 })], storage);
    const loaded = loadLiveAttempts(storage);
    expect(loaded.map((a) => a.id)).toEqual([4, 9]);
    expect(nextAttemptId(loaded)).toBe(10);
  });

  it("saving an empty list removes the key instead of writing []", () => {
    const storage = memoryStorage();
    saveLiveAttempts([attempt()], storage);
    expect(storage.getItem(LIVE_ATTEMPTS_STORAGE_KEY)).not.toBeNull();
    saveLiveAttempts([], storage);
    expect(storage.getItem(LIVE_ATTEMPTS_STORAGE_KEY)).toBeNull();
  });

  it("clearing removes the key and never leaves [] behind", () => {
    const storage = memoryStorage();
    saveLiveAttempts([attempt()], storage);
    clearLiveAttempts(storage);
    expect(storage.getItem(LIVE_ATTEMPTS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LIVE_ATTEMPTS_STORAGE_KEY)).not.toBe("[]");
  });

  it("rejects a non-positive or non-safe-integer id", () => {
    const storage = memoryStorage({
      [LIVE_ATTEMPTS_STORAGE_KEY]: JSON.stringify([
        attempt({ id: 2 }),
        attempt({ id: 0 }),
        attempt({ id: -1 }),
        attempt({ id: 1.5 }),
        attempt({ id: 9007199254740993 }),
      ]),
    });
    expect(loadLiveAttempts(storage).map((a) => a.id)).toEqual([2]);
  });

  it("rejects empty string fields", () => {
    const storage = memoryStorage({
      [LIVE_ATTEMPTS_STORAGE_KEY]: JSON.stringify([
        attempt({ id: 2 }),
        attempt({ id: 3, obligationId: "" }),
        attempt({ id: 4, recipient: "   " }),
        attempt({ id: 5, amount: "" }),
        attempt({ id: 6, at: "" }),
      ]),
    });
    expect(loadLiveAttempts(storage).map((a) => a.id)).toEqual([2]);
  });

  it("rejects a non-safe-integer receipt index but keeps null and safe integers", () => {
    const storage = memoryStorage({
      [LIVE_ATTEMPTS_STORAGE_KEY]: JSON.stringify([
        attempt({ id: 2, outcome: "paid", code: null, receiptIndex: 36, obligationId: "demo-live-006" }),
        attempt({ id: 3, receiptIndex: 1.5 }),
        attempt({ id: 4, receiptIndex: -1 }),
        attempt({ id: 5, receiptIndex: null }),
        // The literal rounds to 2^53, which is not a safe integer.
        attempt({ id: 6, receiptIndex: 9007199254740993 }),
      ]),
    });
    expect(loadLiveAttempts(storage).map((a) => a.id)).toEqual([2, 5]);
  });

  it("loads only the known fields", () => {
    const stored = { ...attempt({ id: 7 }), unexpected: "x", nested: { a: 1 } };
    const storage = memoryStorage({
      [LIVE_ATTEMPTS_STORAGE_KEY]: JSON.stringify([stored]),
    });
    const loaded = loadLiveAttempts(storage);
    expect(loaded).toEqual([attempt({ id: 7 })]);
    expect("unexpected" in loaded[0]).toBe(false);
    expect("nested" in loaded[0]).toBe(false);
  });

  it("rejects an id at Number.MAX_SAFE_INTEGER so the next id stays a safe integer", () => {
    const storage = memoryStorage({
      [LIVE_ATTEMPTS_STORAGE_KEY]: JSON.stringify([
        attempt({ id: Number.MAX_SAFE_INTEGER - 1 }),
        attempt({ id: Number.MAX_SAFE_INTEGER }),
      ]),
    });
    const loaded = loadLiveAttempts(storage);
    expect(loaded.map((a) => a.id)).toEqual([Number.MAX_SAFE_INTEGER - 1]);
    expect(nextAttemptId(loaded)).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(nextAttemptId(loaded))).toBe(true);
  });

  it("drops duplicate ids on load, keeping the first occurrence", () => {
    const storage = memoryStorage({
      [LIVE_ATTEMPTS_STORAGE_KEY]: JSON.stringify([
        attempt({ id: 2, outcome: "refused" }),
        attempt({ id: 2, outcome: "paid", code: null, receiptIndex: 36, obligationId: "demo-live-006" }),
        attempt({ id: 3 }),
      ]),
    });
    const loaded = loadLiveAttempts(storage);
    expect(loaded.map((a) => a.id)).toEqual([2, 3]);
    expect(loaded[0].outcome).toBe("refused");
  });
});
