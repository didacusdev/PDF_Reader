import fs from 'node:fs';
import path from 'node:path';

function rewriteManifestIconsRawGithub() {
  /** @type {import('vite').ResolvedConfig | null} */
  let resolved = null;
  /** @type {Array<{src:string,sizes:string,type:string}>} */
  let icons = [];

  return {
    name: 'rewrite-manifest-icons-raw-github',
    apply: 'build',
    configResolved(config) {
      resolved = config;
    },
    generateBundle(_options, bundle) {
      const base = resolved?.base && typeof resolved.base === 'string' ? resolved.base : '/';
      const iconBase = base.endsWith('/') ? base : `${base}/`;

      /**
       * @param {string} baseName
       * @returns {string | null}
       */
      function findEmittedFileName(baseName) {
        for (const entry of Object.values(bundle)) {
          if (!entry || entry.type !== 'asset') continue;

          const entryName = typeof entry.name === 'string' ? entry.name : '';
          if (entryName && entryName.split('/').pop() === baseName) return entry.fileName;
          if (entry.fileName && entry.fileName.split('/').pop() === baseName) return entry.fileName;
          if (entry.fileName && entry.fileName.includes(baseName.replace(/\.png$/i, ''))) return entry.fileName;
        }
        return null;
      }

      const iconSpecs = [
        { size: 100, baseName: 'ebook100.png' },
        { size: 192, baseName: 'ebook192.png' },
        { size: 200, baseName: 'ebook200.png' },
        { size: 500, baseName: 'ebook500.png' },
        { size: 512, baseName: 'ebook512.png' },
      ];

      const nextIcons = [];
      for (const spec of iconSpecs) {
        const emitted = findEmittedFileName(spec.baseName);
        if (!emitted) {
          this.warn(
            `[manifest] No se encontró en el bundle el asset '${spec.baseName}'. ` +
              `Asegúrate de que se importe o se referencia para que Vite lo emita.`
          );
          continue;
        }

        const fileBase = emitted.split('/').pop();
        nextIcons.push({
          // Same-origin (GitHub Pages): p.ej. /PDF_Reader/assets/ebook512-XXXX.png
          src: `${iconBase}${emitted}`,
          sizes: `${spec.size}x${spec.size}`,
          type: 'image/png',
          purpose: 'any',
        });
      }

      icons = nextIcons;
    },
    closeBundle() {
      if (!resolved) return;

      const rootDir = resolved.root || process.cwd();
      const outDirAbs = path.resolve(rootDir, resolved.build.outDir || 'dist');
      const sourceManifestPath = path.resolve(rootDir, 'public', 'manifest.json');
      const outManifestPath = path.resolve(outDirAbs, 'manifest.json');

      let manifestJson;
      try {
        manifestJson = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
      } catch {
        manifestJson = {};
      }

      if (Array.isArray(icons) && icons.length) {
        manifestJson.icons = icons;
      }

      // Hace que el "Application ID" y el scope sean estables bajo GitHub Pages.
      // En este repo, base es '/PDF_Reader/' (incluye el slash final).
      if (typeof resolved.base === 'string' && resolved.base.startsWith('/')) {
        manifestJson.id = resolved.base;
        manifestJson.scope = resolved.base;
        manifestJson.start_url = resolved.base;
      }

      fs.writeFileSync(outManifestPath, `${JSON.stringify(manifestJson, null, 2)}\n`);
    },
  };
}

/** @type {import('vite').UserConfig} */
export default {
  // Para desplegar en GitHub Pages bajo el subpath del repo.
  base: '/PDF_Reader/',
  plugins: [
    rewriteManifestIconsRawGithub(),
  ],
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
};
