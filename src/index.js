import * as pdfjsLib from 'pdfjs-dist/build/pdf.min.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PageFlip } from 'page-flip';

// Fuerza a Vite/Rollup a emitir estos assets en el build (para poder referenciarlos desde el manifest).
const pwaIcon100 = new URL('./assets/ebook100.png', import.meta.url).href;
const pwaIcon200 = new URL('./assets/ebook200.png', import.meta.url).href;
const pwaIcon500 = new URL('./assets/ebook500.png', import.meta.url).href;
globalThis.__PWA_ICON_URLS__ = { pwaIcon100, pwaIcon200, pwaIcon500 };

const pdfInput = document.getElementById('pdfInput');
const statusEl = document.getElementById('status');
const pageLabel = document.getElementById('pageLabel');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomLabel = document.getElementById('zoomLabel');
const fsBtn = document.getElementById('fsBtn');
const sidebarBtn = document.getElementById('sidebarBtn');
const sidebar = document.getElementById('sidebar');
const thumbs = document.getElementById('thumbs');
const thumbStatus = document.getElementById('thumbStatus');
const placeholder = document.getElementById('placeholder');
const book = document.getElementById('book');
const flipHost = document.getElementById('flipHost');

const fsToolbar = document.getElementById('fsToolbar');
const fsSidebarBtn = document.getElementById('fsSidebarBtn');
const fsPrevBtn = document.getElementById('fsPrevBtn');
const fsNextBtn = document.getElementById('fsNextBtn');
const fsZoomOutBtn = document.getElementById('fsZoomOutBtn');
const fsZoomInBtn = document.getElementById('fsZoomInBtn');
const fsExitBtn = document.getElementById('fsExitBtn');
const fsMenuBtn = document.getElementById('fsMenuBtn');

function setFsMenuOpen(isOpen) {
  document.body.classList.toggle('fs-menu-open', isOpen);
  if (fsMenuBtn) fsMenuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('text-red-300', isError);
  statusEl.classList.toggle('text-slate-400', !isError);
}

try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
} catch {
  // ignore
}

/** @type {import('pdfjs-dist').PDFDocumentProxy | null} */
let pdfDoc = null;
let totalPages = 0;
let pageNum = 1;

/** @type {PageFlip | null} */
let pageFlip = null;
let isBusy = false;

let zoom = 1;
let sidebarOpen = true;
let restoreSidebarOpenAfterFs = true;

/** 'width' | 'height' */
let fitMode = 'width';
let pageAspectRatio = 4 / 3; // fallback

/** @type {'auto' | 'hidden'} */
let desiredBookOverflow = 'auto';

let thumbBuildToken = 0;
/** @type {Map<number, HTMLButtonElement>} */
const thumbButtons = new Map();
/** @type {Map<number, HTMLCanvasElement>} */
const pageCanvases = new Map();
/** @type {Map<number, number>} */
const renderedZoom = new Map();

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setUIState() {
  const hasDoc = !!pdfDoc;
  prevBtn.disabled = !hasDoc || pageNum <= 1 || isBusy;
  nextBtn.disabled = !hasDoc || pageNum >= totalPages || isBusy;
  zoomOutBtn.disabled = !hasDoc || isBusy;
  zoomInBtn.disabled = !hasDoc || isBusy;

  if (fsPrevBtn) fsPrevBtn.disabled = prevBtn.disabled;
  if (fsNextBtn) fsNextBtn.disabled = nextBtn.disabled;
  if (fsZoomOutBtn) fsZoomOutBtn.disabled = zoomOutBtn.disabled;
  if (fsZoomInBtn) fsZoomInBtn.disabled = zoomInBtn.disabled;

  const isFs = !!document.fullscreenElement;
  fsBtn.textContent = isFs ? 'Salir de pantalla completa' : 'Pantalla completa';
  document.body.classList.toggle('is-fullscreen', isFs);
  if (fsToolbar) fsToolbar.classList.toggle('hidden', !isFs);
  if (!isFs) setFsMenuOpen(false);

  sidebar.classList.toggle('hidden', !sidebarOpen);
  if (isFs) {
    sidebar.classList.toggle('fixed', true);
    sidebar.classList.toggle('left-4', true);
    sidebar.classList.toggle('top-4', true);
    sidebar.classList.toggle('bottom-4', true);
    sidebar.classList.toggle('z-50', true);
  } else {
    sidebar.classList.toggle('fixed', false);
    sidebar.classList.toggle('left-4', false);
    sidebar.classList.toggle('top-4', false);
    sidebar.classList.toggle('bottom-4', false);
    sidebar.classList.toggle('z-50', false);
  }

  pageLabel.textContent = hasDoc ? `Página ${pageNum} / ${totalPages}` : 'Página — / —';
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function getUsableBookRect() {
  const rect = book.getBoundingClientRect();
  // bookInner usa p-3 (12px por lado)
  const pad = 24;
  return {
    width: Math.max(1, rect.width - pad),
    height: Math.max(1, rect.height - pad),
  };
}

function applyBookOverflow(mode) {
  // El DOM ya tiene overflow-auto por Tailwind; el style inline lo sobreescribe.
  book.style.overflow = mode;
}

function computeAndApplyOverflow(pageWidth, pageHeight) {
  const usable = getUsableBookRect();
  // Tolerancia para evitar scrollbars por redondeos sub-pixel.
  const eps = 2;
  const needsScroll = pageWidth > usable.width + eps || pageHeight > usable.height + eps;
  desiredBookOverflow = needsScroll ? 'auto' : 'hidden';
  applyBookOverflow(desiredBookOverflow);
}

async function updateAspectRatio() {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  pageAspectRatio = vp.height / vp.width;
}

function computePageSize() {
  const { width, height } = getUsableBookRect();

  if (fitMode === 'height') {
    const pageHeight = height * zoom;
    const pageWidth = pageHeight / pageAspectRatio;
    return { pageWidth: Math.max(200, pageWidth), pageHeight: Math.max(200, pageHeight) };
  }

  // fitMode === 'width'
  const pageWidth = width * zoom;
  const pageHeight = pageWidth * pageAspectRatio;
  return { pageWidth: Math.max(200, pageWidth), pageHeight: Math.max(200, pageHeight) };
}

async function renderPdfPageToCanvas(pageIndex, canvas, targetCssWidth) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(pageIndex);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = targetCssWidth / unscaled.width;
  const viewport = page.getViewport({ scale });

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
}

async function renderThumbnailToCanvas(pageIndex, canvas) {
  if (!pdfDoc) return;
  const thumbWidth = 160;
  const page = await pdfDoc.getPage(pageIndex);
  const unscaledViewport = page.getViewport({ scale: 1 });
  const scale = thumbWidth / unscaledViewport.width;
  const viewport = page.getViewport({ scale });

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
}

function setActiveThumbnail(activePage) {
  for (const [p, btn] of thumbButtons.entries()) {
    btn.classList.toggle('border-slate-500', p === activePage);
    btn.classList.toggle('border-slate-800', p !== activePage);
  }
}

async function ensureRendered(pageIndex, targetCssWidth) {
  if (!pdfDoc) return;
  const canvas = pageCanvases.get(pageIndex);
  if (!canvas) return;

  const lastZoom = renderedZoom.get(pageIndex);
  if (lastZoom === zoom) return;

  renderedZoom.set(pageIndex, zoom);
  await renderPdfPageToCanvas(pageIndex, canvas, targetCssWidth);
}

function destroyPageFlip() {
  try {
    if (pageFlip) pageFlip.destroy();
  } catch {
    // ignore
  }
  pageFlip = null;
}

async function initPageFlip() {
  if (!pdfDoc) return;
  destroyPageFlip();

  pageCanvases.clear();
  renderedZoom.clear();
  flipHost.innerHTML = '';

  const { pageWidth, pageHeight } = computePageSize();

  // Si la página cabe, ocultamos overflow para que el flip no "mueva" scrollbars.
  computeAndApplyOverflow(pageWidth, pageHeight);

  // Creamos un bloque interno para que destroy() no elimine flipHost.
  const flipBlock = document.createElement('div');
  flipBlock.id = 'flipBlock';
  flipBlock.style.width = `${Math.floor(pageWidth)}px`;
  flipBlock.style.height = `${Math.floor(pageHeight)}px`;
  flipHost.appendChild(flipBlock);

  // Crear páginas HTML
  const pageEls = [];
  for (let i = 1; i <= totalPages; i += 1) {
    const pageEl = document.createElement('div');
    pageEl.className = 'pdf-page';
    pageEl.dataset.density = 'soft';
    pageEl.style.position = 'relative';
    pageEl.style.overflow = 'hidden';
    pageEl.style.transformStyle = 'preserve-3d';

    const frontFace = document.createElement('div');
    frontFace.className = 'pdf-face pdf-front';

    const backFace = document.createElement('div');
    backFace.className = 'pdf-face pdf-back';

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    frontFace.appendChild(canvas);
    pageEl.appendChild(frontFace);
    pageEl.appendChild(backFace);

    flipBlock.appendChild(pageEl);
    pageEls.push(pageEl);
    pageCanvases.set(i, canvas);
  }

  pageFlip = new PageFlip(flipBlock, {
    width: Math.floor(pageWidth),
    height: Math.floor(pageHeight),
    size: 'fixed',
    autoSize: true,
    drawShadow: true,
    maxShadowOpacity: 0.6,
    flippingTime: 900,
    useMouseEvents: true,
    usePortrait: true,
    startPage: Math.max(0, pageNum - 1),
    mobileScrollSupport: false,
  });

  pageFlip.loadFromHTML(pageEls);

  pageFlip.on('changeState', (ev) => {
    const state = typeof ev.data === 'string' ? ev.data : '';
    // Durante la animación, forzamos overflow oculto para evitar scrollbars "feos".
    if (state === 'flipping' || state === 'user_fold' || state === 'fold_corner') {
      applyBookOverflow('hidden');
    }
    if (state === 'read') {
      applyBookOverflow(desiredBookOverflow);
    }
  });

  pageFlip.on('flip', async (ev) => {
    const idx = typeof ev.data === 'number' ? ev.data : 0;
    pageNum = idx + 1;
    setUIState();
    setActiveThumbnail(pageNum);
    // Renderiza página actual y adyacentes
    const w = Math.floor(pageWidth);
    try {
      await ensureRendered(pageNum, w);
      if (pageNum > 1) await ensureRendered(pageNum - 1, w);
      if (pageNum < totalPages) await ensureRendered(pageNum + 1, w);
    } catch (err) {
      console.error(err);
    }
  });

  // Render inicial
  const w = Math.floor(pageWidth);
  await ensureRendered(pageNum, w);
  if (pageNum > 1) await ensureRendered(pageNum - 1, w);
  if (pageNum < totalPages) await ensureRendered(pageNum + 1, w);
}

async function goToPage(targetPage) {
  if (!pdfDoc || !pageFlip) return;
  if (targetPage < 1 || targetPage > totalPages) return;
  pageFlip.turnToPage(targetPage - 1);
}

async function buildThumbnails() {
  if (!pdfDoc) return;
  const myToken = ++thumbBuildToken;
  thumbButtons.clear();
  thumbs.innerHTML = '';
  thumbStatus.textContent = `0 / ${totalPages}`;

  for (let i = 1; i <= totalPages; i += 1) {
    if (myToken !== thumbBuildToken) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'mb-2 w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-left text-xs text-slate-300 hover:border-slate-600';
    btn.addEventListener('click', () => {
      goToPage(i);
    });

    const label = document.createElement('div');
    label.className = 'mb-2 text-xs text-slate-400';
    label.textContent = `Página ${i}`;

    const canvas = document.createElement('canvas');
    canvas.className = 'block w-full rounded-md bg-slate-900';

    btn.appendChild(label);
    btn.appendChild(canvas);
    thumbs.appendChild(btn);
    thumbButtons.set(i, btn);

    try {
      await renderThumbnailToCanvas(i, canvas);
    } catch (err) {
      console.error(err);
    }

    thumbStatus.textContent = `${i} / ${totalPages}`;
    await new Promise((r) => requestAnimationFrame(r));
  }

  setActiveThumbnail(pageNum);
}

async function loadPdfFromFile(file) {
  isBusy = true;
  setUIState();
  setStatus('Cargando PDF…');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const disableWorker = window.location && window.location.protocol === 'file:';
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, disableWorker });

    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;
    pageNum = 1;
    zoom = 1;
    fitMode = document.fullscreenElement ? 'height' : 'width';

    await updateAspectRatio();
    placeholder.classList.add('hidden');

    await buildThumbnails();
    await initPageFlip();
    setActiveThumbnail(pageNum);

    setStatus(`Documento cargado: ${file.name}`);
  } catch (err) {
    console.error(err);
    destroyPageFlip();
    pdfDoc = null;
    totalPages = 0;
    pageNum = 1;
    placeholder.classList.remove('hidden');
    flipHost.innerHTML = '';

    const message =
      err && typeof err === 'object' && 'message' in err
        ? String(err.message)
        : 'No se pudo cargar el PDF.';
    setStatus(`No se pudo cargar el PDF: ${message}`, true);
  } finally {
    isBusy = false;
    setUIState();
  }
}

function flipPrev() {
  if (!pageFlip || !pdfDoc) return;
  if (pageNum <= 1) return;

  // Alinea el inicio del flip al borde izquierdo del libro.
  // (En algunos layouts centrados, flipPrev() puede sentirse distinto al flipNext()).
  const ctrl = /** @type {any} */ (pageFlip).getFlipController?.();
  const rect = pageFlip.getBoundsRect?.();
  if (ctrl && typeof ctrl.flip === 'function' && rect && typeof rect.left === 'number') {
    const x = rect.left + 10;
    const y = 1;
    ctrl.flip({ x, y });
    return;
  }

  pageFlip.flipPrev('top');
}

function flipNext() {
  if (!pageFlip || !pdfDoc) return;
  if (pageNum >= totalPages) return;

  // Mantiene simetría con flipPrev: inicia desde la esquina derecha.
  const ctrl = /** @type {any} */ (pageFlip).getFlipController?.();
  const rect = pageFlip.getBoundsRect?.();
  if (ctrl && typeof ctrl.flip === 'function' && rect && typeof rect.left === 'number') {
    const pw = typeof rect.pageWidth === 'number' ? rect.pageWidth : rect.width / 2;
    const x = rect.left + 2 * pw - 10;
    const y = 1;
    ctrl.flip({ x, y });
    return;
  }

  pageFlip.flipNext('top');
}

let rebuildTimer = null;
function scheduleRebuild() {
  if (!pdfDoc) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    if (!pdfDoc) return;
    isBusy = true;
    setUIState();
    try {
      await initPageFlip();
    } finally {
      isBusy = false;
      setUIState();
    }
  }, 100);
}

pdfInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  loadPdfFromFile(file);
});

prevBtn.addEventListener('click', flipPrev);
nextBtn.addEventListener('click', flipNext);
if (fsPrevBtn) fsPrevBtn.addEventListener('click', flipPrev);
if (fsNextBtn) fsNextBtn.addEventListener('click', flipNext);

sidebarBtn.addEventListener('click', () => {
  sidebarOpen = !sidebarOpen;
  setUIState();
  scheduleRebuild();
});

if (fsSidebarBtn) {
  fsSidebarBtn.addEventListener('click', () => {
    sidebarOpen = !sidebarOpen;
    setUIState();
    scheduleRebuild();
  });
}

zoomOutBtn.addEventListener('click', () => {
  if (!pdfDoc || isBusy) return;
  zoom = clamp(Math.round((zoom - ZOOM_STEP) * 10) / 10, ZOOM_MIN, ZOOM_MAX);
  setUIState();
  scheduleRebuild();
});

zoomInBtn.addEventListener('click', () => {
  if (!pdfDoc || isBusy) return;
  zoom = clamp(Math.round((zoom + ZOOM_STEP) * 10) / 10, ZOOM_MIN, ZOOM_MAX);
  setUIState();
  scheduleRebuild();
});

if (fsZoomOutBtn) fsZoomOutBtn.addEventListener('click', () => zoomOutBtn.click());
if (fsZoomInBtn) fsZoomInBtn.addEventListener('click', () => zoomInBtn.click());

fsBtn.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      restoreSidebarOpenAfterFs = sidebarOpen;
      sidebarOpen = false;
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    console.error(err);
    setStatus('No se pudo activar pantalla completa en este navegador.', true);
  } finally {
    setUIState();
  }
});

if (fsExitBtn) {
  fsExitBtn.addEventListener('click', async () => {
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch (err) {
      console.error(err);
    }
  });
}

if (fsMenuBtn) {
  fsMenuBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) return;
    const isOpen = document.body.classList.toggle('fs-menu-open');
    fsMenuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement;
  setFsMenuOpen(false);
  fitMode = isFs ? 'height' : 'width';
  if (!isFs) sidebarOpen = restoreSidebarOpenAfterFs;
  setUIState();
  scheduleRebuild();
});

window.addEventListener('keydown', (e) => {
  if (!pdfDoc) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    flipPrev();
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    flipNext();
  }
});

window.addEventListener('resize', () => {
  if (!pdfDoc) return;
  scheduleRebuild();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  isBusy = false;
  setUIState();
});

setUIState();
