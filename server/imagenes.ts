// Banco de imágenes para artículos y familias.
// Es una carpeta del PC del TPV (por defecto ./imagenes) organizada en subcarpetas
// (Cafés, Cervezas, Postres...). Las imágenes que se suben desde el TPV van a "Propias".
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { ErrorTPV } from './ventas.ts';

export const TIPOS_IMAGEN: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

let carpeta = join(process.cwd(), 'imagenes');
let cache: { en: number; datos: unknown } | null = null;

export function usarCarpetaImagenes(dir: string) {
  carpeta = normalize(dir);
  cache = null;
}

// Ruta relativa con "/" (como se guarda en la base de datos) -> ruta real dentro de la carpeta.
export function rutaReal(rel: string) {
  const r = normalize(join(carpeta, rel));
  if (r !== carpeta && !r.startsWith(carpeta.endsWith(sep) ? carpeta : carpeta + sep)) return null;
  return r;
}

export function rutaValida(rel: string) {
  return !!rel && !rel.includes('..') && !rel.startsWith('/') && !rel.includes('\\') && !!TIPOS_IMAGEN[extname(rel).toLowerCase()];
}

export async function listarImagenes() {
  if (cache && Date.now() - cache.en < 30_000) return cache.datos;
  const grupos = new Map<string, string[]>();
  const recorrer = async (rel: string, nivel: number) => {
    let entradas;
    try { entradas = await readdir(join(carpeta, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && nivel < 5) await recorrer(r, nivel + 1);
      else if (e.isFile() && TIPOS_IMAGEN[extname(e.name).toLowerCase()]) {
        const g = rel || 'General';
        if (!grupos.has(g)) grupos.set(g, []);
        grupos.get(g)!.push(r);
      }
    }
  };
  await recorrer('', 0);
  const carpetas = [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
    .map(([nombre, imagenes]) => ({ nombre, imagenes: imagenes.sort((a, b) => a.localeCompare(b, 'es')) }));
  const datos = { carpeta, existe: existsSync(carpeta), carpetas };
  cache = { en: Date.now(), datos };
  return datos;
}

// Recibe la imagen como data URL (data:image/jpeg;base64,...) y la guarda en "Propias".
export async function subirImagen(datos: { nombre?: string; datos?: string }) {
  const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(datos?.datos ?? ''));
  if (!m) throw new ErrorTPV('Formato de imagen no válido (usa JPG, PNG, GIF o WEBP)');
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }[m[1]]!;
  const bin = Buffer.from(m[2], 'base64');
  if (bin.length > 5_000_000) throw new ErrorTPV('La imagen es demasiado grande (máximo 5 MB)');
  const base = String(datos.nombre ?? 'imagen').replace(/\.[^.]*$/, '').normalize('NFC')
    .replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'imagen';
  await mkdir(join(carpeta, 'Propias'), { recursive: true });
  let nombre = base + ext;
  for (let i = 2; existsSync(join(carpeta, 'Propias', nombre)); i++) nombre = `${base} ${i}${ext}`;
  await writeFile(join(carpeta, 'Propias', nombre), bin);
  cache = null;
  return { ruta: `Propias/${nombre}` };
}

export async function leerImagen(rel: string) {
  if (!rutaValida(rel)) return null;
  const r = rutaReal(rel);
  if (!r) return null;
  try {
    return { datos: await readFile(r), tipo: TIPOS_IMAGEN[extname(r).toLowerCase()] };
  } catch {
    return null;
  }
}
