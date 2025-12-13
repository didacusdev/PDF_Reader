/** @type {import('vite').UserConfig} */
export default {
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  // Si luego lo sirves bajo un subpath (ej: /pdf-reader/), cambia base aquí.
  // base: '/pdf-reader/',
};
