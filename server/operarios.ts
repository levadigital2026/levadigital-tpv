// Operarios: entrada con clave o pulsera RFID, permisos por puesto e informe de control de empleados.
import { type DB, PERMISOS } from './db.ts';
import { ErrorTPV } from './ventas.ts';

type Row = Record<string, any>;

// Lista para el panel de operarios: sin claves ni códigos RFID.
export function operariosPublicos(db: DB) {
  return (db.prepare('SELECT id, nombre, pin, permisos FROM operarios ORDER BY orden, nombre').all() as Row[])
    .map(o => ({ id: o.id, nombre: o.nombre, con_clave: !!o.pin, permisos: o.permisos ? String(o.permisos).split(',') : [] }));
}

export function entrar(db: DB, datos: { operario_id?: number; clave?: string; rfid?: string }) {
  let o: Row | undefined;
  if (datos.rfid !== undefined) {
    const codigo = String(datos.rfid).trim();
    if (!codigo) throw new ErrorTPV('Pulsera no leída');
    o = db.prepare("SELECT * FROM operarios WHERE rfid = ? AND rfid <> ''").get(codigo) as Row | undefined;
    if (!o) throw new ErrorTPV('Pulsera no reconocida');
  } else {
    o = db.prepare('SELECT * FROM operarios WHERE id = ?').get(Number(datos.operario_id)) as Row | undefined;
    if (!o) throw new ErrorTPV('El operario no existe');
    if (o.pin && String(datos.clave ?? '') !== String(o.pin)) throw new ErrorTPV('Clave incorrecta');
  }
  return { id: o.id, nombre: o.nombre, permisos: o.permisos ? String(o.permisos).split(',') : [] };
}

export function operarioPorId(db: DB, id: number) {
  const o = db.prepare('SELECT id, nombre, permisos FROM operarios WHERE id = ?').get(id) as Row | undefined;
  return o ? { id: o.id as number, nombre: o.nombre as string, permisos: o.permisos ? String(o.permisos).split(',') : [] } : null;
}

// Qué permiso pide cada petición que cambia algo.
export function permisoDe(metodo: string, ruta: string): string | null {
  if (metodo === 'POST' && /^\/api\/cuentas\/\d+\/cobrar$/.test(ruta)) return 'cobrar';
  if (metodo === 'DELETE' && /^\/api\/lineas\/\d+$/.test(ruta)) return 'borrar_linea';
  if (metodo === 'DELETE' && /^\/api\/cuentas\/\d+\/lineas$/.test(ruta)) return 'borrar_todo';
  if (metodo === 'POST' && /^\/api\/tickets\/\d+\/anular$/.test(ruta)) return 'anular_ticket';
  if (metodo === 'POST' && ruta === '/api/caja/cierre') return 'cierre_caja';
  if (metodo === 'POST' && /^\/api\/lineas\/\d+\/invitar$/.test(ruta)) return 'invitar';
  if (metodo === 'PUT' && /^\/api\/zonas\/\d+\/plano$/.test(ruta)) return 'configuracion';
  if (metodo !== 'GET' && /^\/api\/(gestion|empresa|aspecto|imagenes|carta-demo|licencia|correo)(\/|$)/.test(ruta)) return 'configuracion';
  if (metodo === 'GET' && /^\/api\/(informes|registro)(\/|$)/.test(ruta)) return 'configuracion';
  return null;
}

// En un puesto con permisos activados, comprueba que el operario en uso puede hacer la petición.
export function comprobarPermiso(db: DB, puestoId: number | null, operario: { permisos: string[] } | null, metodo: string, ruta: string) {
  const permiso = permisoDe(metodo, ruta);
  if (!permiso || !puestoId) return;
  const p = db.prepare('SELECT usar_permisos FROM puestos WHERE id = ?').get(puestoId) as Row | undefined;
  if (!p?.usar_permisos) return;
  // Para no quedarse fuera: si ningún operario puede entrar en configuración, se deja entrar.
  if (permiso === 'configuracion') {
    const alguno = (db.prepare('SELECT permisos FROM operarios').all() as Row[]).some(o => String(o.permisos).split(',').includes('configuracion'));
    if (!alguno) return;
  }
  if (!operario) throw new ErrorTPV('Elige primero el operario', 403);
  if (!operario.permisos.includes(permiso)) throw new ErrorTPV(`No tienes permiso para: ${PERMISOS[permiso]}`, 403);
}

// Control de empleados: ventas, borrados, anulaciones y actividad de cada operario entre dos días.
export function informeEmpleados(db: DB, desde?: string | null, hasta?: string | null, operarioId?: string | null) {
  const dia = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const d = dia(desde) ?? '0000-01-01';
  const h = dia(hasta) ?? '9000-01-01';
  const op = operarioId && /^\d+$/.test(operarioId) ? Number(operarioId) : null;
  // Los tickets guardan la hora en UTC: se pasa a hora local para filtrar por día.
  const enTicket = "datetime(t.emitido_en, 'localtime') >= ? AND datetime(t.emitido_en, 'localtime') < date(?, '+1 day')";
  const operarios = (db.prepare('SELECT id, nombre FROM operarios ORDER BY orden, nombre').all() as Row[])
    .filter(o => op === null || o.id === op);
  const filas = [...operarios, ...(op === null ? [{ id: null, nombre: 'Sin operario' }] : [])].map(o => {
    const cond = o.id === null ? 'operario_id IS NULL' : 'operario_id = ?';
    const args = o.id === null ? [] : [o.id];
    const ventas = db.prepare(`SELECT COUNT(*) AS tickets, COALESCE(SUM(total), 0) AS total FROM tickets t
      WHERE t.${cond} AND t.anula_ticket_id IS NULL AND ${enTicket}`).get(...args, d, h) as Row;
    const articulos = db.prepare(`SELECT COALESCE(SUM(l.unidades), 0) AS unidades FROM ticket_lineas l JOIN tickets t ON t.id = l.ticket_id
      WHERE t.${cond} AND t.anula_ticket_id IS NULL AND ${enTicket}`).get(...args, d, h) as Row;
    const anul = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM tickets t
      WHERE t.${cond} AND t.anula_ticket_id IS NOT NULL AND ${enTicket}`).get(...args, d, h) as Row;
    const borr = db.prepare(`SELECT COUNT(*) AS lineas, COALESCE(SUM(importe), 0) AS importe FROM borrados
      WHERE ${cond} AND fecha >= ? AND fecha < date(?, '+1 day')`).get(...args, d, h) as Row;
    return {
      id: o.id, nombre: o.nombre, tickets: ventas.tickets, vendido: ventas.total, unidades: articulos.unidades,
      anulaciones: anul.n, anulado: -anul.total, lineas_borradas: borr.lineas, importe_borrado: borr.importe,
    };
  }).filter(f => op !== null || f.id !== null || f.tickets || f.lineas_borradas || f.anulaciones);
  const actividad = db.prepare(`SELECT fecha, nivel, accion, operario FROM registro
    WHERE fecha >= ? AND fecha < date(?, '+1 day') ${op === null ? '' : 'AND operario_id = ?'}
    ORDER BY id DESC LIMIT 500`).all(...[d, h, ...(op === null ? [] : [op])]);
  return { desde: d, hasta: h, empleados: filas, actividad };
}
