/** @jsx h */
/** @jsxFrag Fragment */

/**
 * App.tsx – Pokédex example for Unact
 *
 * Demonstrates:
 *  - JSX syntax (compiled via h / Fragment) alongside Unact signals
 *  - Fine-grained reactive DOM updates (no virtual DOM diff, no full re-render)
 *  - signal / derived / createEffect for state, computed values, and side-effects
 *  - Async data fetching wired through signals (loading / error / data states)
 *  - Reactive search: the grid rerenders only when query or data changes
 */

import { h, Fragment } from "../../dom";
import { signal, derived } from "../../runtime";

// ─── PokeAPI types ────────────────────────────────────────────────────────────

interface PokemonListItem {
  name: string;
  url: string;
}

interface PokemonDetail {
  id: number;
  name: string;
  sprites: {
    front_default: string;
    other: {
      "official-artwork": {
        front_default: string;
      };
    };
  };
  types: Array<{
    type: { name: string };
  }>;
  stats: Array<{
    base_stat: number;
    stat: { name: string };
  }>;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

const POKE_COUNT = 151; // Original 151 Pokémon

async function fetchPokedex(): Promise<PokemonDetail[]> {
  const listRes = await fetch(
    `https://pokeapi.co/api/v2/pokemon?limit=${POKE_COUNT}`
  );
  if (!listRes.ok) throw new Error(`PokeAPI list failed: ${listRes.status}`);
  const list: { results: PokemonListItem[] } = await listRes.json();

  const details = await Promise.all(
    list.results.map((p) => fetch(p.url).then((r) => r.json() as Promise<PokemonDetail>))
  );
  return details;
}

// ─── Type badge colours ───────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  normal:   "#A8A878",
  fire:     "#F08030",
  water:    "#6890F0",
  electric: "#F8D030",
  grass:    "#78C850",
  ice:      "#98D8D8",
  fighting: "#C03028",
  poison:   "#A040A0",
  ground:   "#E0C068",
  flying:   "#A890F0",
  psychic:  "#F85888",
  bug:      "#A8B820",
  rock:     "#B8A038",
  ghost:    "#705898",
  dragon:   "#7038F8",
  dark:     "#705848",
  steel:    "#B8B8D0",
  fairy:    "#EE99AC",
};

// ─── PokemonCard component ────────────────────────────────────────────────────

function PokemonCard({ pokemon }: { pokemon: PokemonDetail }): Node {
  const artwork =
    pokemon.sprites.other["official-artwork"].front_default ||
    pokemon.sprites.front_default;

  const id = String(pokemon.id).padStart(3, "0");

  return (
    <div class="pokemon-card">
      <div class="pokemon-image-wrapper">
        <img
          class="pokemon-image"
          src={artwork}
          alt={pokemon.name}
          loading="lazy"
        />
      </div>
      <div class="pokemon-info">
        <span class="pokemon-number">#{id}</span>
        <h3 class="pokemon-name">{pokemon.name}</h3>
        <div class="pokemon-types">
          {pokemon.types.map(({ type }) => (
            <span
              class="type-badge"
              style={{ backgroundColor: TYPE_COLORS[type.name] ?? "#777" }}
            >
              {type.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SearchBar component ──────────────────────────────────────────────────────

function SearchBar({
  onSearch,
}: {
  onSearch: (q: string) => void;
}): Node {
  return (
    <div class="search-wrapper">
      <span class="search-icon">🔍</span>
      <input
        class="search-input"
        type="text"
        placeholder="Search by name or number…"
        onInput={(e: InputEvent) =>
          onSearch((e.target as HTMLInputElement).value)
        }
      />
    </div>
  );
}

// ─── LoadingSpinner component ─────────────────────────────────────────────────

function LoadingSpinner(): Node {
  return (
    <div class="loading-screen">
      <div class="pokeball-spinner">
        <div class="pokeball-top" />
        <div class="pokeball-middle" />
        <div class="pokeball-bottom" />
      </div>
      <p class="loading-text">Loading Pokédex…</p>
    </div>
  );
}

// ─── ErrorScreen component ────────────────────────────────────────────────────

function ErrorScreen({
  message,
}: {
  message: string;
}): Node {
  return (
    <div class="error-screen">
      <span class="error-icon">⚠️</span>
      <p class="error-message">{message}</p>
      <p class="error-hint">
        Make sure you have an internet connection and try refreshing.
      </p>
    </div>
  );
}

// ─── EmptyState component ─────────────────────────────────────────────────────

function EmptyState({ query }: { query: string }): Node {
  return (
    <div class="empty-state">
      <span class="empty-icon">😕</span>
      <p>No Pokémon found for <strong>"{query}"</strong></p>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

export function App(): Node {
  // ── State signals ───────────────────────────────────────────────────────
  const query        = signal("");
  const pokemonList  = signal<PokemonDetail[]>([]);
  const loading      = signal(true);
  const errorMsg     = signal<string | null>(null);

  // ── Derived filtered list ────────────────────────────────────────────────
  const filtered = derived(() => {
    const q = query.get().toLowerCase().trim();
    if (q === "") return pokemonList.get();
    return pokemonList.get().filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        String(p.id).includes(q)
    );
  });

  // ── Fetch data (side-effect, not inside derived) ─────────────────────────
  fetchPokedex()
    .then((data) => {
      pokemonList.set(data);
      loading.set(false);
    })
    .catch((err: unknown) => {
      errorMsg.set(err instanceof Error ? err.message : String(err));
      loading.set(false);
    });

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div id="app">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header class="app-header">
        <div class="header-inner">
          <div class="logo">
            <span class="logo-icon">⚡</span>
            <h1 class="logo-text">Unact Pokédex</h1>
          </div>
          <SearchBar onSearch={(q) => query.set(q)} />
        </div>
      </header>

      {/* ── Main content (reactive: switches between loading / error / grid) */}
      <main class="app-main">
        {() => {
          if (loading.get()) {
            return <LoadingSpinner />;
          }
          if (errorMsg.get()) {
            return <ErrorScreen message={errorMsg.get()!} />;
          }

          const list = filtered.get();

          return (
            <div>
              {/* Result count */}
              <p class="result-count">
                {() => `Showing ${filtered.get().length} of ${pokemonList.get().length} Pokémon`}
              </p>

              {/* Empty state */}
              {() =>
                list.length === 0
                  ? <EmptyState query={query.get()} />
                  : null
              }

              {/* Pokemon grid */}
              {list.length > 0 && (
                <div class="pokemon-grid">
                  {list.map((p) => (
                    <PokemonCard pokemon={p} />
                  ))}
                </div>
              )}
            </div>
          );
        }}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer class="app-footer">
        <p>
          Built with{" "}
          <a href="https://github.com/raxraj/unact" target="_blank" rel="noopener">
            Unact
          </a>{" "}
          · Data from{" "}
          <a href="https://pokeapi.co" target="_blank" rel="noopener">
            PokéAPI
          </a>
        </p>
      </footer>
    </div>
  );
}
