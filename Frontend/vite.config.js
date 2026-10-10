import { defineConfig, createLogger } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// The page loads plain <script src="..."> files (not ES modules). Vite serves them as-is in dev,
// but leaves them out of a production build, so copy every local classic script into dist.
function copyClassicScripts() {
  return {
    name: 'copy-classic-scripts',
    apply: 'build',
    generateBundle() {
      const html = readFileSync(`${root}index.html`, 'utf-8');
      const scripts = [...html.matchAll(/<script\s+src="(?!https?:|\/\/)([^"]+\.js)"/g)].map((m) => m[1]);
      for (const file of scripts) {
        if (!existsSync(`${root}${file}`)) continue;
        this.emitFile({ type: 'asset', fileName: file, source: readFileSync(`${root}${file}`, 'utf-8') });
      }
    },
  };
}

// Vite warns that each classic script "can't be bundled"; the plugin above handles them, so hide that warning
const logger = createLogger();
const warn = logger.warn;
logger.warn = (msg, options) => {
  if (msg.includes("can't be bundled without type=\"module\"")) return;
  warn(msg, options);
};

export default defineConfig({
  customLogger: logger,
  root,
  base: './', // relative paths so the built site works from any folder
  plugins: [copyClassicScripts()],
  server: {
    port: 5173,
    open: true, // opens the browser when you run `npm run dev`
  },
  preview: {
    port: 4173,
    open: true,
  },
});
