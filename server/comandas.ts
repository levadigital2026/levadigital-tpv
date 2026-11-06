// Comandas a las impresoras de cocina y barra (red, ESC/POS por el puerto 9100).
// Cada línea va a sus impresoras (artículo > familia > departamento). Se guarda cuánto se ha enviado a cada
// impresora, así al guardar o salir de la mesa solo sale lo nuevo. "Reenviar" vuelve a sacar todo como copia.
import { connect } from 'node:net';
import { type DB, tx } from './db.ts';
import { ErrorTPV, contexto, getCuenta, impresorasDe, nombreParaCocina } from './ventas.ts';

type Row = Record<string, any>;
type Linea = { unidades: number; texto: string; orden: string; ordenN: number };

// Texto a bytes en la página de códigos 858 (español y €), que entienden casi todas las impresoras de tickets.
const CP858: Record<string, number> = {
  'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ü': 0x81, 'Ü': 0x9a, 'Á': 0xb5, 'É': 0x90,
  'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, '¿': 0xa8, '¡': 0xad, 'º': 0xa7, 'ª': 0xa6, '€': 0xd5, 'ç': 0x87, 'Ç': 0x80, 'à': 0x85, 'è': 0x8a, 'ò': 0x95,
};
function bytes(texto: string) {
  const out: number[] = [];
  for (const ch of texto) { const c = ch.charCodeAt(0); out.push(c < 128 ? c : CP858[ch] ?? 0x3f); }
  return out;
}
const ESC = 0x1b, GS = 0x1d;

export function ticketComanda(d: { impresora: string; cuenta: string; operario: string; copia: boolean; titulo?: string; lineas: Linea[] }) {
  const b: number[] = [ESC, 0x40, ESC, 0x74, 19];               // iniciar + página 858
  const linea = (t: string) => b.push(...bytes(t), 0x0a);
  const grande = (on: boolean) => b.push(GS, 0x21, on ? 0x11 : 0x00);
  b.push(ESC, 0x61, 1);                                          // centrado
  if (d.copia) { grande(true); linea('*** REENVIO ***'); grande(false); }
  grande(true); linea(d.titulo ?? 'COMANDA'); grande(false);
  linea(d.impresora.toUpperCase());
  grande(true); linea(d.cuenta); grande(false);
  const ahora = new Date();
  linea(`${ahora.toLocaleDateString('es-ES')} ${ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${d.operario ? ' · ' + d.operario : ''}`);
  b.push(ESC, 0x61, 0);
  linea('-'.repeat(32));
  let orden = '';
  for (const l of [...d.lineas].sort((x, y) => x.ordenN - y.ordenN)) {
    if (l.orden !== orden) { orden = l.orden; if (orden) { b.push(ESC, 0x45, 1); linea(`-- ${orden.toUpperCase()} --`); b.push(ESC, 0x45, 0); } }
    grande(true); linea(`${Number.isInteger(l.unidades) ? l.unidades : l.unidades.toLocaleString('es-ES')} x ${l.texto}`); grande(false);
  }
  linea('-'.repeat(32));
  b.push(0x0a, 0x0a, 0x0a, GS, 0x56, 66, 0);                     // avance y corte
  return Buffer.from(b);
}

// Envía bytes a una impresora de red. La espera es corta para no dejar colgado al camarero.
export let enviarAImpresora = (ip: string, puerto: number, datos: Buffer) => new Promise<void>((ok, mal) => {
  if (!ip) return mal(new Error('la impresora no tiene dirección IP'));
  const s = connect({ host: ip, port: puerto || 9100 });
  const fin = (e?: Error) => { s.destroy(); e ? mal(e) : ok(); };
  s.setTimeout(4000, () => fin(new Error('no responde')));
  s.on('error', e => fin(e));
  s.on('connect', () => s.end(datos, () => fin()));
});
export function usarEnvio(fn: typeof enviarAImpresora) { enviarAImpresora = fn; }

// Lo que hay pendiente (o todo, al reenviar) para cada impresora de comanda.
function repartir(db: DB, cuentaId: number, todo: boolean) {
  const lineas = db.prepare(`SELECT l.*, o.nombre AS orden_plato, o.orden AS orden_n FROM lineas l
    LEFT JOIN ordenes_plato o ON o.id = l.orden_plato_id WHERE l.cuenta_id = ? ORDER BY l.id`).all(cuentaId) as Row[];
  const enviado = db.prepare('SELECT COALESCE(SUM(unidades), 0) AS u FROM linea_envios WHERE linea_id = ? AND impresora_id = ?');
  const imps = db.prepare('SELECT * FROM impresoras WHERE activa = 1 ORDER BY orden, id').all() as Row[];
  const porImp = new Map<number, { imp: Row; lineas: (Linea & { linea_id: number })[] }>();
  for (const l of lineas) {
    for (const id of impresorasDe(db, l.articulo_id)) {
      const imp = imps.find(i => i.id === id);
      if (!imp) continue;
      const u = todo ? l.unidades : Math.round((l.unidades - (enviado.get(l.id, id) as Row).u) * 1000) / 1000;
      if (u <= 0) continue;
      if (!porImp.has(id)) porImp.set(id, { imp, lineas: [] });
      porImp.get(id)!.lineas.push({ linea_id: l.id, unidades: u, texto: l.detalle || l.descripcion, orden: l.orden_plato ?? '', ordenN: l.orden_n ?? 999 });
    }
  }
  return [...porImp.values()];
}

export function pendienteComanda(db: DB, cuentaId: number) {
  return repartir(db, cuentaId, false).map(p => ({ id: p.imp.id, nombre: p.imp.nombre, envio: p.imp.envio, lineas: p.lineas }));
}

// modo 'auto': solo impresoras con envío automático (al guardar o salir de la mesa).
// modo 'enviar': todas las impresoras (botón Enviar comanda). modo 'reenviar': todo otra vez, como copia.
export async function enviarComanda(db: DB, cuentaId: number, modo: 'auto' | 'enviar' | 'reenviar' = 'enviar') {
  getCuenta(db, cuentaId);
  const cuenta = nombreParaCocina(db, cuentaId);
  const operario = contexto.operario?.nombre ?? '';
  let grupos = repartir(db, cuentaId, modo === 'reenviar');
  // Lo de barra se cobra al momento: solo sale en las impresoras que tienen marcado "imprimir también barra".
  // Lo que no sale queda pendiente: si la cuenta se traspasa a una mesa, sale entonces.
  const c = db.prepare('SELECT c.mesa_id, z.tipo FROM cuentas c JOIN zonas z ON z.id = c.zona_id WHERE c.id = ?').get(cuentaId) as Row;
  const esBarra = !c.mesa_id || c.tipo === 'barra';
  if (modo === 'auto') grupos = grupos.filter(g => g.imp.envio !== 'manual' && (!esBarra || g.imp.imprimir_barra));
  const resultado: { impresora: string; lineas: number; ok: boolean; error?: string }[] = [];
  for (const g of grupos) {
    try {
      await enviarAImpresora(g.imp.ip, g.imp.puerto, ticketComanda({ impresora: g.imp.nombre, cuenta, operario, copia: modo === 'reenviar', lineas: g.lineas }));
      if (modo !== 'reenviar') {
        const ins = db.prepare('INSERT INTO linea_envios (linea_id, impresora_id, unidades) VALUES (?, ?, ?)');
        tx(db, () => { for (const l of g.lineas) ins.run(l.linea_id, g.imp.id, l.unidades); });
      }
      resultado.push({ impresora: g.imp.nombre, lineas: g.lineas.length, ok: true });
    } catch (e: any) {
      resultado.push({ impresora: g.imp.nombre, lineas: g.lineas.length, ok: false, error: e.message });
    }
  }
  if (modo === 'reenviar' && !grupos.length) throw new ErrorTPV('Esta cuenta no tiene nada que vaya a cocina o barra');
  return { enviadas: resultado };
}

// "Marchar": también sale en las impresoras que tienen platos de ese orden en la cuenta.
export async function imprimirMarcha(db: DB, cuentaId: number, ordenPlatoId: number, texto: string) {
  const lineas = db.prepare('SELECT articulo_id FROM lineas WHERE cuenta_id = ? AND orden_plato_id = ?').all(cuentaId, ordenPlatoId) as Row[];
  const ids = new Set(lineas.flatMap(l => impresorasDe(db, l.articulo_id)));
  const imps = (db.prepare('SELECT * FROM impresoras WHERE activa = 1').all() as Row[]).filter(i => ids.has(i.id));
  const res = [];
  for (const i of imps) {
    const datos = Buffer.concat([Buffer.from([ESC, 0x40, ESC, 0x74, 19, ESC, 0x61, 1, GS, 0x21, 0x11]), Buffer.from(bytes(texto + '\n\n\n\n')), Buffer.from([GS, 0x56, 66, 0])]);
    try { await enviarAImpresora(i.ip, i.puerto, datos); res.push({ impresora: i.nombre, ok: true }); }
    catch (e: any) { res.push({ impresora: i.nombre, ok: false, error: e.message }); }
  }
  return res;
}
