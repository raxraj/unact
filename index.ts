/**
 * index.ts – Unact demo: Counter + Digital Clock in multiple time zones
 *
 * Demonstrates:
 *  - signal / derived primitives
 *  - transaction() for batched, deterministic commits
 *  - createEffect / onMount / onCleanup for explicit scope lifecycle
 *  - Pure render enforcement (mutations only inside effects/transactions)
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
} from "./runtime";

// ─── Helper ──────────────────────────────────────────────────────────────────

function log(label: string, ...args: unknown[]): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${label}]`, ...args);
}

// ─── 1. Counter demo ─────────────────────────────────────────────────────────

function runCounterDemo(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  Demo 1: Signal-based Counter");
  console.log("═══════════════════════════════════════");

  const scope = createScope();
  const count = signal(0);
  const double = derived(() => count.get() * 2);

  const effectLog: string[] = [];

  // Effect: reacts whenever count changes.
  createEffect(scope, () => {
    const value = count.get();
    const msg = `count → ${value}, double → ${double.get()}`;
    effectLog.push(msg);
    log("effect", msg);
    return () => log("cleanup", `before re-run (count was ${value})`);
  });

  // Increment once – implicit single-signal transaction.
  log("action", "increment count to 1");
  count.set(1);

  // Batch two increments in a single transaction – effects run ONCE after commit.
  log("action", "transaction: set count to 5, then 10");
  transaction(() => {
    count.set(5);
    count.set(10);
  });

  log("action", "increment count to 11");
  count.set(11);

  // Dispose scope – cleanup runs.
  log("action", "dispose scope");
  disposeScope(scope);

  // After dispose, further set() should not trigger the disposed effect.
  count.set(99);

  console.log("\n── Effect log (deterministic order) ──");
  effectLog.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
}

// ─── 2. Digital Clock in multiple time zones ──────────────────────────────────

type TimeZoneEntry = { label: string; tz: string };

const TIME_ZONES: TimeZoneEntry[] = [
  { label: "UTC", tz: "UTC" },
  { label: "New York (ET)", tz: "America/New_York" },
  { label: "London (BST/GMT)", tz: "Europe/London" },
  { label: "Tokyo (JST)", tz: "Asia/Tokyo" },
  { label: "Mumbai (IST)", tz: "Asia/Kolkata" },
];

function formatTime(date: Date, tz: string): string {
  return date.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDate(date: Date, tz: string): string {
  return date.toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function runDigitalClockDemo(durationMs: number = 4000): Promise<void> {
  console.log("\n═══════════════════════════════════════");
  console.log("  Demo 2: Digital Clock – Multiple Time Zones");
  console.log("═══════════════════════════════════════\n");

  const scope = createScope();

  // Central reactive signal: current timestamp.
  const now = signal(new Date());

  // One derived signal per time zone (pure – no side effects).
  const clocks = TIME_ZONES.map(({ label, tz }) => ({
    label,
    tz,
    time: derived(() => formatTime(now.get(), tz)),
    date: derived(() => formatDate(now.get(), tz)),
  }));

  // Effect: render the clock display whenever `now` changes.
  createEffect(scope, () => {
    // Reading `now` registers it as a dependency.
    now.get();

    console.log(`\n┌─── Digital Clock ─────────────────────┐`);
    for (const { label, time, date } of clocks) {
      // .get() inside an effect is safe and tracks dependencies transitively.
      console.log(`│  ${label.padEnd(18)} ${time.get()}   ${date.get()}`);
    }
    console.log(`└────────────────────────────────────────┘`);
  });

  // onMount: start the ticker after scope is initialised.
  return new Promise((resolve) => {
    onMount(scope, () => {
      const ticker = setInterval(() => {
        // transaction() batches the single set but makes the API uniform.
        transaction(() => {
          now.set(new Date());
        });
      }, 1000);

      onCleanup(scope, () => {
        clearInterval(ticker);
        log("clock", "ticker stopped – scope disposed");
      });

      // Auto-stop after `durationMs` to keep the demo finite.
      setTimeout(() => {
        disposeScope(scope);
        resolve();
      }, durationMs);
    });
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  runCounterDemo();
  await runDigitalClockDemo(4000);
  console.log("\n✓ All demos finished.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
