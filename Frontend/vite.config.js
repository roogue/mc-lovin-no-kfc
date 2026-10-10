import { defineConfig, createLogger } from 'vite';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Every .html file in this folder is a page (index, disease, monitoring-history, report, ...)
const pages = readdirSync(root).filter((f) => f.endsWith('.html'));

// The pages load plain <script src="..."> files (not ES modules). Vite serves them as-is in dev,
// but leaves them out of a production build, so copy every local classic script into dist.
function copyClassicScripts() {
  return {
    name: 'copy-classic-scripts',
    apply: 'build',
    generateBundle() {
      const scripts = new Set();
      for (const page of pages) {
        const html = readFileSync(`${root}${page}`, 'utf-8');
        for (const m of html.matchAll(/<script\s+src="(?!https?:|\/\/)([^"]+\.js)"/g)) scripts.add(m[1]);
      }
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
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((f) => [f.replace(/\.html$/, ''), `${root}${f}`])),
    },
  },
  server: {
    port: 5173,
    open: true, // opens the browser when you run `npm run dev`
  },
  preview: {
    port: 4173,
    open: true,
  },
});
