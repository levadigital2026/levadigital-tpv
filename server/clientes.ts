// Clientes: búsqueda, ficha con ventas y estadísticas, y facturas completas a partir de tickets.
import { type DB, tx } from './db.ts';
import { ErrorTPV, contexto, datosFiscales, desgloseIva, serieDe } from './ventas.ts';

type Row = Record<string, any>;

export function buscarClientes(db: DB, q?: string | null) {
  const t = String(q ?? '').trim();
  const cols = 'id, nombre, apellidos, apodo, nif, telefono, email, localidad';
  if (!t) return db.prepare(`SELECT ${cols} FROM clientes ORDER BY nombre COLLATE NOCASE LIMIT 300`).all();
  const like = `%${t}%`;
  return db.prepare(`SELECT ${cols} FROM clientes WHERE nombre LIKE ? OR apellidos LIKE ? OR apodo LIKE ? OR nif LIKE ? OR telefono LIKE ? OR telefono2 LIKE ? OR tarjeta = ?
                     ORDER BY nombre COLLATE NOCASE LIMIT 300`).all(like, like, like, like, like, like, t);
}

const dia = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const enDia = "datetime(t.emitido_en, 'localtime') >= ? AND datetime(t.emitido_en, 'localtime') < date(?, '+1 day')";

// Ficha: datos, ventas (tickets), estadísticas, artículos más comprados y facturas.
export function fichaCliente(db: DB, id: number, desde?: string | null, hasta?: string | null) {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id) as Row | undefined;
  if (!c) throw new ErrorTPV('El cliente no existe', 404);
  const d = dia(desde) ?? '0000-01-01', h = dia(hasta) ?? '9000-01-01';
  const tickets = db.prepare(`SELECT t.id, t.serie, t.numero, t.emitido_en, t.total, t.anula_ticket_id,
      (SELECT a.id FROM tickets a WHERE a.anula_ticket_id = t.id) AS anulado_por,
      (SELECT f.serie || '-' || f.numero FROM factura_tickets ft JOIN facturas f ON f.id = ft.factura_id WHERE ft.ticket_id = t.id) AS factura
    FROM tickets t WHERE t.cliente_id = ? AND ${enDia} ORDER BY t.id DESC LIMIT 500`).all(id, d, h) as Row[];
  const est = db.prepare(`SELECT COUNT(CASE WHEN anula_ticket_id IS NULL THEN 1 END) AS visitas, COALESCE(SUM(total), 0) AS gastado,
      MIN(datetime(emitido_en, 'localtime')) AS primera, MAX(datetime(emitido_en, 'localtime')) AS ultima
    FROM tickets t WHERE t.cliente_id = ? AND ${enDia}`).get(id, d, h) as Row;
  const articulos = db.prepare(`SELECT l.descripcion AS nombre, SUM(l.unidades) AS unidades, SUM(l.importe) AS total
    FROM ticket_lineas l JOIN tickets t ON t.id = l.ticket_id WHERE t.cliente_id = ? AND ${enDia}
    GROUP BY COALESCE(l.articulo_id, l.descripcion) HAVING SUM(l.unidades) > 0 ORDER BY unidades DESC LIMIT 10`).all(id, d, h);
  const facturas = db.prepare('SELECT id, serie, numero, fecha, total, desde, hasta FROM facturas WHERE cliente_id = ? ORDER BY id DESC').all(id);
  const sinFacturar = ticketsSinFacturar(db, id, d, h);
  return {
    cliente: c, tickets, articulos, facturas,
    estadisticas: { ...est, ticket_medio: est.visitas ? Math.round(est.gastado / est.visitas) : 0 },
    sin_facturar: { tickets: sinFacturar.length, total: sinFacturar.reduce((n, t) => n + t.total, 0) },
  };
}

// Tickets del cliente que se pueden pasar a factura: no anulados, no de anulación y sin factura.
function ticketsSinFacturar(db: DB, clienteId: number, d: string, h: string) {
  return db.prepare(`SELECT t.* FROM tickets t WHERE t.cliente_id = ? AND ${enDia} AND t.anula_ticket_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM tickets a WHERE a.anula_ticket_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM factura_tickets ft WHERE ft.ticket_id = t.id) ORDER BY t.id`).all(clienteId, d, h) as Row[];
}

// Factura completa que sustituye a las facturas simplificadas (tickets) de un periodo.
export function crearFactura(db: DB, clienteId: number, datos: { desde?: string; hasta?: string; tickets?: number[] }) {
  const cliente = datosFiscales(db, clienteId);
  if (!cliente) throw new ErrorTPV('El cliente no existe', 404);
  if (!cliente.nif) throw new ErrorTPV('Para hacer una factura completa el cliente necesita NIF');
  if (!cliente.domicilio) throw new ErrorTPV('Para hacer una factura completa el cliente necesita domicilio');
  const d = dia(datos.desde) ?? '0000-01-01', h = dia(datos.hasta) ?? '9000-01-01';
  return tx(db, () => {
    let tickets = ticketsSinFacturar(db, clienteId, d, h);
    if (Array.isArray(datos.tickets) && datos.tickets.length) tickets = tickets.filter(t => datos.tickets!.includes(t.id));
    if (!tickets.length) throw new ErrorTPV('No hay tickets sin facturar de este cliente en esas fechas');
    const serie = serieDe(db, 'facturas');
    const ultimo = db.prepare('SELECT MAX(numero) AS n FROM facturas WHERE serie = ?').get(serie) as Row;
    const numero = (ultimo.n ?? 0) + 1;
    const total = tickets.reduce((n, t) => n + t.total, 0);
    const fechas = tickets.map(t => t.emitido_en).sort();
    const r = db.prepare('INSERT INTO facturas (serie, numero, cliente_id, cliente, total, desde, hasta, operario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(serie, numero, clienteId, JSON.stringify(cliente), total, fechas[0], fechas[fechas.length - 1], contexto.operario?.nombre ?? '');
    const id = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO factura_tickets (factura_id, ticket_id) VALUES (?, ?)');
    for (const t of tickets) ins.run(id, t.id);
    return getFactura(db, id);
  });
}

export function getFactura(db: DB, id: number) {
  const f = db.prepare('SELECT * FROM facturas WHERE id = ?').get(id) as Row | undefined;
  if (!f) throw new ErrorTPV('La factura no existe', 404);
  const tickets = db.prepare(`SELECT t.id, t.serie, t.numero, t.emitido_en, t.total FROM factura_tickets ft JOIN tickets t ON t.id = ft.ticket_id
                              WHERE ft.factura_id = ? ORDER BY t.id`).all(id) as Row[];
  const lineas = db.prepare(`SELECT l.descripcion, l.precio, l.iva, SUM(l.unidades) AS unidades, SUM(l.importe) AS importe
                             FROM factura_tickets ft JOIN ticket_lineas l ON l.ticket_id = ft.ticket_id WHERE ft.factura_id = ?
                             GROUP BY l.descripcion, l.precio, l.iva ORDER BY MIN(l.id)`).all(id) as Row[];
  const { instalacion, licencia, aspecto, ...empresa } = db.prepare('SELECT * FROM empresa WHERE id = 1').get() as Row;
  return { ...f, cliente: JSON.parse(f.cliente), tickets, lineas, impuestos: desgloseIva(lineas as any), empresa };
}
