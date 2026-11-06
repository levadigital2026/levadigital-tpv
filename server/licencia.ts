// Módulos con licencia: el TPV sale básico y cada módulo se activa con una licencia firmada por LevaDigital.
// La licencia va ligada al identificador de esta instalación (Configuración > Módulos activos).
// Formato: LEVA1.<datos en base64url>.<firma Ed25519 en base64url>
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { DB } from './db.ts';
import { ErrorTPV } from './ventas.ts';

export const MODULOS: Record<string, string> = {
  clientes: 'Clientes y facturas',
  stocks: 'Stocks, proveedores y albaranes',
  informes: 'Informes avanzados',
  efectivo: 'Máquinas de efectivo (CashDro)',
  scanner: 'Scanner de código de barras',
  impresoras: 'Impresoras auxiliares (cocina, barra)',
  pulseras: 'Lector de pulseras RFID',
  balanza: 'Balanza',
};

// Clave pública de LevaDigital (la privada solo la tiene LevaDigital y sirve para crear licencias).
let clave: KeyObject = createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0GAoSasDRnRZEuFjkjhL4d+GKM/LBTXNSwd1cjoGAYg=
-----END PUBLIC KEY-----`);
export function usarClavePublica(pem: string) { clave = createPublicKey(pem); }

type Datos = { i: string; m: string[]; c?: string; n?: string };

export function leerLicencia(codigo: string, instalacion: string): { ok: true; datos: Datos } | { ok: false; error: string } {
  const partes = String(codigo ?? '').trim().replace(/\s+/g, '').split('.');
  if (partes.length !== 3 || partes[0] !== 'LEVA1') return { ok: false, error: 'El código de licencia no es válido' };
  let datos: Datos;
  try {
    if (!verify(null, Buffer.from(partes[1]), clave, Buffer.from(partes[2], 'base64url'))) return { ok: false, error: 'La firma de la licencia no es válida' };
    datos = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'El código de licencia no es válido' };
  }
  if (datos.i !== instalacion) return { ok: false, error: 'Esta licencia es de otra instalación' };
  return { ok: true, datos };
}

const hoy = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

export function estadoLicencia(db: DB) {
  const e = db.prepare('SELECT instalacion, licencia FROM empresa WHERE id = 1').get() as { instalacion: string; licencia: string };
  const base = { instalacion: e.instalacion, modulos_disponibles: MODULOS, activos: [] as string[], caduca: '', titular: '', aviso: '' };
  if (!e.licencia) return base;
  const r = leerLicencia(e.licencia, e.instalacion);
  if (!r.ok) return { ...base, aviso: r.error };
  if (r.datos.c && r.datos.c < hoy()) return { ...base, caduca: r.datos.c, titular: r.datos.n ?? '', aviso: `La licencia caducó el ${r.datos.c}` };
  return { ...base, activos: r.datos.m.filter(m => m in MODULOS), caduca: r.datos.c ?? '', titular: r.datos.n ?? '' };
}

export function activarLicencia(db: DB, codigo: string) {
  const e = db.prepare('SELECT instalacion FROM empresa WHERE id = 1').get() as { instalacion: string };
  const r = leerLicencia(codigo, e.instalacion);
  if (!r.ok) throw new ErrorTPV(r.error);
  db.prepare('UPDATE empresa SET licencia = ? WHERE id = 1').run(String(codigo).trim().replace(/\s+/g, ''));
  return estadoLicencia(db);
}

export const moduloActivo = (db: DB, m: string) => estadoLicencia(db).activos.includes(m);

// Qué módulo pide cada petición.
export function moduloDe(metodo: string, ruta: string, body: any): string | null {
  if (/^\/api\/(clientes|facturas)(\/|$)/.test(ruta) || /^\/api\/gestion\/clientes(\/|$)/.test(ruta)) return 'clientes';
  if (/^\/api\/stocks(\/|$)/.test(ruta) || /^\/api\/gestion\/proveedores(\/|$)/.test(ruta)) return 'stocks';
  if (/^\/api\/informes\/(borrados|empleados)(\/|$)/.test(ruta)) return 'informes';
  if (metodo === 'POST' && ruta === '/api/operarios/entrar' && body?.rfid !== undefined) return 'pulseras';
  if (metodo === 'PATCH' && /^\/api\/cuentas\/\d+$/.test(ruta) && body?.cliente_id) return 'clientes';
  return null;
}

export function comprobarModulo(db: DB, metodo: string, ruta: string, body: any) {
  const m = moduloDe(metodo, ruta, body);
  if (m && !moduloActivo(db, m)) throw new ErrorTPV(`El módulo "${MODULOS[m]}" no está activo. Actívalo en Configuración > Módulos activos.`, 402);
}
