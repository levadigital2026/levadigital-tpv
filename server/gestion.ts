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

export function actualizar(db: DB, tabla: string, id: number, datos: Record<string, unknown>) {
  comprobarTabla(tabla);
  const v = limpiar(tabla, datos, false);
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

export function getEmpresa(db: DB) {
  return db.prepare('SELECT * FROM empresa WHERE id = 1').get();
}

export function setEmpresa(db: DB, datos: Record<string, unknown>) {
  for (const k of ['nombre', 'nif', 'direccion', 'serie_tickets']) {
    if (k in datos) db.prepare(`UPDATE empresa SET ${k} = ? WHERE id = 1`).run(String(datos[k] ?? '').trim());
  }
  return getEmpresa(db);
}
