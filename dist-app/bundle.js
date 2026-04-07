"use strict";
(() => {
  // runtime.ts
  var currentTracker = null;
  var inTransaction = false;
  var computingDerived = false;
  var dirtySignals = /* @__PURE__ */ new Set();
  var pendingEffects = /* @__PURE__ */ new Set();
  var PureRenderViolationError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "PureRenderViolationError";
    }
  };
  var CircularDependencyError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "CircularDependencyError";
    }
  };
  var Signal = class {
    constructor(initialValue) {
      this._subscribers = /* @__PURE__ */ new Set();
      this._value = initialValue;
    }
    get() {
      if (currentTracker !== null) {
        this._subscribers.add(currentTracker);
        currentTracker["_dependencies"].add(this);
      }
      return this._value;
    }
    set(value) {
      if (computingDerived) {
        throw new PureRenderViolationError(
          "signal.set() was called while derived values are being computed. Component render functions must be pure \u2013 move mutations into createEffect or transaction()."
        );
      }
      if (this._value === value) return;
      if (inTransaction) {
        this._value = value;
        dirtySignals.add(this);
      } else {
        transaction(() => {
          this._value = value;
          dirtySignals.add(this);
        });
      }
    }
    /** @internal – notify all subscribers that this signal changed. */
    _notify() {
      for (const sub of this._subscribers) {
        if (sub instanceof Derived) {
          sub._markDirty();
        } else {
          pendingEffects.add(sub);
        }
      }
    }
    /** @internal – remove a subscriber (used during cleanup). */
    _removeSubscriber(sub) {
      this._subscribers.delete(sub);
    }
  };
  function signal(initialValue) {
    return new Signal(initialValue);
  }
  var Derived = class _Derived {
    constructor(computeFn) {
      this._value = void 0;
      this._dirty = true;
      this._computing = false;
      /** @internal */
      this._dependencies = /* @__PURE__ */ new Set();
      this._subscribers = /* @__PURE__ */ new Set();
      this._computeFn = computeFn;
    }
    get() {
      if (currentTracker !== null && currentTracker !== this) {
        this._subscribers.add(currentTracker);
        currentTracker["_dependencies"].add(this);
      }
      if (this._dirty) {
        this._recompute();
      }
      return this._value;
    }
    /** @internal */
    _markDirty() {
      if (this._dirty) return;
      this._dirty = true;
      for (const sub of this._subscribers) {
        if (sub instanceof _Derived) {
          sub._markDirty();
        } else {
          pendingEffects.add(sub);
        }
      }
    }
    _recompute() {
      if (this._computing) {
        throw new CircularDependencyError(
          "Circular dependency detected in derived computation."
        );
      }
      for (const dep of this._dependencies) {
        dep._removeSubscriber(this);
      }
      this._dependencies.clear();
      const previousTracker = currentTracker;
      const previousComputingDerived = computingDerived;
      currentTracker = this;
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
    _removeSubscriber(sub) {
      this._subscribers.delete(sub);
    }
  };
  function derived(computeFn) {
    return new Derived(computeFn);
  }
  function transaction(fn) {
    if (inTransaction) {
      return fn();
    }
    inTransaction = true;
    let result;
    try {
      result = fn();
    } finally {
      inTransaction = false;
      _commit();
    }
    return result;
  }
  function _commit() {
    for (const sig of dirtySignals) {
      sig._notify();
    }
    dirtySignals.clear();
    const effectsToRun = Array.from(pendingEffects);
    pendingEffects.clear();
    for (const effect of effectsToRun) {
      effect._run();
    }
  }
  var _scopeCounter = 0;
  function createScope() {
    return {
      id: `scope_${++_scopeCounter}`,
      _cleanups: [],
      _effects: [],
      _mounted: false,
      _mountCallbacks: []
    };
  }
  function disposeScope(scope) {
    for (const effect of scope._effects) {
      effect._dispose();
    }
    scope._effects.length = 0;
    for (let i = scope._cleanups.length - 1; i >= 0; i--) {
      scope._cleanups[i]();
    }
    scope._cleanups.length = 0;
    scope._mountCallbacks.length = 0;
  }
  var Effect = class {
    constructor(scope, fn) {
      this._cleanup = void 0;
      /** @internal */
      this._dependencies = /* @__PURE__ */ new Set();
      this._fn = fn;
      this._scope = scope;
      scope._effects.push(this);
      this._run();
    }
    /** @internal – re-run the effect. */
    _run() {
      if (typeof this._cleanup === "function") {
        this._cleanup();
        this._cleanup = void 0;
      }
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
    _dispose() {
      if (typeof this._cleanup === "function") {
        this._cleanup();
        this._cleanup = void 0;
      }
      for (const dep of this._dependencies) {
        dep._removeSubscriber(this);
      }
      this._dependencies.clear();
    }
  };
  function createEffect(scope, fn) {
    new Effect(scope, fn);
  }
  function onCleanup(scope, fn) {
    scope._cleanups.push(fn);
  }

  // dom.ts
  var _scopeStack = [];
  function getCurrentScope() {
    if (_scopeStack.length === 0) {
      throw new Error(
        "[unact] No active render scope. Make sure you call h() / JSX only inside a render() call or a reactive child function."
      );
    }
    return _scopeStack[_scopeStack.length - 1];
  }
  function _withScope(scope, fn) {
    _scopeStack.push(scope);
    try {
      return fn();
    } finally {
      _scopeStack.pop();
    }
  }
  function _resolve(value) {
    if (value instanceof Signal || value instanceof Derived) return value.get();
    if (typeof value === "function") return value();
    return value;
  }
  function _isReactive(value) {
    return typeof value === "function" || value instanceof Signal || value instanceof Derived;
  }
  function h(tag, props, ...children) {
    const scope = getCurrentScope();
    if (typeof tag === "function") {
      const result = _withScope(
        scope,
        () => tag({ ...props ?? {}, children: children.flat() })
      );
      if (Array.isArray(result)) return _toFragment(result, scope);
      return result;
    }
    const el = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        _applyProp(el, key, value, scope);
      }
    }
    for (const child of children.flat(Infinity)) {
      _mountChild(el, child, scope);
    }
    return el;
  }
  function _toFragment(children, scope) {
    const frag = document.createDocumentFragment();
    for (const child of children.flat(Infinity)) {
      _mountChild(frag, child, scope);
    }
    return frag;
  }
  function _applyProp(el, key, value, scope) {
    if (key === "children") return;
    if (key === "ref") {
      if (typeof value === "function") value(el);
      return;
    }
    if (key.startsWith("on") && typeof value === "function") {
      const event = key.slice(2).toLowerCase();
      el.addEventListener(event, value);
      onCleanup(
        scope,
        () => el.removeEventListener(event, value)
      );
      return;
    }
    const commit = () => {
      const v = _resolve(value);
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
  function _setProp(el, key, v) {
    if (key === "class" || key === "className") {
      el.className = v == null ? "" : String(v);
      return;
    }
    if (key === "style" && typeof v === "object" && v !== null) {
      Object.assign(el.style, v);
      return;
    }
    if (key === "style" && typeof v === "string") {
      el.style.cssText = v;
      return;
    }
    if (key in el) {
      el[key] = v;
      return;
    }
    if (v === null || v === false || v === void 0) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, String(v));
    }
  }
  function _mountChild(parent, child, scope) {
    if (child === null || child === void 0 || child === false) return;
    if (child instanceof Node) {
      parent.appendChild(child);
      return;
    }
    if (Array.isArray(child)) {
      for (const c of child) _mountChild(parent, c, scope);
      return;
    }
    if (_isReactive(child)) {
      _mountReactiveChild(parent, child, scope);
      return;
    }
    parent.appendChild(document.createTextNode(String(child)));
  }
  function _mountReactiveChild(parent, accessor, scope) {
    const anchor = document.createComment("unact");
    parent.appendChild(anchor);
    let liveNodes = [];
    let childScope = null;
    createEffect(scope, () => {
      if (childScope) {
        disposeScope(childScope);
        childScope = null;
      }
      for (const n of liveNodes) {
        n.parentNode?.removeChild(n);
      }
      liveNodes = [];
      childScope = createScope();
      let value;
      _scopeStack.push(childScope);
      try {
        value = accessor instanceof Signal || accessor instanceof Derived ? accessor.get() : accessor();
      } finally {
        _scopeStack.pop();
      }
      const newNodes = _childToNodes(value, childScope);
      const anchorParent = anchor.parentNode;
      for (const n of newNodes) {
        anchorParent.insertBefore(n, anchor);
        liveNodes.push(n);
      }
      return () => {
        if (childScope) {
          disposeScope(childScope);
          childScope = null;
        }
      };
    });
  }
  function _childToNodes(child, scope) {
    if (child === null || child === void 0 || child === false) {
      return [];
    }
    if (child instanceof Node) return [child];
    if (Array.isArray(child)) {
      return child.flatMap((c) => _childToNodes(c, scope));
    }
    if (typeof child === "function" || child instanceof Signal || child instanceof Derived) {
      const frag = document.createDocumentFragment();
      _mountReactiveChild(frag, child, scope);
      return Array.from(frag.childNodes);
    }
    return [document.createTextNode(String(child))];
  }
  function render(app, container) {
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

  // examples/pokedex/App.tsx
  var POKE_COUNT = 151;
  async function fetchPokedex() {
    const listRes = await fetch(
      `https://pokeapi.co/api/v2/pokemon?limit=${POKE_COUNT}`
    );
    if (!listRes.ok) throw new Error(`PokeAPI list failed: ${listRes.status}`);
    const list = await listRes.json();
    const details = await Promise.all(
      list.results.map((p) => fetch(p.url).then((r) => r.json()))
    );
    return details;
  }
  var TYPE_COLORS = {
    normal: "#A8A878",
    fire: "#F08030",
    water: "#6890F0",
    electric: "#F8D030",
    grass: "#78C850",
    ice: "#98D8D8",
    fighting: "#C03028",
    poison: "#A040A0",
    ground: "#E0C068",
    flying: "#A890F0",
    psychic: "#F85888",
    bug: "#A8B820",
    rock: "#B8A038",
    ghost: "#705898",
    dragon: "#7038F8",
    dark: "#705848",
    steel: "#B8B8D0",
    fairy: "#EE99AC"
  };
  function PokemonCard({ pokemon }) {
    const artwork = pokemon.sprites.other["official-artwork"].front_default || pokemon.sprites.front_default;
    const id = String(pokemon.id).padStart(3, "0");
    return /* @__PURE__ */ h("div", { class: "pokemon-card" }, /* @__PURE__ */ h("div", { class: "pokemon-image-wrapper" }, /* @__PURE__ */ h(
      "img",
      {
        class: "pokemon-image",
        src: artwork,
        alt: pokemon.name,
        loading: "lazy"
      }
    )), /* @__PURE__ */ h("div", { class: "pokemon-info" }, /* @__PURE__ */ h("span", { class: "pokemon-number" }, "#", id), /* @__PURE__ */ h("h3", { class: "pokemon-name" }, pokemon.name), /* @__PURE__ */ h("div", { class: "pokemon-types" }, pokemon.types.map(({ type }) => /* @__PURE__ */ h(
      "span",
      {
        class: "type-badge",
        style: { backgroundColor: TYPE_COLORS[type.name] ?? "#777" }
      },
      type.name
    )))));
  }
  function SearchBar({
    onSearch
  }) {
    return /* @__PURE__ */ h("div", { class: "search-wrapper" }, /* @__PURE__ */ h("span", { class: "search-icon" }, "\u{1F50D}"), /* @__PURE__ */ h(
      "input",
      {
        class: "search-input",
        type: "text",
        placeholder: "Search by name or number\u2026",
        onInput: (e) => onSearch(e.target.value)
      }
    ));
  }
  function LoadingSpinner() {
    return /* @__PURE__ */ h("div", { class: "loading-screen" }, /* @__PURE__ */ h("div", { class: "pokeball-spinner" }, /* @__PURE__ */ h("div", { class: "pokeball-top" }), /* @__PURE__ */ h("div", { class: "pokeball-middle" }), /* @__PURE__ */ h("div", { class: "pokeball-bottom" })), /* @__PURE__ */ h("p", { class: "loading-text" }, "Loading Pok\xE9dex\u2026"));
  }
  function ErrorScreen({
    message
  }) {
    return /* @__PURE__ */ h("div", { class: "error-screen" }, /* @__PURE__ */ h("span", { class: "error-icon" }, "\u26A0\uFE0F"), /* @__PURE__ */ h("p", { class: "error-message" }, message), /* @__PURE__ */ h("p", { class: "error-hint" }, "Make sure you have an internet connection and try refreshing."));
  }
  function EmptyState({ query }) {
    return /* @__PURE__ */ h("div", { class: "empty-state" }, /* @__PURE__ */ h("span", { class: "empty-icon" }, "\u{1F615}"), /* @__PURE__ */ h("p", null, "No Pok\xE9mon found for ", /* @__PURE__ */ h("strong", null, '"', query, '"')));
  }
  function App() {
    const query = signal("");
    const pokemonList = signal([]);
    const loading = signal(true);
    const errorMsg = signal(null);
    const filtered = derived(() => {
      const q = query.get().toLowerCase().trim();
      if (q === "") return pokemonList.get();
      return pokemonList.get().filter(
        (p) => p.name.toLowerCase().includes(q) || String(p.id).includes(q)
      );
    });
    fetchPokedex().then((data) => {
      pokemonList.set(data);
      loading.set(false);
    }).catch((err) => {
      errorMsg.set(err instanceof Error ? err.message : String(err));
      loading.set(false);
    });
    return /* @__PURE__ */ h("div", { id: "app" }, /* @__PURE__ */ h("header", { class: "app-header" }, /* @__PURE__ */ h("div", { class: "header-inner" }, /* @__PURE__ */ h("div", { class: "logo" }, /* @__PURE__ */ h("span", { class: "logo-icon" }, "\u26A1"), /* @__PURE__ */ h("h1", { class: "logo-text" }, "Unact Pok\xE9dex")), /* @__PURE__ */ h(SearchBar, { onSearch: (q) => query.set(q) }))), /* @__PURE__ */ h("main", { class: "app-main" }, () => {
      if (loading.get()) {
        return /* @__PURE__ */ h(LoadingSpinner, null);
      }
      if (errorMsg.get()) {
        return /* @__PURE__ */ h(ErrorScreen, { message: errorMsg.get() });
      }
      const list = filtered.get();
      return /* @__PURE__ */ h("div", null, /* @__PURE__ */ h("p", { class: "result-count" }, () => `Showing ${filtered.get().length} of ${pokemonList.get().length} Pok\xE9mon`), () => list.length === 0 ? /* @__PURE__ */ h(EmptyState, { query: query.get() }) : null, list.length > 0 && /* @__PURE__ */ h("div", { class: "pokemon-grid" }, list.map((p) => /* @__PURE__ */ h(PokemonCard, { pokemon: p }))));
    }), /* @__PURE__ */ h("footer", { class: "app-footer" }, /* @__PURE__ */ h("p", null, "Built with", " ", /* @__PURE__ */ h("a", { href: "https://github.com/raxraj/unact", target: "_blank", rel: "noopener" }, "Unact"), " ", "\xB7 Data from", " ", /* @__PURE__ */ h("a", { href: "https://pokeapi.co", target: "_blank", rel: "noopener" }, "Pok\xE9API"))));
  }

  // examples/pokedex/main.tsx
  var root = document.getElementById("root");
  if (!root) throw new Error("#root element not found");
  render(() => /* @__PURE__ */ h(App, null), root);
})();
