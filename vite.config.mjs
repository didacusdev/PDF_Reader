/** @type {import('vite').UserConfig} */
export default {
  // Para desplegar en GitHub Pages bajo el subpath del repo.
  base: '/PDF-Reader/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
};
