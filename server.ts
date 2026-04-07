/**
 * server.ts – Unact development server
 *
 * Serves the Pokédex example (or any other example) with:
 *  - On-the-fly TypeScript + JSX bundling via esbuild
 *  - File watching + automatic rebuild on source changes
 *  - Static file serving (HTML, CSS, images)
 *
 * Usage:
 *   npm run serve                        # starts on port 3000
 *   PORT=8080 npm run serve              # custom port
 *   EXAMPLE=pokedex npm run serve        # explicit example (default: pokedex)
 */

import * as http from "http";
import * as fs   from "fs";
import * as path from "path";
import * as esbuild from "esbuild";

const PORT    = parseInt(process.env["PORT"]    ?? "3000", 10);
const EXAMPLE = process.env["EXAMPLE"] ?? "pokedex";

const ROOT         = process.cwd();
const EXAMPLE_DIR  = path.join(ROOT, "examples", EXAMPLE);
const ENTRY_TSX    = path.join(EXAMPLE_DIR, "main.tsx");
const HTML_FILE    = path.join(EXAMPLE_DIR, "index.html");
const CSS_FILE     = path.join(EXAMPLE_DIR, "styles.css");

// ─── MIME types ───────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

// ─── esbuild context ──────────────────────────────────────────────────────────

/** Latest bundle (kept in memory; rebuilt on every file change). */
let bundleJs = "// Building…";
let bundleError: string | null = null;
let bundleReady = false;

const buildOptions: esbuild.BuildOptions = {
  entryPoints:  [ENTRY_TSX],
  bundle:       true,
  format:       "iife",
  target:       "es2020",
  sourcemap:    "inline",
  jsxFactory:   "h",
  jsxFragment:  "Fragment",
  platform:     "browser",
  write:        false,                // keep output in memory
  logLevel:     "silent",
};

async function rebuild(): Promise<void> {
  try {
    const result = await esbuild.build(buildOptions);
    if (result.outputFiles && result.outputFiles.length > 0) {
      bundleJs    = result.outputFiles[0].text;
      bundleError = null;
    }
    bundleReady = true;
    if (result.errors.length) {
      bundleError = result.errors.map((e) => e.text).join("\n");
      console.error("[esbuild] Build error:\n", bundleError);
    } else {
      console.log(`[esbuild] Bundle ready  (${(bundleJs.length / 1024).toFixed(1)} KB)`);
    }
  } catch (err: unknown) {
    bundleError = String(err);
    bundleReady = true;
    console.error("[esbuild] Fatal build error:", err);
  }
}

// ─── File watcher ─────────────────────────────────────────────────────────────

const WATCH_DIRS = [
  path.join(ROOT, "runtime.ts"),
  path.join(ROOT, "dom.ts"),
  EXAMPLE_DIR,
];

let rebuildTimer: NodeJS.Timeout | null = null;

for (const watchPath of WATCH_DIRS) {
  if (!fs.existsSync(watchPath)) continue;
  fs.watch(watchPath, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      console.log(`[watch] ${filename} changed — rebuilding…`);
      rebuild().catch(console.error);
    }, 80);
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url  = req.url ?? "/";
  const { pathname } = new URL(url, `http://localhost:${PORT}`);

  // ── /bundle.js → serve JS bundle ──────────────────────────────────────
  if (pathname === "/bundle.js") {
    if (!bundleReady) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Bundle not ready yet — please refresh in a moment.");
      return;
    }
    if (bundleError) {
      const errorScript = `document.body.innerHTML='<pre style="color:red;padding:2rem">${bundleError.replace(/</g,"&lt;")}</pre>'`;
      res.writeHead(200, {
        "Content-Type": MIME[".js"]!,
        "Cache-Control": "no-cache",
      });
      res.end(errorScript);
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[".js"]!,
      "Cache-Control": "no-cache",
    });
    res.end(bundleJs);
    return;
  }

  // ── /styles.css → serve CSS ───────────────────────────────────────────
  if (pathname === "/styles.css") {
    try {
      const css = fs.readFileSync(CSS_FILE, "utf-8");
      res.writeHead(200, {
        "Content-Type": MIME[".css"]!,
        "Cache-Control": "no-cache",
      });
      res.end(css);
    } catch {
      res.writeHead(404);
      res.end("CSS not found");
    }
    return;
  }

  // ── Everything else → serve index.html (SPA fallback) ─────────────────
  try {
    const html = fs.readFileSync(HTML_FILE, "utf-8");
    res.writeHead(200, {
      "Content-Type": MIME[".html"]!,
      "Cache-Control": "no-cache",
    });
    res.end(html);
  } catch {
    res.writeHead(404);
    res.end("index.html not found");
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n⚡ Unact dev server`);
  console.log(`   Example  : ${EXAMPLE}`);
  console.log(`   Building bundle…\n`);

  await rebuild();

  server.listen(PORT, () => {
    console.log(`\n🚀 Ready → http://localhost:${PORT}\n`);
    console.log(`   Press Ctrl+C to stop.\n`);
  });
})().catch((err) => {
  console.error("Server startup failed:", err);
  process.exit(1);
});
