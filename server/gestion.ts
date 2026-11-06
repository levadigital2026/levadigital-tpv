// Mantenimiento de tablas: departamentos, familias, artículos, zonas, mesas, formas de cobro y empresa.
import { type DB, ACCIONES, PERMISOS } from './db.ts';
import { ErrorTPV, SECCIONES_CIERRE } from './ventas.ts';
import { rutaValida, CODIGOS_ALERGENOS, buscarImagenPara, existeImagen, instalarIconosCarta } from './imagenes.ts';
import { readFileSync } from 'node:fs';

type Campo = { tipo: 'texto' | 'entero' | 'decimal' | 'bool' | 'ref' | 'imagen' | 'color' | 'alergenos' | 'lista'; obligatorio?: boolean; valores?: string[] };

// Campos que se pueden escribir desde la API para cada tabla.
export const TABLAS: Record<string, Record<string, Campo>> = {
  departamentos: { nombre: { tipo: 'texto', obligatorio: true } },
  familias: {
    nombre: { tipo: 'texto', obligatorio: true }, color: { tipo: 'texto' }, orden: { tipo: 'entero' },
    padre_id: { tipo: 'ref' }, departamento_id: { tipo: 'ref' },
    imagen: { tipo: 'imagen' }, color_fondo: { tipo: 'color' }, color_texto: { tipo: 'color' }, impresoras: { tipo: 'texto' },
  },
  articulos: {
    nombre: { tipo: 'texto', obligatorio: true }, precio: { tipo: 'entero' }, iva: { tipo: 'decimal' },
    familia_id: { tipo: 'ref' }, grupo_cocina: { tipo: 'entero' }, orden_plato_id: { tipo: 'ref' }, orden: { tipo: 'entero' }, activo: { tipo: 'bool' },
    imagen: { tipo: 'imagen' }, color_fondo: { tipo: 'color' }, color_texto: { tipo: 'color' }, alergenos: { tipo: 'alergenos' },
    controlar_stock: { tipo: 'bool' }, stock_minimo: { tipo: 'decimal' }, coste: { tipo: 'entero' }, codigo_barras: { tipo: 'texto' },
    por_peso: { tipo: 'bool' }, impresoras: { tipo: 'texto' },
  },
  clientes: {
    nombre: { tipo: 'texto', obligatorio: true }, apellidos: { tipo: 'texto' }, apodo: { tipo: 'texto' }, nif: { tipo: 'texto' },
    tipo_nif: { tipo: 'texto', valores: ['nif', 'nie', 'pasaporte', 'extranjero'] }, pais: { tipo: 'texto' }, domicilio: { tipo: 'texto' },
    localidad: { tipo: 'texto' }, cp: { tipo: 'texto' }, provincia: { tipo: 'texto' }, telefono: { tipo: 'texto' }, telefono2: { tipo: 'texto' },
    email: { tipo: 'texto' }, observaciones: { tipo: 'texto' }, descuento: { tipo: 'decimal' }, tarjeta: { tipo: 'texto' },
  },
  proveedores: {
    nombre: { tipo: 'texto', obligatorio: true }, nif: { tipo: 'texto' }, telefono: { tipo: 'texto' }, email: { tipo: 'texto' },
    direccion: { tipo: 'texto' }, contacto: { tipo: 'texto' }, observaciones: { tipo: 'texto' },
  },
  zonas: { nombre: { tipo: 'texto', obligatorio: true }, tipo: { tipo: 'texto', valores: ['barra', 'mesas'] }, orden: { tipo: 'entero' }, color_fondo: { tipo: 'color' } },
  mesas: {
    zona_id: { tipo: 'ref', obligatorio: true }, nombre: { tipo: 'texto', obligatorio: true }, x: { tipo: 'entero' }, y: { tipo: 'entero' },
    forma: { tipo: 'texto', valores: ['cuadrada', 'rectangular', 'redonda'] }, plazas: { tipo: 'entero' },
  },
  formas_cobro: {
    nombre: { tipo: 'texto', obligatorio: true }, tipo: { tipo: 'texto', valores: ['efectivo', 'tarjeta', 'pendiente', 'otro'] },
    activa: { tipo: 'bool' }, orden: { tipo: 'entero' },
  },
  operarios: {
    nombre: { tipo: 'texto', obligatorio: true }, pin: { tipo: 'texto' }, rfid: { tipo: 'texto' },
    permisos: { tipo: 'lista', valores: Object.keys(PERMISOS) }, orden: { tipo: 'entero' },
  },
  ordenes_plato: { nombre: { tipo: 'texto', obligatorio: true }, orden: { tipo: 'entero' } },
  ivas: {
    nombre: { tipo: 'texto', obligatorio: true }, codigo: { tipo: 'texto' }, porcentaje: { tipo: 'decimal', obligatorio: true },
    recargo: { tipo: 'decimal' }, orden: { tipo: 'entero' },
  },
  puestos: {
    nombre: { tipo: 'texto', obligatorio: true }, tipo: { tipo: 'texto', valores: ['tpv', 'pda', 'kds'] },
    impresora_tickets_id: { tipo: 'ref' }, orden: { tipo: 'entero' },
    usar_permisos: { tipo: 'bool' }, pedir_operario: { tipo: 'bool' },
    serie_tickets: { tipo: 'texto' }, serie_facturas: { tipo: 'texto' },
    mail_en_cierre: { tipo: 'bool' }, email_cierre: { tipo: 'texto' }, smtp_servidor: { tipo: 'texto' }, smtp_puerto: { tipo: 'entero' },
    smtp_cifrado: { tipo: 'texto', valores: ['ninguno', 'tls', 'ssl'] }, smtp_usuario: { tipo: 'texto' }, smtp_clave: { tipo: 'texto' },
    email_emisor: { tipo: 'texto' }, email_asunto: { tipo: 'texto' }, email_encabezado: { tipo: 'texto' }, email_pie: { tipo: 'texto' },
    cierre_ciego: { tipo: 'bool' }, imprimir_cierre: { tipo: 'bool' }, cierre_secciones: { tipo: 'lista', valores: Object.keys(SECCIONES_CIERRE) },
  },
  impresoras: {
    nombre: { tipo: 'texto', obligatorio: true }, ip: { tipo: 'texto' }, puerto: { tipo: 'entero' },
    uso: { tipo: 'texto', valores: ['tickets', 'cocina', 'barra', 'otro'] }, departamento_id: { tipo: 'ref' },
    envio: { tipo: 'texto', valores: ['auto', 'manual'] },
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
      case 'imagen': {
        const s = String(v ?? '').trim();
        if (s && !rutaValida(s)) throw new ErrorTPV('Imagen no válida');
        out[k] = s;
        break;
      }
      case 'lista': {
        const lista = (Array.isArray(v) ? v : String(v ?? '').split(',')).map(x => String(x).trim()).filter(Boolean);
        if (lista.some(x => !c.valores!.includes(x))) throw new ErrorTPV(`Valor no válido en ${k}`);
        out[k] = [...new Set(lista)].join(',');
        break;
      }
      case 'alergenos': {
        const lista = (Array.isArray(v) ? v : String(v ?? '').split(',')).map(x => String(x).trim()).filter(Boolean);
        if (lista.some(x => !CODIGOS_ALERGENOS.has(x))) throw new ErrorTPV('Alérgeno desconocido');
        out[k] = [...new Set(lista)].join(',');
        break;
      }
      case 'color': {
        const s = String(v ?? '').trim().toLowerCase();
        if (s && !/^#[0-9a-f]{6}$/.test(s)) throw new ErrorTPV(`Color no válido en ${k}`);
        out[k] = s;
        break;
      }
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

export const CLAVE_OCULTA = '••••••';
export function listar(db: DB, tabla: string) {
  comprobarTabla(tabla);
  const orden = 'orden' in TABLAS[tabla] ? 'orden, id' : tabla === 'clientes' || tabla === 'proveedores' ? 'nombre COLLATE NOCASE' : 'id';
  const filas = db.prepare(`SELECT * FROM ${tabla} ${tabla === 'mesas' ? 'WHERE activa = 1' : ''} ORDER BY ${orden}`).all() as Record<string, any>[];
  // La contraseña del correo no sale nunca del servidor.
  if (tabla === 'puestos') for (const f of filas) f.smtp_clave = f.smtp_clave ? CLAVE_OCULTA : '';
  return filas;
}

// Una pulsera RFID solo puede ser de un operario.
function rfidLibre(db: DB, tabla: string, v: Record<string, unknown>, id: number | null) {
  if (tabla !== 'operarios' || !v.rfid) return;
  const otro = db.prepare('SELECT nombre FROM operarios WHERE rfid = ? AND id IS NOT ?').get(v.rfid, id) as { nombre: string } | undefined;
  if (otro) throw new ErrorTPV(`Esa pulsera ya es de ${otro.nombre}`);
}

// Impresoras de comanda: lista de ids. En un artículo, vacío = las de su familia y 'ninguna' = no se imprime.
function normalizarImpresoras(v: Record<string, unknown>) {
  if (typeof v.impresoras !== 'string') return;
  const p = v.impresoras.split(',').map(x => x.trim()).filter(Boolean);
  v.impresoras = p.includes('ninguna') ? 'ninguna' : [...new Set(p.filter(x => /^\d+$/.test(x)))].join(',');
}

export function crear(db: DB, tabla: string, datos: Record<string, unknown>) {
  comprobarTabla(tabla);
  const v = limpiar(tabla, datos, true);
  normalizarImpresoras(v);
  rfidLibre(db, tabla, v, null);
  const cols = Object.keys(v);
  const r = db.prepare(`INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(v));
  const fila = db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(Number(r.lastInsertRowid)) as Record<string, any>;
  if (tabla === 'puestos') fila.smtp_clave = fila.smtp_clave ? CLAVE_OCULTA : '';
  return fila;
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
  normalizarImpresoras(v);
  if (tabla === 'puestos' && v.smtp_clave === CLAVE_OCULTA) delete v.smtp_clave;
  rfidLibre(db, tabla, v, id);
  if (tabla === 'familias' && v.padre_id != null) evitarCiclo(db, id, Number(v.padre_id));
  const cols = Object.keys(v);
  if (cols.length) {
    const r = db.prepare(`UPDATE ${tabla} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(v), id);
    if (r.changes === 0) throw new ErrorTPV('No existe', 404);
  }
  const fila = db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id) as Record<string, any> | undefined;
  if (!fila) throw new ErrorTPV('No existe', 404);
  if (tabla === 'puestos') fila.smtp_clave = fila.smtp_clave ? CLAVE_OCULTA : '';
  return fila;
}

// Guarda un orden nuevo: el primer id pasa a orden 1, el segundo a 2...
export function ordenar(db: DB, tabla: string, datos: { ids?: unknown }) {
  comprobarTabla(tabla);
  if (!('orden' in TABLAS[tabla])) throw new ErrorTPV('Esta tabla no se puede ordenar');
  const ids = Array.isArray(datos?.ids) ? datos.ids.map(Number) : [];
  if (!ids.length || ids.some(n => !Number.isInteger(n)) || new Set(ids).size !== ids.length) throw new ErrorTPV('Lista de orden no válida');
  const upd = db.prepare(`UPDATE ${tabla} SET orden = ? WHERE id = ?`);
  db.exec('BEGIN');
  try {
    ids.forEach((id, i) => upd.run(i + 1, id));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ordenados: ids.length };
}

// Pone imagen a los artículos que no la tienen (o cuya imagen ya no existe) buscando por el nombre.
export async function imagenesAutomaticas(db: DB, datos: { todos?: boolean }) {
  const arts = db.prepare('SELECT id, nombre, imagen FROM articulos WHERE activo = 1 ORDER BY nombre').all() as { id: number; nombre: string; imagen: string }[];
  const puestas: { nombre: string; imagen: string }[] = [];
  const sin: string[] = [];
  const upd = db.prepare('UPDATE articulos SET imagen = ? WHERE id = ?');
  for (const a of arts) {
    if (!datos?.todos && a.imagen && existeImagen(a.imagen)) continue;
    const r = await buscarImagenPara(a.nombre);
    if (r) { upd.run(r, a.id); puestas.push({ nombre: a.nombre, imagen: r }); }
    else {
      if (a.imagen && !existeImagen(a.imagen)) upd.run('', a.id);
      sin.push(a.nombre);
    }
  }
  return { puestas, sin };
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
  if (tabla === 'mesas' && db.prepare('SELECT 1 FROM cuentas WHERE mesa_id = ?').get(id)) {
    if (db.prepare("SELECT 1 FROM cuentas WHERE mesa_id = ? AND estado = 'abierta'").get(id)) throw new ErrorTPV('La mesa tiene una cuenta abierta');
    db.prepare('UPDATE mesas SET activa = 0 WHERE id = ?').run(id);
    return { desactivado: true };
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
export const ASPECTO: Record<string, [string, string, 'num' | 'color' | 'lado', number, number, number | string, string]> = {
  mano: ['Zonas de la pantalla', 'Botonera y Cobrar en el lado', 'lado', 0, 0, 'derecha', ''],
  cuenta_pct: ['Zonas de la pantalla', 'Ancho de la cuenta', 'num', 18, 45, 26, '%'],
  familias_px: ['Zonas de la pantalla', 'Ancho de la columna de familias', 'num', 120, 420, 210, 'px'],
  botonera_px: ['Zonas de la pantalla', 'Ancho de la botonera', 'num', 160, 460, 250, 'px'],
  botonera_cols: ['Botonera', 'Botones por fila', 'num', 1, 6, 2, ''],
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
    else if (tipo === 'lado') out[k] = v === 'izquierda' ? 'izquierda' : 'derecha';
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
    } else if (tipo === 'lado') {
      if (v !== 'derecha' && v !== 'izquierda') throw new ErrorTPV(`${etiqueta}: elige derecha o izquierda`);
      out[k] = v;
    } else {
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new ErrorTPV(`${etiqueta}: color no válido`);
      out[k] = v.toLowerCase();
    }
  }
  db.prepare('UPDATE empresa SET aspecto = ? WHERE id = 1').run(JSON.stringify(out));
  return getAspecto(db);
}

export function getEmpresa(db: DB) {
  const { licencia, ...e } = db.prepare('SELECT * FROM empresa WHERE id = 1').get() as Record<string, any>;
  return e;
}

export function setEmpresa(db: DB, datos: Record<string, unknown>) {
  for (const k of ['nombre', 'nif', 'direccion', 'localidad', 'telefono', 'email', 'serie_tickets', 'serie_facturas']) {
    if (k in datos) db.prepare(`UPDATE empresa SET ${k} = ? WHERE id = 1`).run(String(datos[k] ?? '').trim());
  }
  return getEmpresa(db);
}

// Carta de demostración: sustituye todas las familias y artículos por los de server/carta-demo.json.
export function cargarCartaDemo(db: DB) {
  const abiertas = (db.prepare("SELECT COUNT(*) AS n FROM lineas l JOIN cuentas c ON c.id = l.cuenta_id WHERE c.estado = 'abierta'").get() as { n: number }).n;
  if (abiertas) throw new ErrorTPV('Hay cuentas abiertas con artículos: cóbralas o bórralas antes de cargar la carta');
  const carta = JSON.parse(readFileSync(new URL('./carta-demo.json', import.meta.url), 'utf8')) as {
    familias: { id: number; nombre: string; color: string; departamento: string; orden_plato: string; imagen: string; orden: number }[];
    articulos: { id: number; nombre: string; precio: number; familia_id: number; imagen: string }[];
  };
  instalarIconosCarta();
  db.exec('BEGIN');
  try {
    // Lo ya vendido no apunta a los artículos que se borran (los tickets guardan su descripción).
    db.prepare('UPDATE lineas SET articulo_id = NULL').run();
    db.prepare('UPDATE ticket_lineas SET articulo_id = NULL').run();
    db.prepare('DELETE FROM comentarios WHERE familia_id IS NOT NULL OR articulo_id IS NOT NULL').run();
    db.prepare('DELETE FROM articulos').run();
    db.prepare('UPDATE familias SET padre_id = NULL').run();
    db.prepare('DELETE FROM familias').run();
    const dep = (nombre: string) => ((db.prepare('SELECT id FROM departamentos WHERE nombre = ?').get(nombre) as { id: number } | undefined)?.id
      ?? Number(db.prepare('INSERT INTO departamentos (nombre) VALUES (?)').run(nombre).lastInsertRowid));
    const plato = (nombre: string) => (db.prepare('SELECT id FROM ordenes_plato WHERE nombre = ?').get(nombre) as { id: number } | undefined)?.id ?? null;
    const platoDeFamilia = new Map<number, number | null>();
    const insF = db.prepare('INSERT INTO familias (id, nombre, color, orden, departamento_id, imagen) VALUES (?, ?, ?, ?, ?, ?)');
    for (const f of carta.familias) {
      insF.run(f.id, f.nombre, f.color, f.orden, dep(f.departamento), f.imagen);
      platoDeFamilia.set(f.id, plato(f.orden_plato));
    }
    const insA = db.prepare('INSERT INTO articulos (id, nombre, precio, iva, familia_id, orden, orden_plato_id, imagen) VALUES (?, ?, ?, 10, ?, ?, ?, ?)');
    carta.articulos.forEach((a, i) => insA.run(a.id, a.nombre, a.precio, a.familia_id, i + 1, platoDeFamilia.get(a.familia_id) ?? null, a.imagen));
    // Comentarios de ejemplo para los cafés.
    const cafes = carta.familias.find(f => f.nombre === 'CAFES');
    if (cafes) {
      const c = db.prepare('INSERT INTO comentarios (texto, familia_id, orden) VALUES (?, ?, ?)');
      ['Con hielo', 'Sin azúcar', 'Con sacarina', 'Corto de café', 'Largo de café', 'Leche fría', 'Leche sin lactosa'].forEach((t, i) => c.run(t, cafes.id, i + 1));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { familias: carta.familias.length, articulos: carta.articulos.length };
}
