import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
const PDFJS_ASSET_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];

/** Serves (dev) and emits (build) PDF.js CMaps, standard fonts and WASM decoders under /pdfjs/. */
function pdfjsAssets(): Plugin {
  return {
    name: "studyspace-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
        const [dir] = rel.split("/");
        const file = path.resolve(pdfjsDir, rel);
        if (!PDFJS_ASSET_DIRS.includes(dir) || !file.startsWith(pdfjsDir + path.sep) || !fs.existsSync(file)) {
          return next();
        }
        res.setHeader("Cache-Control", "public, max-age=86400");
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        const abs = path.join(pdfjsDir, dir);
        if (!fs.existsSync(abs)) continue;
        for (const name of fs.readdirSync(abs)) {
          const f = path.join(abs, name);
          if (fs.statSync(f).isFile()) {
            this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${name}`, source: fs.readFileSync(f) });
          }
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Shares the repo-root .env with the server so both agree on the API port.
  const env = { ...loadEnv(mode, path.resolve(import.meta.dirname, ".."), "STUDYSPACE_"), ...process.env };
  const apiPort = env.STUDYSPACE_PORT ?? "4317";
  return {
    plugins: [react(), tailwindcss(), pdfjsAssets()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: false,
      proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    },
    build: { chunkSizeWarningLimit: 2500 },
  };
});
