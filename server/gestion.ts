// Mantenimiento de tablas: departamentos, familias, artículos, zonas, mesas, formas de cobro y empresa.
import { type DB, ACCIONES } from './db.ts';
import { ErrorTPV } from './ventas.ts';

type Campo = { tipo: 'texto' | 'entero' | 'decimal' | 'bool' | 'ref'; obligatorio?: boolean; valores?: string[] };

// Campos que se pueden escribir desde la API para cada tabla.
export const TABLAS: Record<string, Record<string, Campo>> = {
  departamentos: { nombre: { tipo: 'texto', obligatorio: true } },
  familias: {
    nombre: { tipo: 'texto', obligatorio: true }, color: { tipo: 'texto' }, orden: { tipo: 'entero' },
    padre_id: { tipo: 'ref' }, departamento_id: { tipo: 'ref' },
  },
  articulos: {
    nombre: { tipo: 'texto', obligatorio: true }, precio: { tipo: 'entero' }, iva: { tipo: 'decimal' },
    familia_id: { tipo: 'ref' }, grupo_cocina: { tipo: 'entero' }, orden: { tipo: 'entero' }, activo: { tipo: 'bool' },
  },
  zonas: { nombre: { tipo: 'texto', obligatorio: true }, tipo: { tipo: 'texto', valores: ['barra', 'mesas'] }, orden: { tipo: 'entero' } },
  mesas: { zona_id: { tipo: 'ref', obligatorio: true }, nombre: { tipo: 'texto', obligatorio: true }, x: { tipo: 'entero' }, y: { tipo: 'entero' } },
  formas_cobro: {
    nombre: { tipo: 'texto', obligatorio: true }, tipo: { tipo: 'texto', valores: ['efectivo', 'tarjeta', 'pendiente', 'otro'] },
    activa: { tipo: 'bool' }, orden: { tipo: 'entero' },
  },
  operarios: { nombre: { tipo: 'texto', obligatorio: true }, pin: { tipo: 'texto' } },
  ivas: {
    nombre: { tipo: 'texto', obligatorio: true }, codigo: { tipo: 'texto' }, porcentaje: { tipo: 'decimal', obligatorio: true },
    recargo: { tipo: 'decimal' }, orden: { tipo: 'entero' },
  },
  puestos: {
    nombre: { tipo: 'texto', obligatorio: true }, tipo: { tipo: 'texto', valores: ['tpv', 'pda', 'kds'] },
    impresora_tickets_id: { tipo: 'ref' }, orden: { tipo: 'entero' },
  },
  impresoras: {
    nombre: { tipo: 'texto', obligatorio: true }, ip: { tipo: 'texto' }, puerto: { tipo: 'entero' },
    uso: { tipo: 'texto', valores: ['tickets', 'cocina', 'barra', 'otro'] }, departamento_id: { tipo: 'ref' },
    activa: { tipo: 'bool' }, orden: { tipo: 'entero' },
  },
  conceptos_pago: { nombre: { tipo: 'texto', obligatorio: true }, orden: { tipo: 'entero' } },
  comentarios: { texto: { tipo: 'texto', obligatorio: true }, familia_id: { tipo: 'ref' }, articulo_id: { tipo: 'ref' }, orden: { tipo: 'entero' } },
  botones: {
    accion: { tipo: 'texto', obligatorio: true, valores: Object.keys(ACCIONES) }, texto: { tipo: 'texto', obligatorio: true },
    color: { tipo: 'texto' }, orden: { tipo: 'entero' }, visible: { tipo: 'bool' },
  },
};

function limpiar(tabla: string, datos: Record<string, unknown>, nuevo: boolean) {
  const campos = TABLAS[tabla];
  const out: Record<string, string | number | null> = {};
  for (const [k, c] of Object.entries(campos)) {
    if (!(k in datos)) {
      if (nuevo && c.obligatorio) throw new ErrorTPV(`Falta el campo ${k}`);
      continue;
    }
    const v = datos[k];
    switch (c.tipo) {
      case 'texto': {
        const s = String(v ?? '').trim();
        if (c.obligatorio && !s) throw new ErrorTPV(`El campo ${k} no puede estar vacío`);
        if (c.valores && !c.valores.includes(s)) throw new ErrorTPV(`Valor no válido para ${k}`);
        out[k] = s;
        break;
      }
      case 'entero': {
        const n = Number(v);
        if (!Number.isInteger(n)) throw new ErrorTPV(`El campo ${k} debe ser un número entero`);
        out[k] = n;
        break;
      }
      case 'decimal': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new ErrorTPV(`El campo ${k} debe ser un número`);
        out[k] = n;
        break;
      }
      case 'bool':
        out[k] = v ? 1 : 0;
        break;
      case 'ref':
        if (v === null || v === '' || v === undefined) {
          if (c.obligatorio) throw new ErrorTPV(`Falta el campo ${k}`);
          out[k] = null;
        } else {
          const n = Number(v);
          if (!Number.isInteger(n)) throw new ErrorTPV(`Referencia no válida en ${k}`);
          out[k] = n;
        }
        break;
    }
  }
  return out;
}

function comprobarTabla(tabla: string) {
  if (!TABLAS[tabla]) throw new ErrorTPV('Tabla desconocida', 404);
}

export function listar(db: DB, tabla: string) {
  comprobarTabla(tabla);
  const orden = 'orden' in TABLAS[tabla] ? 'orden, id' : 'id';
  return db.prepare(`SELECT * FROM ${tabla} ORDER BY ${orden}`).all();
}

export function crear(db: DB, tabla: string, datos: Record<string, unknown>) {
  comprobarTabla(tabla);
  const v = limpiar(tabla, datos, true);
  const cols = Object.keys(v);
  const r = db.prepare(`INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(v));
  return db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(Number(r.lastInsertRowid));
}

// El botón de configuración es la única entrada a la configuración: no se puede ocultar ni borrar.
function protegerConfiguracion(db: DB, tabla: string, id: number, v?: Record<string, unknown>) {
  if (tabla !== 'botones') return;
  const b = db.prepare('SELECT accion FROM botones WHERE id = ?').get(id) as { accion: string } | undefined;
  if (b?.accion !== 'configuracion') return;
  if (!v || v.visible === 0 || (v.accion !== undefined && v.accion !== 'configuracion')) {
    throw new ErrorTPV('El botón de configuración no se puede quitar, porque es la entrada a la configuración');
  }
}

// Una familia no puede ser subfamilia de sí misma ni de una de sus subfamilias.
function evitarCiclo(db: DB, id: number, padreId: number) {
  const padreDe = db.prepare('SELECT padre_id FROM familias WHERE id = ?');
  for (let p: number | null = padreId, n = 0; p != null && n < 50; n++) {
    if (p === id) throw new ErrorTPV('Una familia no puede estar dentro de sí misma ni de sus subfamilias');
    p = (padreDe.get(p) as { padre_id: number | null } | undefined)?.padre_id ?? null;
  }
}

export function actualizar(db: DB, tabla: string, id: number, datos: Record<string, unknown>) {
  comprobarTabla(tabla);
  const v = limpiar(tabla, datos, false);
  protegerConfiguracion(db, tabla, id, v);
  if (tabla === 'familias' && v.padre_id != null) evitarCiclo(db, id, Number(v.padre_id));
  const cols = Object.keys(v);
  if (cols.length) {
    const r = db.prepare(`UPDATE ${tabla} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(v), id);
    if (r.changes === 0) throw new ErrorTPV('No existe', 404);
  }
  const fila = db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id);
  if (!fila) throw new ErrorTPV('No existe', 404);
  return fila;
}

export function borrar(db: DB, tabla: string, id: number) {
  comprobarTabla(tabla);
  protegerConfiguracion(db, tabla, id);
  if (tabla === 'articulos') {
    // Un artículo ya vendido no se borra: se desactiva para conservar el histórico.
    const usado = db.prepare('SELECT 1 FROM lineas WHERE articulo_id = ? UNION SELECT 1 FROM ticket_lineas WHERE articulo_id = ?').get(id, id);
    if (usado) {
      db.prepare('UPDATE articulos SET activo = 0 WHERE id = ?').run(id);
      return { desactivado: true };
    }
  }
  try {
    db.prepare(`DELETE FROM ${tabla} WHERE id = ?`).run(id);
  } catch {
    throw new ErrorTPV('No se puede borrar porque está en uso');
  }
  return { borrado: true };
}

// Aspecto de la pantalla de venta: tamaños de zonas y botones, y colores.
// [grupo, etiqueta, tipo, mínimo, máximo, por defecto, unidad]
export const ASPECTO: Record<string, [string, string, 'num' | 'color', number, number, number | string, string]> = {
  cuenta_pct: ['Zonas de la pantalla', 'Ancho de la cuenta y botonera', 'num', 20, 50, 30, '%'],
  familias_px: ['Zonas de la pantalla', 'Ancho de la columna de familias', 'num', 120, 420, 230, 'px'],
  botonera_cols: ['Botonera', 'Botones por fila', 'num', 1, 6, 3, ''],
  botonera_alto: ['Botonera', 'Alto de los botones', 'num', 30, 100, 40, 'px'],
  botonera_letra: ['Botonera', 'Tamaño de letra', 'num', 10, 24, 14, 'px'],
  familias_alto: ['Familias', 'Alto de los botones', 'num', 36, 120, 60, 'px'],
  familias_letra: ['Familias', 'Tamaño de letra', 'num', 12, 28, 17, 'px'],
  articulos_ancho: ['Artículos', 'Ancho de los botones', 'num', 80, 280, 120, 'px'],
  articulos_alto: ['Artículos', 'Alto de los botones', 'num', 50, 200, 86, 'px'],
  articulos_letra: ['Artículos', 'Tamaño de letra', 'num', 12, 26, 15, 'px'],
  color_principal: ['Colores', 'Color principal (seleccionado)', 'color', 0, 0, '#0064fc', ''],
  color_cabecera: ['Colores', 'Color de la barra de arriba', 'color', 0, 0, '#0b1527', ''],
  color_cobrar: ['Colores', 'Color del botón Cobrar', 'color', 0, 0, '#2e9d4f', ''],
};

export function getAspecto(db: DB) {
  const fila = db.prepare('SELECT aspecto FROM empresa WHERE id = 1').get() as { aspecto: string } | undefined;
  let guardado: Record<string, unknown> = {};
  try { guardado = JSON.parse(fila?.aspecto || '{}'); } catch {}
  const out: Record<string, number | string> = {};
  for (const [k, [, , tipo, min, max, def]] of Object.entries(ASPECTO)) {
    const v = guardado[k];
    if (tipo === 'num') out[k] = typeof v === 'number' && v >= min && v <= max ? v : (def as number);
    else out[k] = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : (def as string);
  }
  return out;
}

export function setAspecto(db: DB, datos: Record<string, unknown>) {
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(datos ?? {})) {
    const def = ASPECTO[k];
    if (!def) continue;
    const [, etiqueta, tipo, min, max] = def;
    if (tipo === 'num') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) throw new ErrorTPV(`${etiqueta}: debe estar entre ${min} y ${max}`);
      out[k] = Math.round(n);
    } else {
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new ErrorTPV(`${etiqueta}: color no válido`);
      out[k] = v.toLowerCase();
    }
  }
  db.prepare('UPDATE empresa SET aspecto = ? WHERE id = 1').run(JSON.stringify(out));
  return getAspecto(db);
}

export function getEmpresa(db: DB) {
  return db.prepare('SELECT * FROM empresa WHERE id = 1').get();
}

export function setEmpresa(db: DB, datos: Record<string, unknown>) {
  for (const k of ['nombre', 'nif', 'direccion', 'serie_tickets']) {
    if (k in datos) db.prepare(`UPDATE empresa SET ${k} = ? WHERE id = 1`).run(String(datos[k] ?? '').trim());
  }
  return getEmpresa(db);
}
