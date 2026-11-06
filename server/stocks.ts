// Stocks: existencias (compras + / ventas - / ajustes), albaranes de compra de proveedores.
import { type DB, tx } from './db.ts';
import { ErrorTPV, contexto } from './ventas.ts';

type Row = Record<string, any>;

export function existencias(db: DB, soloControlados = false) {
  return db.prepare(`SELECT a.id, a.nombre, a.familia_id, f.nombre AS familia, a.controlar_stock, a.stock_minimo, a.coste, a.precio,
      COALESCE((SELECT SUM(m.cantidad) FROM stock_movimientos m WHERE m.articulo_id = a.id), 0) AS stock
    FROM articulos a LEFT JOIN familias f ON f.id = a.familia_id
    ${soloControlados ? 'WHERE a.controlar_stock = 1' : ''} ORDER BY f.orden, a.orden, a.nombre`).all();
}

export function movimientos(db: DB, articuloId: number) {
  return db.prepare('SELECT * FROM stock_movimientos WHERE articulo_id = ? ORDER BY id DESC LIMIT 300').all(articuloId);
}

type LineaAlb = { articulo_id?: number; cantidad?: number; coste?: number };

// Un albarán de compra suma al stock lo que entra y guarda el último coste del artículo.
export function crearAlbaran(db: DB, datos: { proveedor_id?: number; numero?: string; fecha?: string; notas?: string; lineas?: LineaAlb[] }) {
  const prov = db.prepare('SELECT * FROM proveedores WHERE id = ?').get(Number(datos.proveedor_id)) as Row | undefined;
  if (!prov) throw new ErrorTPV('Elige el proveedor');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(datos.fecha)) ? String(datos.fecha) : new Date().toISOString().slice(0, 10);
  const lineas = (datos.lineas ?? []).filter(l => l && l.articulo_id);
  if (!lineas.length) throw new ErrorTPV('El albarán no tiene artículos');
  return tx(db, () => {
    const preparadas = lineas.map(l => {
      const a = db.prepare('SELECT id, nombre FROM articulos WHERE id = ?').get(Number(l.articulo_id)) as Row | undefined;
      if (!a) throw new ErrorTPV('Hay un artículo que no existe');
      const cantidad = Number(l.cantidad), coste = Math.round(Number(l.coste ?? 0));
      if (!(cantidad > 0)) throw new ErrorTPV(`Cantidad no válida en ${a.nombre}`);
      if (!Number.isInteger(coste) || coste < 0) throw new ErrorTPV(`Coste no válido en ${a.nombre}`);
      return { a, cantidad, coste };
    });
    const total = preparadas.reduce((n, l) => n + Math.round(l.cantidad * l.coste), 0);
    const r = db.prepare('INSERT INTO albaranes (proveedor_id, proveedor, numero, fecha, total, notas, operario) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(prov.id, prov.nombre, String(datos.numero ?? '').trim(), fecha, total, String(datos.notas ?? '').trim(), contexto.operario?.nombre ?? '');
    const id = Number(r.lastInsertRowid);
    const insL = db.prepare('INSERT INTO albaran_lineas (albaran_id, articulo_id, descripcion, cantidad, coste) VALUES (?, ?, ?, ?, ?)');
    const mov = db.prepare("INSERT INTO stock_movimientos (articulo_id, cantidad, tipo, ref_id, nota) VALUES (?, ?, 'compra', ?, ?)");
    for (const l of preparadas) {
      insL.run(id, l.a.id, l.a.nombre, l.cantidad, l.coste);
      mov.run(l.a.id, l.cantidad, id, `Albarán ${datos.numero || id} de ${prov.nombre}`);
      if (l.coste) db.prepare('UPDATE articulos SET coste = ? WHERE id = ?').run(l.coste, l.a.id);
      db.prepare('UPDATE articulos SET controlar_stock = 1 WHERE id = ?').run(l.a.id);
    }
    return getAlbaran(db, id);
  });
}

export function getAlbaran(db: DB, id: number) {
  const a = db.prepare('SELECT * FROM albaranes WHERE id = ?').get(id) as Row | undefined;
  if (!a) throw new ErrorTPV('El albarán no existe', 404);
  return { ...a, lineas: db.prepare('SELECT * FROM albaran_lineas WHERE albaran_id = ? ORDER BY id').all(id) };
}

export function listarAlbaranes(db: DB) {
  return db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM albaran_lineas l WHERE l.albaran_id = a.id) AS lineas FROM albaranes a ORDER BY a.fecha DESC, a.id DESC LIMIT 300`).all();
}

// Ajuste de inventario: deja el stock de un artículo en lo contado.
export function ajustarStock(db: DB, datos: { articulo_id?: number; stock?: number; nota?: string }) {
  const a = db.prepare('SELECT id, nombre FROM articulos WHERE id = ?').get(Number(datos.articulo_id)) as Row | undefined;
  if (!a) throw new ErrorTPV('El artículo no existe');
  const nuevo = Number(datos.stock);
  if (!Number.isFinite(nuevo)) throw new ErrorTPV('Stock no válido');
  const actual = (db.prepare('SELECT COALESCE(SUM(cantidad), 0) AS s FROM stock_movimientos WHERE articulo_id = ?').get(a.id) as Row).s;
  const dif = Math.round((nuevo - actual) * 1000) / 1000;
  if (dif) db.prepare("INSERT INTO stock_movimientos (articulo_id, cantidad, tipo, nota) VALUES (?, ?, 'ajuste', ?)")
    .run(a.id, dif, String(datos.nota ?? '').trim() || `Inventario${contexto.operario ? ' · ' + contexto.operario.nombre : ''}`);
  db.prepare('UPDATE articulos SET controlar_stock = 1 WHERE id = ?').run(a.id);
  return { articulo_id: a.id, stock: nuevo, diferencia: dif };
}
