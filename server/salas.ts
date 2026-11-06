// Plano de las zonas: color de fondo, mesas (forma, plazas, posición y tamaño) y objetos de decoración.
// Las medidas van en un lienzo de 1000 de ancho; el alto crece con lo que haya dentro.
import { type DB, tx } from './db.ts';
import { ErrorTPV } from './ventas.ts';

type Row = Record<string, any>;
export const FORMAS = ['cuadrada', 'rectangular', 'redonda'];
export const OBJETOS = ['separador', 'planta', 'barra', 'columna', 'puerta', 'sofa'];

const color = (v: unknown) => { const c = String(v ?? '').trim(); if (c && !/^#[0-9a-f]{6}$/i.test(c)) throw new ErrorTPV('Color no válido'); return c; };
const medida = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : def;
};

export function getPlano(db: DB, zonaId: number) {
  const zona = db.prepare('SELECT * FROM zonas WHERE id = ?').get(zonaId) as Row | undefined;
  if (!zona) throw new ErrorTPV('La zona no existe', 404);
  return {
    zona,
    mesas: db.prepare('SELECT * FROM mesas WHERE zona_id = ? AND activa = 1 ORDER BY id').all(zonaId),
    objetos: db.prepare('SELECT * FROM zona_objetos WHERE zona_id = ? ORDER BY id').all(zonaId),
  };
}

export function guardarPlano(db: DB, zonaId: number, datos: { color_fondo?: string; mesas?: Row[]; objetos?: Row[] }) {
  getPlano(db, zonaId);
  const mesas = Array.isArray(datos.mesas) ? datos.mesas : [];
  const objetos = Array.isArray(datos.objetos) ? datos.objetos : [];
  const nombres = new Set<string>();
  for (const m of mesas) {
    const n = String(m.nombre ?? '').trim();
    if (!n) throw new ErrorTPV('Todas las mesas necesitan nombre');
    if (nombres.has(n.toLowerCase())) throw new ErrorTPV(`Hay dos mesas que se llaman "${n}"`);
    nombres.add(n.toLowerCase());
    if (!FORMAS.includes(m.forma)) throw new ErrorTPV('Forma de mesa no válida');
  }
  for (const o of objetos) if (!OBJETOS.includes(o.tipo)) throw new ErrorTPV('Objeto no válido');
  const fondo = color(datos.color_fondo);
  return tx(db, () => {
    db.prepare('UPDATE zonas SET color_fondo = ? WHERE id = ?').run(fondo, zonaId);
    const actuales = db.prepare('SELECT id FROM mesas WHERE zona_id = ? AND activa = 1').all(zonaId) as Row[];
    const quedan = new Set(mesas.filter(m => m.id).map(m => Number(m.id)));
    for (const { id } of actuales) {
      if (quedan.has(id)) continue;
      if (db.prepare("SELECT 1 FROM cuentas WHERE mesa_id = ? AND estado = 'abierta'").get(id)) throw new ErrorTPV('No se puede quitar una mesa con la cuenta abierta');
      // Una mesa con ventas se oculta para no perder el histórico; si no, se borra.
      if (db.prepare('SELECT 1 FROM cuentas WHERE mesa_id = ?').get(id)) db.prepare('UPDATE mesas SET activa = 0 WHERE id = ?').run(id);
      else db.prepare('DELETE FROM mesas WHERE id = ?').run(id);
    }
    const upd = db.prepare('UPDATE mesas SET nombre = ?, forma = ?, plazas = ?, px = ?, py = ?, ancho = ?, alto = ?, color_fondo = ?, color_texto = ?, letra = ? WHERE id = ? AND zona_id = ?');
    const ins = db.prepare('INSERT INTO mesas (zona_id, nombre, forma, plazas, px, py, ancho, alto, color_fondo, color_texto, letra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const m of mesas) {
      const v = [String(m.nombre).trim(), m.forma, medida(m.plazas, 1, 20, 4), medida(m.px, 0, 1000, 0), medida(m.py, 0, 3000, 0),
        medida(m.ancho, 40, 600, 110), medida(m.alto, 40, 600, 110), color(m.color_fondo), color(m.color_texto), medida(m.letra, 50, 300, 100)] as const;
      if (m.id) { if (upd.run(...v, Number(m.id), zonaId).changes === 0) throw new ErrorTPV('Hay una mesa que no es de esta zona'); }
      else ins.run(zonaId, ...v);
    }
    db.prepare('DELETE FROM zona_objetos WHERE zona_id = ?').run(zonaId);
    const insO = db.prepare('INSERT INTO zona_objetos (zona_id, tipo, px, py, ancho, alto, color) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const o of objetos) insO.run(zonaId, o.tipo, medida(o.px, 0, 1000, 0), medida(o.py, 0, 3000, 0), medida(o.ancho, 10, 1000, 100), medida(o.alto, 10, 1000, 20), color(o.color));
    return getPlano(db, zonaId);
  });
}
