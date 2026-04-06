/**
 * runtime.ts – Unact core runtime
 *
 * Primitives:
 *   signal   – reactive state holder
 *   derived  – computed value with auto-tracked dependencies
 *   transaction – batches multiple signal mutations into one deterministic commit
 *
 * Scope model:
 *   createScope  – creates an isolated execution scope
 *   createEffect – subscribes a side-effect to reactive dependencies, within a scope
 *   onMount      – runs a callback once after the first commit in which the scope is active
 *   onCleanup    – registers a teardown callback for when the scope is disposed
 *   disposeScope – disposes a scope and runs all its cleanup callbacks in LIFO order
 *
 * Deterministic commit model:
 *   1. All signal.set() calls inside transaction() only mark signals dirty.
 *   2. endTransaction() resolves derived values (topological order), then runs
 *      all pending effects in registration order.
 *   3. Effects never run during render / derived computation – they run after commit.
 *
 * Pure-render enforcement:
 *   Any call to signal.set() while the runtime is in the "computing derived" phase
 *   throws a PureRenderViolationError to catch mutations in render/derived paths.
 */

// ─── Internal state ──────────────────────────────────────────────────────────

/** Currently executing derived/effect tracker (for auto-dependency tracking). */
let currentTracker: Derived<unknown> | Effect | null = null;

/** Whether the runtime is currently inside a transaction. */
let inTransaction = false;

/** Whether derived values are currently being resolved (pure-render guard). */
let computingDerived = false;

/** Signals dirtied in the current transaction. */
const dirtySignals = new Set<Signal<unknown>>();

/** Effects scheduled to run after the current commit. */
const pendingEffects = new Set<Effect>();

// ─── Errors ───────────────────────────────────────────────────────────────────

export class PureRenderViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PureRenderViolationError";
  }
}

export class CircularDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircularDependencyError";
  }
}

// ─── Signal ──────────────────────────────────────────────────────────────────

export interface ReadonlySignal<T> {
  get(): T;
}

export class Signal<T> implements ReadonlySignal<T> {
  private _value: T;
  private _subscribers = new Set<Derived<unknown> | Effect>();

  constructor(initialValue: T) {
    this._value = initialValue;
  }

  get(): T {
    // Register this signal as a dependency of the current tracker.
    if (currentTracker !== null) {
      this._subscribers.add(currentTracker);
      currentTracker["_dependencies"].add(this as Signal<unknown>);
    }
    return this._value;
  }

  set(value: T): void {
    if (computingDerived) {
      throw new PureRenderViolationError(
        "signal.set() was called while derived values are being computed. " +
          "Component render functions must be pure – move mutations into createEffect or transaction()."
      );
    }

    if (this._value === value) return; // No-op if value is unchanged.

    if (inTransaction) {
      // Inside a transaction: mark dirty and defer notification.
      this._value = value;
      dirtySignals.add(this as Signal<unknown>);
    } else {
      // Outside a transaction: wrap in an implicit single-signal transaction.
      transaction(() => {
        this._value = value;
        dirtySignals.add(this as Signal<unknown>);
      });
    }
  }

  /** @internal – notify all subscribers that this signal changed. */
  _notify(): void {
    for (const sub of this._subscribers) {
      if (sub instanceof Derived) {
        sub._markDirty();
      } else {
        pendingEffects.add(sub);
      }
    }
  }

  /** @internal – remove a subscriber (used during cleanup). */
  _removeSubscriber(sub: Derived<unknown> | Effect): void {
    this._subscribers.delete(sub);
  }
}

/**
 * Create a reactive signal with an initial value.
 *
 * @example
 * const count = signal(0);
 * count.set(count.get() + 1);
 */
export function signal<T>(initialValue: T): Signal<T> {
  return new Signal(initialValue);
}

// ─── Derived ─────────────────────────────────────────────────────────────────

export class Derived<T> implements ReadonlySignal<T> {
  private _computeFn: () => T;
  private _value: T | undefined = undefined;
  private _dirty = true;
  private _computing = false;
  /** @internal */ _dependencies = new Set<Signal<unknown>>();
  private _subscribers = new Set<Derived<unknown> | Effect>();

  constructor(computeFn: () => T) {
    this._computeFn = computeFn;
  }

  get(): T {
    // Register this derived as a dependency of any outer tracker.
    if (currentTracker !== null && currentTracker !== this) {
      this._subscribers.add(currentTracker);
      currentTracker["_dependencies"].add(this as unknown as Signal<unknown>);
    }

    if (this._dirty) {
      this._recompute();
    }
    return this._value as T;
  }

  /** @internal */
  _markDirty(): void {
    if (this._dirty) return; // Already dirty – avoid cascading.
    this._dirty = true;
    // Propagate dirtiness to downstream subscribers.
    for (const sub of this._subscribers) {
      if (sub instanceof Derived) {
        sub._markDirty();
      } else {
        pendingEffects.add(sub);
      }
    }
  }

  private _recompute(): void {
    if (this._computing) {
      throw new CircularDependencyError(
        "Circular dependency detected in derived computation."
      );
    }
    // Unsubscribe from old dependencies before re-computing.
    for (const dep of this._dependencies) {
      dep._removeSubscriber(this as unknown as Derived<unknown>);
    }
    this._dependencies.clear();

    const previousTracker = currentTracker;
    const previousComputingDerived = computingDerived;
    currentTracker = this as unknown as Derived<unknown>;
    computingDerived = true;
    this._computing = true;
    try {
      this._value = this._computeFn();
      this._dirty = false;
    } finally {
      this._computing = false;
      computingDerived = previousComputingDerived;
      currentTracker = previousTracker;
    }
  }

  /** @internal – remove a subscriber (used during cleanup). */
  _removeSubscriber(sub: Derived<unknown> | Effect): void {
    this._subscribers.delete(sub);
  }
}

/**
 * Create a derived (computed) value. Dependencies are tracked automatically.
 *
 * @example
 * const double = derived(() => count.get() * 2);
 */
export function derived<T>(computeFn: () => T): Derived<T> {
  return new Derived(computeFn);
}

// ─── Transaction ─────────────────────────────────────────────────────────────

/**
 * Batch multiple signal mutations into a single deterministic commit.
 *
 * Commit order:
 *  1. Notify all dirty-signal subscribers (marks derived values dirty).
 *  2. Re-compute all dirty derived values that have pending effect subscribers.
 *  3. Run all pending effects in registration order.
 *
 * @example
 * transaction(() => {
 *   x.set(1);
 *   y.set(2);
 * }); // effects run once, after both x and y are updated
 */
export function transaction<T>(fn: () => T): T {
  if (inTransaction) {
    // Nested transaction: just run the function; outer transaction handles commit.
    return fn();
  }

  inTransaction = true;
  let result: T;
  try {
    result = fn();
  } finally {
    inTransaction = false;
    _commit();
  }
  return result as T;
}

/** @internal – flush dirty signals and run pending effects. */
function _commit(): void {
  // Phase 1: Notify dirty signals → mark derived values and effects dirty.
  for (const sig of dirtySignals) {
    sig._notify();
  }
  dirtySignals.clear();

  // Phase 2: Run pending effects in registration order (deterministic).
  const effectsToRun = Array.from(pendingEffects);
  pendingEffects.clear();
  for (const effect of effectsToRun) {
    effect._run();
  }
}

// ─── Scope ───────────────────────────────────────────────────────────────────

export interface Scope {
  readonly id: string;
  /** @internal */ _cleanups: Array<() => void>;
  /** @internal */ _effects: Effect[];
  /** @internal */ _mounted: boolean;
  /** @internal */ _mountCallbacks: Array<() => void>;
}

let _scopeCounter = 0;

/**
 * Create an isolated scope that owns effects and cleanup callbacks.
 * Dispose with `disposeScope(scope)` to run cleanups in LIFO order.
 *
 * @example
 * const scope = createScope();
 * createEffect(scope, () => { console.log(count.get()); });
 * disposeScope(scope); // cleans up the effect subscription
 */
export function createScope(): Scope {
  return {
    id: `scope_${++_scopeCounter}`,
    _cleanups: [],
    _effects: [],
    _mounted: false,
    _mountCallbacks: [],
  };
}

/**
 * Dispose a scope: runs all cleanup callbacks in LIFO order and unsubscribes
 * all effects from their reactive dependencies.
 */
export function disposeScope(scope: Scope): void {
  // Dispose all effects.
  for (const effect of scope._effects) {
    effect._dispose();
  }
  scope._effects.length = 0;

  // Run cleanups in LIFO order (reverse registration).
  for (let i = scope._cleanups.length - 1; i >= 0; i--) {
    scope._cleanups[i]();
  }
  scope._cleanups.length = 0;
  scope._mountCallbacks.length = 0;
}

// ─── Effect ───────────────────────────────────────────────────────────────────

/**
 * An effect is a side-effectful function that re-runs whenever its reactive
 * dependencies change. It is tied to a scope and cleaned up when the scope
 * is disposed.
 */
export class Effect {
  private _fn: () => (() => void) | void;
  private _cleanup: (() => void) | void = undefined;
  private _scope: Scope;
  /** @internal */ _dependencies = new Set<Signal<unknown>>();

  constructor(scope: Scope, fn: () => (() => void) | void) {
    this._fn = fn;
    this._scope = scope;
    scope._effects.push(this);
    // Run immediately to collect dependencies.
    this._run();
  }

  /** @internal – re-run the effect. */
  _run(): void {
    // Run the previous cleanup before re-executing.
    if (typeof this._cleanup === "function") {
      this._cleanup();
      this._cleanup = undefined;
    }

    // Unsubscribe from old dependencies.
    for (const dep of this._dependencies) {
      dep._removeSubscriber(this);
    }
    this._dependencies.clear();

    const previousTracker = currentTracker;
    currentTracker = this;
    try {
      this._cleanup = this._fn();
    } finally {
      currentTracker = previousTracker;
    }
  }

  /** @internal – dispose this effect permanently. */
  _dispose(): void {
    if (typeof this._cleanup === "function") {
      this._cleanup();
      this._cleanup = undefined;
    }
    for (const dep of this._dependencies) {
      dep._removeSubscriber(this);
    }
    this._dependencies.clear();
  }
}

/**
 * Create a reactive effect that runs whenever its signal dependencies change.
 * The effect runs immediately on creation to collect dependencies.
 * Optionally return a cleanup function that runs before each re-run and on dispose.
 *
 * @example
 * createEffect(scope, () => {
 *   console.log('count is', count.get());
 *   return () => console.log('cleanup');
 * });
 */
export function createEffect(
  scope: Scope,
  fn: () => (() => void) | void
): void {
  new Effect(scope, fn);
}

/**
 * Register a callback to run once after the scope's first reactive commit.
 * Useful for "after mount" setup (e.g., starting timers).
 *
 * @example
 * onMount(scope, () => {
 *   const id = setInterval(() => count.set(count.get() + 1), 1000);
 *   onCleanup(scope, () => clearInterval(id));
 * });
 */
export function onMount(scope: Scope, fn: () => void): void {
  scope._mountCallbacks.push(fn);
  if (!scope._mounted) {
    scope._mounted = true;
    // Schedule mount callbacks to run after the current synchronous work.
    Promise.resolve().then(() => {
      for (const cb of scope._mountCallbacks) {
        cb();
      }
    });
  }
}

/**
 * Register a cleanup callback on the scope. Runs in LIFO order when
 * `disposeScope(scope)` is called.
 *
 * @example
 * onCleanup(scope, () => clearInterval(timerId));
 */
export function onCleanup(scope: Scope, fn: () => void): void {
  scope._cleanups.push(fn);
}
