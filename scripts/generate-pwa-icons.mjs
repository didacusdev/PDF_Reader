import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HorizontalAlign, Jimp, ResizeStrategy, VerticalAlign } from 'jimp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.resolve(rootDir, 'src', 'assets');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function generate192() {
  const srcPath = path.resolve(assetsDir, 'ebook200.png');
  const outPath = path.resolve(assetsDir, 'ebook192.png');

  if (!(await exists(srcPath))) throw new Error(`No existe ${srcPath}`);

  const img = await Jimp.read(srcPath);
  // Forzamos 192x192 (requisito típico de Chrome).
  img.resize({ w: 192, h: 192, mode: ResizeStrategy.BICUBIC });
  await img.write(outPath);
}

async function generate512() {
  const srcPath = path.resolve(assetsDir, 'ebook500.png');
  const outPath = path.resolve(assetsDir, 'ebook512.png');

  if (!(await exists(srcPath))) throw new Error(`No existe ${srcPath}`);

  const img = await Jimp.read(srcPath);

  // Crea un lienzo 512x512 y centra la imagen original dentro.
  // Mantiene el arte sin estirar; añade padding transparente.
  const canvas = new Jimp({ width: 512, height: 512, color: 0x00000000 });

  const fitted = img.clone();
  // Si algún día el origen no es 500 exacto, lo ajustamos a caber sin recortar.
  fitted.contain({
    w: 512,
    h: 512,
    align: HorizontalAlign.CENTER | VerticalAlign.MIDDLE,
  });
  canvas.composite(fitted, 0, 0);

  await canvas.write(outPath);
}

try {
  await generate192();
  await generate512();
  // eslint-disable-next-line no-console
  console.log('Iconos PWA generados: src/assets/ebook192.png y src/assets/ebook512.png');
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(String(err?.stack || err));
  process.exitCode = 1;
}
