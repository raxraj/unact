# Unact

> A deterministic, signal-based UI runtime — no VDOM, no hidden re-renders, no lifecycle surprises.

Unact is a minimal TypeScript runtime that solves the two biggest daily pain points in frontend development:

| Problem | How Unact fixes it |
|---|---|
| **Unpredictable lifecycles** | Explicit scope model — every effect/resource is tied to a scope; setup and teardown are deterministic and auditable |
| **Messy state management** | Fine-grained signals + a transactional commit model — state flows are explicit, updates are batched, effects run in a stable order |

---

## Motivation

React (and most VDOM-based frameworks) suffer from:

- **Implicit lifecycle magic** — `useEffect` dependency arrays, stale closures, and surprise re-renders.
- **Cascading state mutations** — `setState` calls can chain and produce intermediate renders.
- **Non-deterministic ordering** — effects run in an order that is hard to reason about across concurrent features.
- **No built-in mutation guard** — nothing prevents you from mutating state inside a render function.

Unact eliminates these problems by design:

1. **Pure render rule** — render/derived functions are statically (or runtime) guarded against mutations.
2. **Fine-grained signals** — only the exact DOM nodes / effects that depend on a changed signal are updated.
3. **Transactional commit model** — all mutations inside `transaction()` are batched; effects run *once* after the commit, in registration order.
4. **Explicit scope** — every effect and resource belongs to a scope. Cleanup is deterministic (LIFO) and cannot be forgotten.

---

## Installation

```bash
npm install          # install dev deps (TypeScript, ts-node, esbuild)
npm test             # run unit tests
npm run dev          # run counter + digital-clock demo (Node / terminal)
npm run serve        # start the Pokédex UI example on http://localhost:3000
npm run build        # compile Node demos to dist/
npm run build:app    # bundle browser app to dist-app/bundle.js
```

No runtime third-party dependencies are required.

---

## API Reference

### `signal<T>(initialValue: T): Signal<T>`

A primitive reactive state holder.

```ts
import { signal } from "./runtime";

const count = signal(0);
count.get();        // → 0
count.set(1);       // notifies subscribers
count.get();        // → 1
```

**Invariants**:
- `set()` with the same value is a no-op.
- `set()` called inside a `derived` computation throws `PureRenderViolationError`.
- `set()` outside a `transaction()` is wrapped in an implicit single-signal transaction.

---

### `derived<T>(computeFn: () => T): Derived<T>`

A lazily-evaluated computed value. Dependencies are tracked automatically on first `get()`.

```ts
import { signal, derived } from "./runtime";

const count  = signal(3);
const double = derived(() => count.get() * 2);

double.get(); // → 6
count.set(5);
double.get(); // → 10  (recomputed lazily)
```

**Invariants**:
- Circular dependencies throw `CircularDependencyError` immediately.
- Calling `signal.set()` inside a derived computation throws `PureRenderViolationError`.

---

### `transaction(fn: () => T): T`

Batches multiple signal mutations into a single deterministic commit.

```ts
import { signal, transaction } from "./runtime";

transaction(() => {
  x.set(1);
  y.set(2);
});
// effects that depend on x or y run ONCE, after both are updated
```

**Commit order** (fixed and reproducible):
1. Apply all dirty signal values.
2. Notify derived subscribers — mark dependent deriveds dirty.
3. Schedule pending effects.
4. Run effects in **registration order**.

---

### `createScope(): Scope`

Creates an isolated lifecycle scope that owns effects and cleanup callbacks.

```ts
import { createScope, disposeScope } from "./runtime";

const scope = createScope();
// ... register effects and cleanups ...
disposeScope(scope); // runs all cleanups in LIFO order
```

---

### `createEffect(scope, fn): void`

Registers a reactive side-effect. Runs immediately to collect dependencies, then re-runs whenever any dependency changes. Optionally returns a cleanup function.

```ts
import { signal, createScope, createEffect, disposeScope } from "./runtime";

const scope = createScope();
const name  = signal("Alice");

createEffect(scope, () => {
  console.log("Hello,", name.get());
  return () => console.log("cleanup before re-run");
});

name.set("Bob");
// logs: cleanup before re-run
// logs: Hello, Bob

disposeScope(scope);
// logs: cleanup before re-run
```

---

### `onMount(scope, fn): void`

Runs `fn` once after the scope is first committed (asynchronously, via microtask). Ideal for starting timers or subscribing to external sources.

```ts
import { createScope, onMount, onCleanup } from "./runtime";

const scope = createScope();

onMount(scope, () => {
  const id = setInterval(() => console.log("tick"), 1000);
  onCleanup(scope, () => clearInterval(id));
});
```

---

### `onCleanup(scope, fn): void`

Registers a teardown callback on the scope. All cleanups run in **LIFO** (last-in, first-out) order when `disposeScope(scope)` is called.

---

### `disposeScope(scope): void`

Disposes the scope: unsubscribes all effects from their dependencies and runs cleanup callbacks in LIFO order.

---

## Example 1 — Counter

```ts
import {
  signal, derived, transaction,
  createScope, createEffect, disposeScope,
} from "./runtime";

const scope  = createScope();
const count  = signal(0);
const double = derived(() => count.get() * 2);

createEffect(scope, () => {
  console.log(`count=${count.get()}, double=${double.get()}`);
  return () => console.log("cleanup");
});
// → count=0, double=0

count.set(3);
// → cleanup
// → count=3, double=6

transaction(() => {
  count.set(10);
  count.set(20); // intermediate value never observed by effects
});
// → cleanup
// → count=20, double=40

disposeScope(scope); // → cleanup
```

---

## Example 2 — Digital Clock in Multiple Time Zones

```ts
import {
  signal, derived, transaction,
  createScope, createEffect, onMount, onCleanup, disposeScope,
} from "./runtime";

const scope = createScope();
const now   = signal(new Date());

const zones = [
  { label: "UTC",      tz: "UTC" },
  { label: "New York", tz: "America/New_York" },
  { label: "Tokyo",    tz: "Asia/Tokyo" },
];

const clocks = zones.map(({ label, tz }) => ({
  label,
  time: derived(() =>
    now.get().toLocaleTimeString("en-US", { timeZone: tz, hour12: false })
  ),
}));

// Effect re-runs every time `now` changes.
createEffect(scope, () => {
  now.get(); // register dependency
  for (const { label, time } of clocks) {
    console.log(`${label}: ${time.get()}`);
  }
});

onMount(scope, () => {
  const ticker = setInterval(() => {
    transaction(() => now.set(new Date()));
  }, 1000);
  onCleanup(scope, () => clearInterval(ticker));
});

// Stop after 5 seconds.
setTimeout(() => disposeScope(scope), 5000);
```

Run it:

```
npm run dev
```

Sample output:

```
┌─── Digital Clock ─────────────────────┐
│  UTC                21:20:13   Mon, Apr 6, 2026
│  New York (ET)      17:20:13   Mon, Apr 6, 2026
│  London (BST/GMT)   22:20:13   Mon, Apr 6, 2026
│  Tokyo (JST)        06:20:13   Tue, Apr 7, 2026
│  Mumbai (IST)       02:50:13   Tue, Apr 7, 2026
└────────────────────────────────────────┘
```

---

## Determinism guarantees

| Guarantee | Mechanism |
|---|---|
| Effects never see intermediate state | `transaction()` defers notifications until `endTransaction()` |
| Effect order is stable | Effects run in **registration order** (insertion-ordered `Set`) |
| Cleanup order is stable | LIFO (stack) — registered last, cleaned up first |
| No mutation in render | `PureRenderViolationError` thrown if `signal.set()` is called during derived computation |
| Circular dependencies detected | `CircularDependencyError` thrown immediately on first `get()` |

---

## Running the tests

```bash
npm test
```

Expected output:

```
── 1. Signal ──
  ✓ signal initialises with the provided value
  ✓ signal.set() updates the value
  ✓ signal.set() with same value is a no-op (effect should not re-run)

── 2. Derived ──
  ✓ derived computes from signal
  ✓ derived updates when dependency changes
  ✓ derived chains work correctly

── 3. Transaction ──
  ✓ transaction batches effects into a single run
  ✓ nested transaction delegates to outer commit

── 4. Deterministic effect order ──
  ✓ effects run in registration order after commit

── 5. Scope and cleanup ──
  ✓ disposeScope runs cleanups in LIFO order
  ✓ effect cleanup runs before re-execution
  ✓ disposeScope stops effect from reacting to further changes

── 6. Pure-render enforcement ──
  ✓ derived computation throws PureRenderViolationError on signal.set()

── 7. Circular dependency detection ──
  ✓ CircularDependencyError is thrown for circular derived chain

── 8. onMount / onCleanup lifecycle ──
  ✓ onMount runs asynchronously after scope creation

══ Test Results: 15 passed, 0 failed ══
```

---

## Extensibility

| Feature | How to add |
|---|---|
| **DOM rendering** | ✅ Implemented in `dom.ts` — `render()`, `h()`, `Fragment`, reactive props/children |
| **Async resources** | Add `createResource(scope, asyncFn)` returning a `{ data, loading, error }` signal-set; integrate with `transaction()` on resolve |
| **SSR / resumability** | Serialize signal values to JSON; on the client, hydrate by calling `signal(deserializedValue)` instead of the default |
| **Compiler / pure-render lint** | Write a TypeScript ESLint rule that flags `signal.set()` calls inside functions decorated with `@pure` or returned from component functions |
| **Dev visualizer** | Hook into `_commit()` to emit a structured trace (signal → derived → effect) readable by a DevTools panel |
| **Priorities / scheduling** | Replace the synchronous `_commit()` with a scheduler that respects `requestIdleCallback` / `MessageChannel` and priority levels |

---

## DOM layer & JSX syntax

`dom.ts` adds a reactive DOM renderer on top of the core runtime. Configure your
`tsconfig.json` with `"jsxFactory": "h"` and `"jsxFragmentFactory": "Fragment"`
(see `tsconfig.app.json`) and you can write idiomatic JSX/TSX:

```tsx
/** @jsx h */
import { h, render } from "./dom";
import { signal, derived } from "./runtime";

function Counter() {
  const count  = signal(0);
  const double = derived(() => count.get() * 2);

  return (
    <div>
      {/* Reactive text: wrap in () => to re-evaluate on signal change */}
      <p>Count: {() => count.get()} — Double: {() => double.get()}</p>
      <button onClick={() => count.set(count.get() + 1)}>Increment</button>
    </div>
  );
}

render(() => <Counter />, document.getElementById("root")!);
```

### Reactivity conventions

| Child / prop value | Behaviour |
|---|---|
| `"static string"` or `42` | Static – never updates |
| `() => signal.get()` | **Reactive** – updates the DOM node whenever the signal changes |
| `signal` / `derived` instance | **Reactive** – shorthand for `() => signal.get()` |
| `onClick`, `onInput`, … | Attached with `addEventListener`; cleaned up when the scope is disposed |
| `ref={(el) => …}` | Callback ref – called once with the real DOM element after creation |

### Component functions

A component is any function that accepts a `props` object and returns a `Node`:

```tsx
function Badge({ label, color }: { label: string; color: string }) {
  return <span style={{ backgroundColor: color }}>{label}</span>;
}

// Use it in JSX like any other element:
<Badge label="fire" color="#F08030" />
```

---

## Pokédex example

A real-world UI example lives in `examples/pokedex/`. It demonstrates:

- **JSX components** with typed props
- **`signal`** for search query, loading, and error state
- **`derived`** for a filtered Pokémon list that updates automatically as you type
- **Async data fetching** integrated through signals (no framework magic needed)
- **Reactive conditional rendering** — loading → error → grid

```bash
npm run serve    # → http://localhost:3000
```

---

## File structure

```
unact/
├── runtime.ts              – core primitives (signal, derived, transaction, scope)
├── dom.ts                  – reactive DOM renderer + JSX factory (h / Fragment / render)
├── jsx.d.ts                – TypeScript JSX namespace declarations
├── index.ts                – Node demos (Counter + Digital Clock)
├── test.ts                 – self-contained unit tests (no test runner required)
├── server.ts               – esbuild-powered dev server
├── tsconfig.json           – Node build config
├── tsconfig.app.json       – browser build config (DOM lib + JSX)
├── examples/
│   └── pokedex/
│       ├── App.tsx         – Pokédex application component
│       ├── main.tsx        – browser entry point
│       ├── index.html      – HTML shell
│       └── styles.css      – Pokédex styles
└── package.json
```

---

## License

MIT