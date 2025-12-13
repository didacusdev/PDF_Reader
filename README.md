# PDF Reader (modo libro)

Aplicación web estática para cargar un archivo PDF y leerlo como si fuese un libro, con animación realista de cambio de página.

Incluye pantalla completa, zoom, navegación por miniaturas y controles por teclado.

---
## Funcionalidades

- Carga de PDF desde archivo local.
- Lectura tipo “libro” con efecto de pasar página (3D).
- Navegación:
  - Botones Anterior / Siguiente.
  - Teclas `←` y `→`.
  - Sidebar con miniaturas clicables.
- Zoom in / out.
- Pantalla completa con toolbar lateral para no perder altura útil.
- Scroll automático cuando la página supera el viewport.
- Reverso de la hoja con tono beige sutil (sin impresión) para mejorar el realismo.

## Tecnologías usadas

- **HTML** + **JavaScript** (ESM).
- **TailwindCSS v4 (browser build CDN)** para estilos.
- **PDF.js** vía `pdfjs-dist` para renderizar páginas a `<canvas>`.
- **StPageFlip** vía `page-flip` para el efecto realista de pasar página.
- **Vite** para desarrollo y build a producción (genera `dist/`).

## Requisitos

- Node.js (recomendado: versión moderna LTS).
- pnpm.

---
## Instalación

```bash
pnpm install
```

## Desarrollo (modo dev)

Levanta un servidor con recarga en caliente:

```bash
pnpm dev
```

## Build para producción

Genera los archivos finales en la carpeta `dist/`:

```bash
pnpm build
```

## Previsualizar el build

Sirve el contenido de `dist/` localmente:

```bash
pnpm preview
```
