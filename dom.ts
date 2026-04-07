/**
 * dom.ts – Unact DOM renderer
 *
 * Provides:
 *   h(tag, props, ...children)  – JSX factory (configure via jsxFactory: "h")
 *   Fragment(props)             – JSX fragment factory
 *   render(fn, container)       – mount an app into a DOM container
 *
 * Reactive conventions:
 *   • A prop value that is a function `() => T` is reactive — it re-runs inside
 *     a `createEffect` so the attribute/property updates whenever signals change.
 *   • A child that is a function `() => T` is reactive — the returned string,
 *     number, or Node replaces the previous output on every signal commit.
 *   • Signal / Derived instances used directly as props or children are also
 *     reactive; they are treated as `() => signal.get()`.
 *
 * Scope model:
 *   `render()` creates a root Scope and pushes it onto an internal stack.
 *   All `h()` calls made during initial render (and during re-renders of reactive
 *   children) automatically inherit this scope. No explicit scope wiring is needed
 *   inside component functions.
 */

import {
  Signal,
  Derived,
  createScope,
  createEffect,
  disposeScope,
  onCleanup,
  Scope,
} from "./runtime";

// ─── Scope stack ──────────────────────────────────────────────────────────────

const _scopeStack: Scope[] = [];

/** Returns the innermost active rendering scope. */
export function getCurrentScope(): Scope {
  if (_scopeStack.length === 0) {
    throw new Error(
      "[unact] No active render scope. Make sure you call h() / JSX only " +
        "inside a render() call or a reactive child function."
    );
  }
  return _scopeStack[_scopeStack.length - 1];
}

function _withScope<T>(scope: Scope, fn: () => T): T {
  _scopeStack.push(scope);
  try {
    return fn();
  } finally {
    _scopeStack.pop();
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Reactive<T> = T | (() => T) | Signal<T> | Derived<T>;

export type Child =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | (() => Child | Child[])
  | Signal<unknown>
  | Derived<unknown>
  | Child[];

export type Props = Record<string, unknown> & { children?: Child | Child[] };

export type ComponentFn = (props: Props) => Node | Node[];

// ─── Resolve a reactive value ────────────────────────────────────────────────

function _resolve<T>(value: Reactive<T>): T {
  if (value instanceof Signal || value instanceof Derived) return value.get();
  if (typeof value === "function") return (value as () => T)();
  return value;
}

function _isReactive(value: unknown): boolean {
  return (
    typeof value === "function" ||
    value instanceof Signal ||
    value instanceof Derived
  );
}

// ─── JSX factory ─────────────────────────────────────────────────────────────

/**
 * JSX factory function. TypeScript will call this for every `<Tag ...>` expression
 * when you set `"jsxFactory": "h"` in tsconfig.
 *
 * @example (via JSX)
 * // <div class="card">{() => count.get()}</div>
 * h("div", { class: "card" }, () => count.get())
 */
export function h(
  tag: string | ComponentFn,
  props: Props | null,
  ...children: Child[]
): Node {
  const scope = getCurrentScope();

  // ── Component function ────────────────────────────────────────────────────
  if (typeof tag === "function") {
    const result = _withScope(scope, () =>
      tag({ ...(props ?? {}), children: children.flat() })
    );
    if (Array.isArray(result)) return _toFragment(result, scope);
    return result;
  }

  // ── Intrinsic element ─────────────────────────────────────────────────────
  const el = document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      _applyProp(el, key, value, scope);
    }
  }

  for (const child of children.flat(Infinity) as Child[]) {
    _mountChild(el, child, scope);
  }

  return el;
}

/**
 * JSX fragment factory. TypeScript calls this for `<>...</>` when you set
 * `"jsxFragmentFactory": "Fragment"` in tsconfig.
 *
 * @example (via JSX)
 * // <><p>a</p><p>b</p></>
 * Fragment({ children: [h("p", null, "a"), h("p", null, "b")] })
 */
export function Fragment(props: { children?: Child | Child[] }): Node {
  const scope = getCurrentScope();
  const children = props.children ?? [];
  return _toFragment(
    Array.isArray(children) ? children : [children],
    scope
  );
}

function _toFragment(children: Child[], scope: Scope): Node {
  const frag = document.createDocumentFragment();
  for (const child of children.flat(Infinity) as Child[]) {
    _mountChild(frag, child, scope);
  }
  return frag;
}

// ─── Prop handling ────────────────────────────────────────────────────────────

function _applyProp(
  el: Element,
  key: string,
  value: unknown,
  scope: Scope
): void {
  // Skip internal JSX keys
  if (key === "children") return;

  // ref callback
  if (key === "ref") {
    if (typeof value === "function") (value as (el: Element) => void)(el);
    return;
  }

  // Event handlers: onClick → "click", onInput → "input", …
  if (key.startsWith("on") && typeof value === "function") {
    const event = key.slice(2).toLowerCase();
    el.addEventListener(event, value as EventListener);
    onCleanup(scope, () =>
      el.removeEventListener(event, value as EventListener)
    );
    return;
  }

  const commit = () => {
    const v = _resolve(value as Reactive<unknown>);
    _setProp(el, key, v);
  };

  if (_isReactive(value)) {
    createEffect(scope, () => {
      commit();
    });
  } else {
    commit();
  }
}

function _setProp(el: Element, key: string, v: unknown): void {
  if (key === "class" || key === "className") {
    el.className = v == null ? "" : String(v);
    return;
  }
  if (key === "style" && typeof v === "object" && v !== null) {
    Object.assign((el as HTMLElement).style, v);
    return;
  }
  if (key === "style" && typeof v === "string") {
    (el as HTMLElement).style.cssText = v;
    return;
  }
  // DOM property (value, checked, disabled, …)
  if (key in el) {
    (el as Record<string, unknown>)[key] = v;
    return;
  }
  // Attribute fallback
  if (v === null || v === false || v === undefined) {
    el.removeAttribute(key);
  } else {
    el.setAttribute(key, String(v));
  }
}

// ─── Child mounting ───────────────────────────────────────────────────────────

function _mountChild(parent: Node, child: Child, scope: Scope): void {
  if (child === null || child === undefined || child === false) return;

  if (child instanceof Node) {
    parent.appendChild(child);
    return;
  }

  if (Array.isArray(child)) {
    for (const c of child as Child[]) _mountChild(parent, c, scope);
    return;
  }

  // Reactive child: function or signal/derived
  if (_isReactive(child)) {
    _mountReactiveChild(parent, child as () => Child, scope);
    return;
  }

  // Static text
  parent.appendChild(document.createTextNode(String(child)));
}

/**
 * Mount a reactive child.  Uses a sentinel comment node as an anchor so we
 * can replace the child's DOM nodes in place when the reactive value changes.
 */
function _mountReactiveChild(
  parent: Node,
  accessor: (() => Child) | Signal<unknown> | Derived<unknown>,
  scope: Scope
): void {
  const anchor = document.createComment("unact");
  parent.appendChild(anchor);

  // Nodes currently occupying the slot (start empty; effect fills them).
  let liveNodes: Node[] = [];
  // Each re-render of a reactive child gets its own child scope so that any
  // h() calls inside the accessor (e.g. JSX inside a reactive function)
  // clean up their effects on the next re-render.
  let childScope: Scope | null = null;

  createEffect(scope, () => {
    // Dispose the previous child scope (cleans up nested effects).
    if (childScope) {
      disposeScope(childScope);
      childScope = null;
    }

    // Remove old nodes from DOM.
    for (const n of liveNodes) {
      n.parentNode?.removeChild(n);
    }
    liveNodes = [];

    // Create a fresh scope for this render pass.
    childScope = createScope();

    // Evaluate the accessor inside the new child scope.
    let value: Child;
    _scopeStack.push(childScope);
    try {
      value =
        accessor instanceof Signal || accessor instanceof Derived
          ? (accessor.get() as Child)
          : (accessor as () => Child)();
    } finally {
      _scopeStack.pop();
    }

    // Convert the returned value to a list of DOM nodes.
    const newNodes = _childToNodes(value, childScope);
    const anchorParent = anchor.parentNode!;
    for (const n of newNodes) {
      anchorParent.insertBefore(n, anchor);
      liveNodes.push(n);
    }

    // Return cleanup to dispose child scope before the next run.
    return () => {
      if (childScope) {
        disposeScope(childScope);
        childScope = null;
      }
    };
  });
}

/** Recursively convert a child value to an array of DOM nodes. */
function _childToNodes(child: Child, scope: Scope): Node[] {
  if (child === null || child === undefined || child === false) {
    return [];
  }
  if (child instanceof Node) return [child];
  if (Array.isArray(child)) {
    return (child as Child[]).flatMap((c) => _childToNodes(c, scope));
  }
  if (
    typeof child === "function" ||
    child instanceof Signal ||
    child instanceof Derived
  ) {
    // Nested reactive: mount into a temporary fragment and collect nodes.
    const frag = document.createDocumentFragment();
    _mountReactiveChild(frag, child as (() => Child), scope);
    return Array.from(frag.childNodes);
  }
  return [document.createTextNode(String(child))];
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Mount an Unact application into a DOM container.
 *
 * @param app       A zero-argument function returning the root Node (usually JSX).
 * @param container The DOM element to mount into (its existing children are cleared).
 * @returns         A disposal function — call it to unmount and clean up.
 *
 * @example
 * import { render } from "./dom";
 * import App from "./App";
 *
 * const dispose = render(() => <App />, document.getElementById("root")!);
 */
export function render(app: () => Node, container: Element): () => void {
  container.innerHTML = "";
  const scope = createScope();
  _withScope(scope, () => {
    const node = app();
    container.appendChild(node);
  });
  return () => {
    disposeScope(scope);
    container.innerHTML = "";
  };
}
