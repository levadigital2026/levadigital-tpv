// Registro de actividad (logs): cada cambio que se hace en el TPV y cada error.
// Se guarda en la base de datos (para verlo desde Configuración) y, si hay carpeta,
// en un fichero de texto por día: datos/registro/AAAA-MM-DD.log
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DB } from './db.ts';

let carpeta: string | null = null;
export function usarCarpetaRegistro(dir: string | null) {
  carpeta = dir;
  if (dir) mkdir(dir, { recursive: true }).catch(() => {});
}

// Nombre legible de lo que hace cada petición.
const ACCIONES: [string, RegExp, string][] = [
  ['POST', /^\/api\/cuentas$/, 'Abrir cuenta'],
  ['PATCH', /^\/api\/cuentas\/\d+$/, 'Cambiar datos de la cuenta'],
  ['POST', /^\/api\/cuentas\/\d+\/lineas$/, 'Añadir artículo'],
  ['DELETE', /^\/api\/cuentas\/\d+\/lineas$/, 'Borrar todo y cerrar la cuenta'],
  ['POST', /^\/api\/cuentas\/\d+\/cobrar$/, 'Cobrar cuenta'],
  ['PATCH', /^\/api\/lineas\/\d+$/, 'Modificar línea'],
  ['DELETE', /^\/api\/lineas\/\d+$/, 'Borrar línea'],
  ['POST', /^\/api\/tickets\/\d+\/anular$/, 'Anular ticket'],
  ['POST', /^\/api\/caja\/cierre$/, 'Cierre de caja'],
  ['PUT', /^\/api\/empresa$/, 'Cambiar datos de empresa'],
  ['PUT', /^\/api\/aspecto$/, 'Cambiar aspecto de la pantalla'],
  ['POST', /^\/api\/imagenes$/, 'Subir imagen'],
  ['POST', /^\/api\/gestion\/(\w+)\/ordenar$/, 'Configuración: cambiar el orden de $1'],
  ['POST', /^\/api\/gestion\/(\w+)$/, 'Configuración: crear en $1'],
  ['PUT', /^\/api\/gestion\/(\w+)\/\d+$/, 'Configuración: modificar $1'],
  ['DELETE', /^\/api\/gestion\/(\w+)\/\d+$/, 'Configuración: borrar en $1'],
];
export function describir(metodo: string, ruta: string) {
  for (const [m, re, texto] of ACCIONES) {
    const r = m === metodo && re.exec(ruta);
    if (r) return texto.replace('$1', r[1] ?? '');
  }
  return `${metodo} ${ruta}`;
}

// Campos que nunca se guardan en el registro.
const SECRETOS = new Set(['pin', 'clave', 'password', 'token']);
function resumirDatos(datos: unknown) {
  if (!datos || typeof datos !== 'object' || !Object.keys(datos).length) return '';
  const limpio = JSON.stringify(datos, (k, v) => (SECRETOS.has(k) ? '***' : typeof v === 'string' && v.startsWith('data:') ? '(archivo)' : v));
  return limpio.length > 500 ? limpio.slice(0, 500) + '…' : limpio;
}

export type Entrada = { nivel?: 'info' | 'aviso' | 'error'; accion: string; metodo?: string; ruta?: string; estado?: number; origen?: string; datos?: unknown };

export function registrar(db: DB, e: Entrada) {
  const fila = {
    nivel: e.nivel ?? 'info', accion: e.accion, metodo: e.metodo ?? '', ruta: e.ruta ?? '',
    estado: e.estado ?? 0, origen: e.origen ?? '', datos: resumirDatos(e.datos),
  };
  try {
    db.prepare('INSERT INTO registro (nivel, accion, metodo, ruta, estado, origen, datos) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(fila.nivel, fila.accion, fila.metodo, fila.ruta, fila.estado, fila.origen, fila.datos);
  } catch (err) {
    console.error('No se pudo guardar el registro:', err);
  }
  if (carpeta) {
    const ahora = new Date();
    const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString();
    const linea = [local.slice(0, 19).replace('T', ' '), fila.nivel.toUpperCase(), fila.origen, fila.estado || '', fila.accion,
      fila.metodo && `${fila.metodo} ${fila.ruta}`, fila.datos].filter(x => x !== '').join(' | ');
    appendFile(join(carpeta, `${local.slice(0, 10)}.log`), linea + '\n').catch(() => {});
  }
}

export function leerRegistro(db: DB, fecha?: string | null, texto?: string | null, nivel?: string | null) {
  const dia = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;
  const cond: string[] = [];
  const args: string[] = [];
  if (dia) { cond.push("fecha >= ? AND fecha < date(?, '+1 day')"); args.push(dia, dia); }
  if (nivel && ['info', 'aviso', 'error'].includes(nivel)) { cond.push('nivel = ?'); args.push(nivel); }
  if (texto?.trim()) {
    cond.push('(accion LIKE ? OR ruta LIKE ? OR datos LIKE ? OR origen LIKE ?)');
    const t = `%${texto.trim()}%`;
    args.push(t, t, t, t);
  }
  return db.prepare(`SELECT * FROM registro ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY id DESC LIMIT 1000`).all(...args);
}
