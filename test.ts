/**
 * test.ts – Unact unit tests (no external test runner required)
 *
 * Validates:
 *  1. signal get/set
 *  2. derived auto-tracking
 *  3. transaction batching (effects run once per commit)
 *  4. deterministic effect order
 *  5. LIFO cleanup order on scope dispose
 *  6. PureRenderViolationError when signal.set() is called in derived
 *  7. CircularDependencyError detection
 *  8. onMount / onCleanup lifecycle
 */

import {
  signal,
  derived,
  transaction,
  createScope,
  createEffect,
  onMount,
  onCleanup,
  disposeScope,
  PureRenderViolationError,
  CircularDependencyError,
} from "./runtime";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(() => {
          console.log(`  ✓ ${name}`);
          passed++;
        })
        .catch((err) => {
          console.error(`  ✗ ${name}\n      ${err}`);
          failed++;
        });
    } else {
      console.log(`  ✓ ${name}`);
      passed++;
    }
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertThrows(fn: () => void, ErrorClass: new (message: string) => Error): void {
  try {
    fn();
    throw new Error(`Expected ${ErrorClass.name} to be thrown but nothing was thrown`);
  } catch (err) {
    if (!(err instanceof ErrorClass)) throw err;
  }
}

// ── 1. Signal ──────────────────────────────────────────────────────────────

console.log("\n── 1. Signal ──");

test("signal initialises with the provided value", () => {
  const s = signal(42);
  assert(s.get() === 42, "initial value should be 42");
});

test("signal.set() updates the value", () => {
  const s = signal(0);
  s.set(7);
  assert(s.get() === 7, "value should be 7");
});

test("signal.set() with same value is a no-op (effect should not re-run)", () => {
  const scope = createScope();
  const s = signal(5);
  let runs = 0;
  createEffect(scope, () => {
    s.get();
    runs++;
  });
  const runsBefore = runs;
  s.set(5); // same value
  assert(runs === runsBefore, "effect should not re-run for same value");
  disposeScope(scope);
});

// ── 2. Derived ─────────────────────────────────────────────────────────────

console.log("\n── 2. Derived ──");

test("derived computes from signal", () => {
  const s = signal(3);
  const d = derived(() => s.get() * 2);
  assert(d.get() === 6, "derived should be 6");
});

test("derived updates when dependency changes", () => {
  const s = signal(4);
  const d = derived(() => s.get() + 10);
  s.set(6);
  assert(d.get() === 16, "derived should be 16 after s set to 6");
});

test("derived chains work correctly", () => {
  const a = signal(1);
  const b = derived(() => a.get() * 2);
  const c = derived(() => b.get() + 3);
  assert(c.get() === 5, "c should be 5");
  a.set(5);
  assert(c.get() === 13, "c should be 13 after a set to 5");
});

// ── 3. Transaction ─────────────────────────────────────────────────────────

console.log("\n── 3. Transaction ──");

test("transaction batches effects into a single run", () => {
  const scope = createScope();
  const x = signal(0);
  const y = signal(0);
  let effectRuns = 0;

  createEffect(scope, () => {
    x.get();
    y.get();
    effectRuns++;
  });

  const runsBefore = effectRuns; // effect ran once on creation
  transaction(() => {
    x.set(1);
    y.set(2);
  });
  assert(
    effectRuns === runsBefore + 1,
    `effect should run exactly once after transaction, but ran ${effectRuns - runsBefore} times`
  );
  disposeScope(scope);
});

test("nested transaction delegates to outer commit", () => {
  const scope = createScope();
  const a = signal(0);
  let runs = 0;

  createEffect(scope, () => {
    a.get();
    runs++;
  });

  const before = runs;
  transaction(() => {
    transaction(() => {
      a.set(1);
    });
    a.set(2);
  });
  assert(runs === before + 1, "nested transaction should produce exactly one commit");
  assert(a.get() === 2, "final value should be 2");
  disposeScope(scope);
});

// ── 4. Deterministic effect order ─────────────────────────────────────────

console.log("\n── 4. Deterministic effect order ──");

test("effects run in registration order after commit", () => {
  const scope = createScope();
  const s = signal(0);
  const order: number[] = [];

  createEffect(scope, () => { s.get(); order.push(1); });
  createEffect(scope, () => { s.get(); order.push(2); });
  createEffect(scope, () => { s.get(); order.push(3); });

  // Reset after initial runs.
  order.length = 0;

  s.set(1);

  assert(
    JSON.stringify(order) === JSON.stringify([1, 2, 3]),
    `expected [1,2,3] but got [${order}]`
  );
  disposeScope(scope);
});

// ── 5. Scope and cleanup ───────────────────────────────────────────────────

console.log("\n── 5. Scope and cleanup ──");

test("disposeScope runs cleanups in LIFO order", () => {
  const scope = createScope();
  const log: string[] = [];

  onCleanup(scope, () => log.push("A"));
  onCleanup(scope, () => log.push("B"));
  onCleanup(scope, () => log.push("C"));

  disposeScope(scope);
  assert(
    JSON.stringify(log) === JSON.stringify(["C", "B", "A"]),
    `LIFO order expected [C,B,A] but got [${log}]`
  );
});

test("effect cleanup runs before re-execution", () => {
  const scope = createScope();
  const s = signal(0);
  const log: string[] = [];

  createEffect(scope, () => {
    const v = s.get();
    log.push(`run:${v}`);
    return () => log.push(`cleanup:${v}`);
  });

  s.set(1);
  s.set(2);

  assert(
    JSON.stringify(log) === JSON.stringify(["run:0", "cleanup:0", "run:1", "cleanup:1", "run:2"]),
    `expected correct run/cleanup sequence but got [${log}]`
  );
  disposeScope(scope);
});

test("disposeScope stops effect from reacting to further changes", () => {
  const scope = createScope();
  const s = signal(0);
  let runs = 0;

  createEffect(scope, () => {
    s.get();
    runs++;
  });

  disposeScope(scope);
  const runsBefore = runs;
  s.set(99); // should NOT trigger the disposed effect
  assert(runs === runsBefore, "disposed effect should not react to signal changes");
});

// ── 6. Pure-render enforcement ─────────────────────────────────────────────

console.log("\n── 6. Pure-render enforcement ──");

test("derived computation throws PureRenderViolationError on signal.set()", () => {
  const a = signal(1);
  const b = signal(2);
  const bad = derived(() => {
    b.set(99); // mutation inside derived – should throw
    return a.get();
  });
  assertThrows(() => bad.get(), PureRenderViolationError);
});

// ── 7. Circular dependency ─────────────────────────────────────────────────

console.log("\n── 7. Circular dependency detection ──");

test("CircularDependencyError is thrown for circular derived chain", () => {
  // We can only simulate self-reference since derived is lazy.
  // Build a derived that tries to read itself via a closure.
  let selfRef: ReturnType<typeof derived<number>> | null = null;
  selfRef = derived(() => {
    if (selfRef) return selfRef.get() + 1; // circular
    return 0;
  });
  assertThrows(() => selfRef!.get(), CircularDependencyError);
});

// ── 8. onMount / onCleanup ─────────────────────────────────────────────────

console.log("\n── 8. onMount / onCleanup lifecycle ──");

test("onMount runs asynchronously after scope creation", async () => {
  const scope = createScope();
  let mounted = false;

  onMount(scope, () => {
    mounted = true;
  });

  // Before the microtask queue flushes, mounted should still be false.
  assert(!mounted, "should not be mounted synchronously");

  await Promise.resolve(); // flush microtasks

  assert(mounted, "should be mounted after microtask flush");
  disposeScope(scope);
});

// ── Summary ────────────────────────────────────────────────────────────────

// Allow async tests to settle.
setTimeout(() => {
  console.log(`\n══ Test Results: ${passed} passed, ${failed} failed ══\n`);
  if (failed > 0) process.exit(1);
}, 100);
