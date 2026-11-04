// Lógica de ventas: cuentas, líneas, cobro, anulación y cierre de caja.
import { createHash } from 'node:crypto';
import { type DB, tx } from './db.ts';

export class ErrorTPV extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Row = Record<string, any>;

export function importeLinea(l: { unidades: number; precio: number }): number {
  return Math.round(l.unidades * l.precio);
}

export function getCuenta(db: DB, id: number) {
  const cuenta = db.prepare(`
    SELECT c.*, z.nombre AS zona_nombre, z.tipo AS zona_tipo, m.nombre AS mesa_nombre
    FROM cuentas c JOIN zonas z ON z.id = c.zona_id LEFT JOIN mesas m ON m.id = c.mesa_id
    WHERE c.id = ?`).get(id) as Row | undefined;
  if (!cuenta) throw new ErrorTPV('La cuenta no existe', 404);
  const lineas = db.prepare('SELECT * FROM lineas WHERE cuenta_id = ? ORDER BY id').all(id) as Row[];
  const total = lineas.reduce((s, l) => s + importeLinea(l as any), 0);
  return { ...cuenta, lineas, total };
}

export function cuentasAbiertas(db: DB) {
  const rows = db.prepare(`
    SELECT c.id, c.nombre, c.zona_id, c.mesa_id, c.comensales, c.abierta_en,
           z.nombre AS zona_nombre, m.nombre AS mesa_nombre,
           COALESCE((SELECT SUM(ROUND(l.unidades * l.precio)) FROM lineas l WHERE l.cuenta_id = c.id), 0) AS total
    FROM cuentas c JOIN zonas z ON z.id = c.zona_id LEFT JOIN mesas m ON m.id = c.mesa_id
    WHERE c.estado = 'abierta' ORDER BY c.abierta_en`).all();
  return rows;
}

// Abre una cuenta nueva. Si la mesa ya tiene una cuenta abierta, devuelve esa.
export function abrirCuenta(db: DB, datos: { zona_id: number; mesa_id?: number | null; nombre?: string; comensales?: number }) {
  const zona = db.prepare('SELECT * FROM zonas WHERE id = ?').get(datos.zona_id) as Row | undefined;
  if (!zona) throw new ErrorTPV('La zona no existe');
  if (datos.mesa_id) {
    const mesa = db.prepare('SELECT * FROM mesas WHERE id = ? AND zona_id = ?').get(datos.mesa_id, datos.zona_id);
    if (!mesa) throw new ErrorTPV('La mesa no pertenece a esa zona');
    const abierta = db.prepare("SELECT id FROM cuentas WHERE mesa_id = ? AND estado = 'abierta'").get(datos.mesa_id) as Row | undefined;
    if (abierta) return getCuenta(db, abierta.id);
  }
  const r = db.prepare('INSERT INTO cuentas (zona_id, mesa_id, nombre, comensales) VALUES (?, ?, ?, ?)')
    .run(datos.zona_id, datos.mesa_id ?? null, datos.nombre ?? '', datos.comensales ?? 0);
  return getCuenta(db, Number(r.lastInsertRowid));
}

function cuentaAbierta(db: DB, id: number): Row {
  const c = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(id) as Row | undefined;
  if (!c) throw new ErrorTPV('La cuenta no existe', 404);
  if (c.estado !== 'abierta') throw new ErrorTPV('La cuenta ya está cerrada');
  return c;
}

export function actualizarCuenta(db: DB, id: number, datos: { nombre?: string; comensales?: number }) {
  cuentaAbierta(db, id);
  if (datos.nombre !== undefined) db.prepare('UPDATE cuentas SET nombre = ? WHERE id = ?').run(String(datos.nombre), id);
  if (datos.comensales !== undefined) db.prepare('UPDATE cuentas SET comensales = ? WHERE id = ?').run(Number(datos.comensales), id);
  return getCuenta(db, id);
}

export function anadirLinea(db: DB, cuentaId: number, datos: { articulo_id: number; unidades?: number }) {
  cuentaAbierta(db, cuentaId);
  const a = db.prepare('SELECT * FROM articulos WHERE id = ? AND activo = 1').get(datos.articulo_id) as Row | undefined;
  if (!a) throw new ErrorTPV('El artículo no existe');
  const unidades = datos.unidades ?? 1;
  if (!(unidades > 0)) throw new ErrorTPV('Las unidades deben ser mayores que 0');
  db.prepare(`INSERT INTO lineas (cuenta_id, articulo_id, descripcion, unidades, precio, iva, grupo_cocina)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(cuentaId, a.id, a.nombre, unidades, a.precio, a.iva, a.grupo_cocina);
  return getCuenta(db, cuentaId);
}

export function modificarLinea(db: DB, lineaId: number, datos: { unidades?: number; precio?: number; detalle?: string }) {
  const l = db.prepare('SELECT * FROM lineas WHERE id = ?').get(lineaId) as Row | undefined;
  if (!l) throw new ErrorTPV('La línea no existe', 404);
  cuentaAbierta(db, l.cuenta_id);
  if (datos.unidades !== undefined) {
    if (!(datos.unidades > 0)) throw new ErrorTPV('Las unidades deben ser mayores que 0');
    db.prepare('UPDATE lineas SET unidades = ? WHERE id = ?').run(datos.unidades, lineaId);
  }
  if (datos.precio !== undefined) {
    if (!Number.isInteger(datos.precio) || datos.precio < 0) throw new ErrorTPV('Precio no válido');
    db.prepare('UPDATE lineas SET precio = ? WHERE id = ?').run(datos.precio, lineaId);
  }
  if (datos.detalle !== undefined) db.prepare('UPDATE lineas SET detalle = ? WHERE id = ?').run(String(datos.detalle), lineaId);
  return getCuenta(db, l.cuenta_id);
}

export function borrarLinea(db: DB, lineaId: number) {
  const l = db.prepare('SELECT * FROM lineas WHERE id = ?').get(lineaId) as Row | undefined;
  if (!l) throw new ErrorTPV('La línea no existe', 404);
  cuentaAbierta(db, l.cuenta_id);
  db.prepare('DELETE FROM lineas WHERE id = ?').run(lineaId);
  return getCuenta(db, l.cuenta_id);
}

// Huella encadenada: cada ticket incluye la huella del anterior, así no se puede
// borrar ni cambiar un ticket sin que se note. El formato definitivo lo fijará
// TicketBAI/Verifactu en la fase 4.
export function calcularHuella(anterior: string, t: { serie: string; numero: number; emitido_en: string; total: number }) {
  return createHash('sha256')
    .update([anterior, t.serie, t.numero, t.emitido_en, t.total].join('|'))
    .digest('hex');
}

function emitirTicket(db: DB, datos: {
  cuenta_id: number | null; total: number; forma_cobro_id: number; entregado: number; cambio: number;
  anula_ticket_id?: number | null; lineas: { articulo_id: number | null; descripcion: string; unidades: number; precio: number; iva: number }[];
}) {
  const empresa = db.prepare('SELECT serie_tickets FROM empresa WHERE id = 1').get() as Row;
  const serie = empresa.serie_tickets;
  const ultimo = db.prepare('SELECT numero, huella FROM tickets WHERE serie = ? ORDER BY numero DESC LIMIT 1').get(serie) as Row | undefined;
  const numero = (ultimo?.numero ?? 0) + 1;
  const anterior = ultimo?.huella ?? '';
  const emitido_en = new Date().toISOString();
  const huella = calcularHuella(anterior, { serie, numero, emitido_en, total: datos.total });
  const r = db.prepare(`INSERT INTO tickets (serie, numero, cuenta_id, emitido_en, total, forma_cobro_id, entregado, cambio, anula_ticket_id, huella_anterior, huella)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(serie, numero, datos.cuenta_id, emitido_en, datos.total, datos.forma_cobro_id, datos.entregado, datos.cambio, datos.anula_ticket_id ?? null, anterior, huella);
  const ticketId = Number(r.lastInsertRowid);
  const ins = db.prepare('INSERT INTO ticket_lineas (ticket_id, articulo_id, descripcion, unidades, precio, iva, importe) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const l of datos.lineas) ins.run(ticketId, l.articulo_id, l.descripcion, l.unidades, l.precio, l.iva, importeLinea(l));
  return ticketId;
}

export function cobrarCuenta(db: DB, cuentaId: number, datos: { forma_cobro_id: number; entregado?: number }) {
  return tx(db, () => {
    cuentaAbierta(db, cuentaId);
    const fc = db.prepare('SELECT * FROM formas_cobro WHERE id = ? AND activa = 1').get(datos.forma_cobro_id) as Row | undefined;
    if (!fc) throw new ErrorTPV('Forma de cobro no válida');
    const cuenta = getCuenta(db, cuentaId);
    if (cuenta.lineas.length === 0) throw new ErrorTPV('La cuenta está vacía');
    const total = cuenta.total;
    let entregado = total, cambio = 0;
    if (fc.tipo === 'efectivo' && datos.entregado !== undefined && datos.entregado > 0) {
      if (datos.entregado < total) throw new ErrorTPV('El importe entregado es menor que el total');
      entregado = datos.entregado;
      cambio = entregado - total;
    }
    const ticketId = emitirTicket(db, {
      cuenta_id: cuentaId, total, forma_cobro_id: fc.id, entregado, cambio,
      lineas: cuenta.lineas as any,
    });
    db.prepare("UPDATE cuentas SET estado = 'cobrada', cerrada_en = datetime('now') WHERE id = ?").run(cuentaId);
    return getTicket(db, ticketId);
  });
}

export function anularTicket(db: DB, ticketId: number) {
  return tx(db, () => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as Row | undefined;
    if (!t) throw new ErrorTPV('El ticket no existe', 404);
    if (t.anula_ticket_id) throw new ErrorTPV('No se puede anular un ticket de anulación');
    const ya = db.prepare('SELECT id FROM tickets WHERE anula_ticket_id = ?').get(ticketId);
    if (ya) throw new ErrorTPV('Este ticket ya está anulado');
    const lineas = db.prepare('SELECT * FROM ticket_lineas WHERE ticket_id = ?').all(ticketId) as Row[];
    const nuevo = emitirTicket(db, {
      cuenta_id: t.cuenta_id, total: -t.total, forma_cobro_id: t.forma_cobro_id, entregado: -t.total, cambio: 0,
      anula_ticket_id: ticketId,
      lineas: lineas.map(l => ({ articulo_id: l.articulo_id, descripcion: l.descripcion, unidades: -l.unidades, precio: l.precio, iva: l.iva })),
    });
    return getTicket(db, nuevo);
  });
}

export function getTicket(db: DB, id: number) {
  const t = db.prepare(`SELECT t.*, f.nombre AS forma_cobro, c.zona_id, z.nombre AS zona_nombre, m.nombre AS mesa_nombre,
                               (SELECT a.id FROM tickets a WHERE a.anula_ticket_id = t.id) AS anulado_por
                        FROM tickets t JOIN formas_cobro f ON f.id = t.forma_cobro_id
                        LEFT JOIN cuentas c ON c.id = t.cuenta_id LEFT JOIN zonas z ON z.id = c.zona_id LEFT JOIN mesas m ON m.id = c.mesa_id
                        WHERE t.id = ?`).get(id) as Row | undefined;
  if (!t) throw new ErrorTPV('El ticket no existe', 404);
  const lineas = db.prepare('SELECT * FROM ticket_lineas WHERE ticket_id = ? ORDER BY id').all(id) as Row[];
  return { ...t, lineas, impuestos: desgloseIva(lineas as any), empresa: db.prepare('SELECT * FROM empresa WHERE id = 1').get() };
}

// Precios con IVA incluido: base = importe / (1 + iva/100), por tipo de IVA.
export function desgloseIva(lineas: { iva: number; importe: number }[]) {
  const porTipo = new Map<number, number>();
  for (const l of lineas) porTipo.set(l.iva, (porTipo.get(l.iva) ?? 0) + l.importe);
  return [...porTipo.entries()].sort((a, b) => a[0] - b[0]).map(([iva, total]) => {
    const base = Math.round(total / (1 + iva / 100));
    return { iva, base, cuota: total - base, total };
  });
}

export function listarTickets(db: DB, soloAbiertos = true) {
  const where = soloAbiertos ? 'WHERE t.cierre_id IS NULL' : '';
  return db.prepare(`SELECT t.id, t.serie, t.numero, t.emitido_en, t.total, t.anula_ticket_id, f.nombre AS forma_cobro,
                            (SELECT a.id FROM tickets a WHERE a.anula_ticket_id = t.id) AS anulado_por
                     FROM tickets t JOIN formas_cobro f ON f.id = t.forma_cobro_id ${where}
                     ORDER BY t.id DESC LIMIT 500`).all();
}

export function resumenCaja(db: DB) {
  const porForma = db.prepare(`SELECT f.id, f.nombre, f.tipo, COUNT(t.id) AS tickets, COALESCE(SUM(t.total), 0) AS total
                               FROM formas_cobro f LEFT JOIN tickets t ON t.forma_cobro_id = f.id AND t.cierre_id IS NULL
                               GROUP BY f.id ORDER BY f.orden`).all() as Row[];
  const porFamilia = db.prepare(`SELECT COALESCE(fa.nombre, 'Sin familia') AS nombre, SUM(tl.unidades) AS unidades, SUM(tl.importe) AS total
                                 FROM ticket_lineas tl JOIN tickets t ON t.id = tl.ticket_id
                                 LEFT JOIN articulos a ON a.id = tl.articulo_id LEFT JOIN familias fa ON fa.id = a.familia_id
                                 WHERE t.cierre_id IS NULL GROUP BY fa.id ORDER BY total DESC`).all();
  const total = porForma.reduce((s, f) => s + f.total, 0);
  const abiertas = (db.prepare("SELECT COUNT(*) AS n FROM cuentas WHERE estado = 'abierta' AND EXISTS (SELECT 1 FROM lineas l WHERE l.cuenta_id = cuentas.id)").get() as Row).n;
  return { total, por_forma: porForma, por_familia: porFamilia, cuentas_abiertas: abiertas };
}

export function cerrarCaja(db: DB, datos: { fondo_inicial?: number; efectivo_contado?: number }) {
  return tx(db, () => {
    const resumen = resumenCaja(db);
    const r = db.prepare('INSERT INTO cierres (fondo_inicial, efectivo_contado, resumen) VALUES (?, ?, ?)')
      .run(datos.fondo_inicial ?? 0, datos.efectivo_contado ?? null, JSON.stringify(resumen));
    const id = Number(r.lastInsertRowid);
    db.prepare('UPDATE tickets SET cierre_id = ? WHERE cierre_id IS NULL').run(id);
    // Las cuentas abiertas sin líneas se descartan al cerrar.
    db.prepare("UPDATE cuentas SET estado = 'vacia' WHERE estado = 'abierta' AND NOT EXISTS (SELECT 1 FROM lineas l WHERE l.cuenta_id = cuentas.id)").run();
    return { id, ...resumen };
  });
}
