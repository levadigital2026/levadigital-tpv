// Banco de imágenes para artículos y familias.
// Es una carpeta del PC del TPV (por defecto ./imagenes) organizada en subcarpetas
// (Cafés, Cervezas, Postres...). Las imágenes que se suben desde el TPV van a "Propias".
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// Los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011).
// 'archivo' es el icono que se busca en la carpeta "Alergenos" del banco de imágenes.
export const ALERGENOS: [string, string, string][] = [
  ['gluten', 'Gluten', 'trigo'], ['crustaceos', 'Crustáceos', 'crustaceo'], ['huevo', 'Huevo', 'huevo'],
  ['pescado', 'Pescado', 'pescado'], ['cacahuete', 'Cacahuete', 'cacahuete'], ['soja', 'Soja', 'leguminosas'],
  ['leche', 'Leche', 'leche'], ['frutos_cascara', 'Frutos de cáscara', 'nuez'], ['apio', 'Apio', 'apio'],
  ['mostaza', 'Mostaza', 'mostaza'], ['sesamo', 'Sésamo', 'sesamo'], ['sulfitos', 'Sulfitos', 'sulfitos'],
  ['altramuces', 'Altramuces', 'altramuces'], ['moluscos', 'Moluscos', 'moluscos'],
];
export const CODIGOS_ALERGENOS = new Set(ALERGENOS.map(a => a[0]));

export async function listaAlergenos() {
  let archivos: string[] = [];
  try { archivos = await readdir(join(carpeta, 'Alergenos')); } catch {}
  return ALERGENOS.map(([codigo, nombre, archivo]) => {
    const f = archivos.find(x => x.replace(/\.[^.]+$/, '').toLowerCase() === archivo && TIPOS_IMAGEN[extname(x).toLowerCase()]);
    return { codigo, nombre, imagen: f ? `Alergenos/${f}` : '' };
  });
}

// Pasa a minúsculas sin acentos ni signos: "Café con Leche" -> "cafeconleche".
export const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Palabras de un nombre: separa por espacios, signos, números y MayúsculasPegadas ("AguaMineral").
const VACIAS = new Set(['de', 'del', 'con', 'al', 'a', 'la', 'el', 'los', 'las', 'y', 'en', 'kg', 'ud', 'uds']);
function palabras(s: string) {
  return s.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2').split(/[^\p{L}]+/u).map(normalizar).filter(w => w.length > 1 && !VACIAS.has(w));
}
const igual = (a: string, b: string) => a === b || a.replace(/e?s$/, '') === b.replace(/e?s$/, '');

// Busca en el banco la imagen cuyo nombre de archivo mejor encaja con el nombre del artículo.
export async function buscarImagenPara(nombre: string): Promise<string | null> {
  const datos = await listarImagenes() as { carpetas: { nombre: string; imagenes: string[] }[] };
  const pa = palabras(nombre);
  if (!pa.length) return null;
  const juntoA = pa.join('');
  let mejor: { ruta: string; nota: number } | null = null;
  for (const c of datos.carpetas) {
    if (/^alergenos$/i.test(c.nombre)) continue;
    for (const ruta of c.imagenes) {
      const pf = palabras(ruta.split('/').pop()!.replace(/\.[^.]+$/, ''));
      if (!pf.length) continue;
      const juntoF = pf.join('');
      let nota = 0;
      if (igual(juntoF, juntoA)) nota = 100;
      else if (pa.every(a => pf.some(f => igual(a, f)))) nota = 85 - (pf.length - pa.length) * 5;
      else if (pf.every(f => pa.some(a => igual(a, f)))) nota = 70 + pf.length / pa.length * 10;
      else if (juntoA.length >= 5 && juntoF.startsWith(juntoA)) nota = 55;
      if (nota > (mejor?.nota ?? 0) || (nota === mejor?.nota && ruta.length < mejor.ruta.length)) mejor = { ruta, nota };
    }
  }
  return mejor && mejor.nota >= 55 ? mejor.ruta : null;
}

export function existeImagen(rel: string) {
  const r = rel && rutaValida(rel) ? rutaReal(rel) : null;
  return !!r && existsSync(r);
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

// Iconos de la carta que vienen con el programa (banco-imagenes/Carta): se copian al banco
// de imágenes del local si faltan o han cambiado, para que la carta de demostración los tenga.
const ICONOS_PROGRAMA = fileURLToPath(new URL('../banco-imagenes/', import.meta.url));
export function instalarIconosCarta() {
  let copiados = 0;
  try {
    for (const sub of readdirSync(ICONOS_PROGRAMA)) {
      const origen = join(ICONOS_PROGRAMA, sub);
      if (!statSync(origen).isDirectory()) continue;
      mkdirSync(join(carpeta, sub), { recursive: true });
      for (const f of readdirSync(origen)) {
        const de = join(origen, f), a = join(carpeta, sub, f);
        if (!existsSync(a) || statSync(a).size !== statSync(de).size) { copyFileSync(de, a); copiados++; }
      }
    }
  } catch (e) {
    console.error('No se pudieron copiar los iconos de la carta:', e);
  }
  if (copiados) cache = null;
  return copiados;
}
