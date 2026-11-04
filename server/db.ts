// Base de datos local del TPV (SQLite, un solo archivo, sin instalar nada).
// Todos los importes se guardan en céntimos (enteros) para evitar errores de redondeo.
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS departamentos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS familias (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3d5a80',
  orden INTEGER NOT NULL DEFAULT 0,
  padre_id INTEGER REFERENCES familias(id) ON DELETE SET NULL,
  departamento_id INTEGER REFERENCES departamentos(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS articulos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  precio INTEGER NOT NULL DEFAULT 0,          -- céntimos, IVA incluido
  iva REAL NOT NULL DEFAULT 10,               -- porcentaje
  familia_id INTEGER REFERENCES familias(id) ON DELETE SET NULL,
  grupo_cocina INTEGER NOT NULL DEFAULT -2,   -- -2 ninguno, 0 entrantes, 1 primeros, 2 segundos, 3 postres
  orden INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS zonas (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'mesas' CHECK (tipo IN ('barra', 'mesas')),
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mesas (
  id INTEGER PRIMARY KEY,
  zona_id INTEGER NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS operarios (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  pin TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS formas_cobro (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('efectivo', 'tarjeta', 'pendiente', 'otro')),
  activa INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cuentas (
  id INTEGER PRIMARY KEY,
  zona_id INTEGER NOT NULL REFERENCES zonas(id),
  mesa_id INTEGER REFERENCES mesas(id),
  nombre TEXT NOT NULL DEFAULT '',
  comensales INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cobrada', 'vacia')),
  operario_id INTEGER REFERENCES operarios(id),
  abierta_en TEXT NOT NULL DEFAULT (datetime('now')),
  cerrada_en TEXT
);

CREATE TABLE IF NOT EXISTS lineas (
  id INTEGER PRIMARY KEY,
  cuenta_id INTEGER NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  articulo_id INTEGER REFERENCES articulos(id),
  descripcion TEXT NOT NULL,
  unidades REAL NOT NULL DEFAULT 1,
  precio INTEGER NOT NULL,
  iva REAL NOT NULL,
  detalle TEXT NOT NULL DEFAULT '',
  grupo_cocina INTEGER NOT NULL DEFAULT -2,
  creada_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Los tickets no se modifican ni se borran nunca: una anulación crea un ticket en negativo.
-- 'huella' encadena cada ticket con el anterior (preparación para Verifactu/TicketBAI).
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  serie TEXT NOT NULL,
  numero INTEGER NOT NULL,
  cuenta_id INTEGER REFERENCES cuentas(id),
  emitido_en TEXT NOT NULL,
  total INTEGER NOT NULL,
  forma_cobro_id INTEGER NOT NULL REFERENCES formas_cobro(id),
  entregado INTEGER NOT NULL DEFAULT 0,
  cambio INTEGER NOT NULL DEFAULT 0,
  anula_ticket_id INTEGER REFERENCES tickets(id),
  cierre_id INTEGER REFERENCES cierres(id),
  huella_anterior TEXT NOT NULL,
  huella TEXT NOT NULL,
  UNIQUE (serie, numero)
);

CREATE TABLE IF NOT EXISTS ticket_lineas (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  articulo_id INTEGER,
  descripcion TEXT NOT NULL,
  unidades REAL NOT NULL,
  precio INTEGER NOT NULL,
  iva REAL NOT NULL,
  importe INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cierres (
  id INTEGER PRIMARY KEY,
  cerrado_en TEXT NOT NULL DEFAULT (datetime('now')),
  fondo_inicial INTEGER NOT NULL DEFAULT 0,
  efectivo_contado INTEGER,
  resumen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS empresa (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nombre TEXT NOT NULL DEFAULT 'Mi local',
  nif TEXT NOT NULL DEFAULT '',
  direccion TEXT NOT NULL DEFAULT '',
  serie_tickets TEXT NOT NULL DEFAULT 'T'
);
`;

export function openDb(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const vacia = db.prepare('SELECT COUNT(*) AS n FROM empresa').get() as { n: number };
  if (vacia.n === 0) seed(db);
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Datos de ejemplo para poder probar el TPV nada más arrancarlo.
function seed(db: DB) {
  tx(db, () => {
    db.prepare("INSERT INTO empresa (id, nombre) VALUES (1, 'Bar de prueba LevaDigital')").run();

    const dep = db.prepare('INSERT INTO departamentos (nombre) VALUES (?)');
    const barra = Number(dep.run('Barra').lastInsertRowid);
    const cocina = Number(dep.run('Cocina').lastInsertRowid);

    const fam = db.prepare('INSERT INTO familias (nombre, color, orden, departamento_id) VALUES (?, ?, ?, ?)');
    const cafes = Number(fam.run('Cafés', '#6f4e37', 1, barra).lastInsertRowid);
    const bebidas = Number(fam.run('Bebidas', '#2a9d8f', 2, barra).lastInsertRowid);
    const pintxos = Number(fam.run('Pintxos', '#e9c46a', 3, cocina).lastInsertRowid);
    const raciones = Number(fam.run('Raciones', '#e76f51', 4, cocina).lastInsertRowid);
    const postres = Number(fam.run('Postres', '#b5838d', 5, cocina).lastInsertRowid);

    const art = db.prepare('INSERT INTO articulos (nombre, precio, iva, familia_id, grupo_cocina, orden) VALUES (?, ?, 10, ?, ?, ?)');
    const lista: [string, number, number, number][] = [
      ['Café solo', 140, cafes, -2], ['Cortado', 150, cafes, -2], ['Café con leche', 180, cafes, -2],
      ['Infusión', 170, cafes, -2], ['Colacao', 200, cafes, -2],
      ['Caña', 220, bebidas, -2], ['Zurito', 150, bebidas, -2], ['Txakoli', 280, bebidas, -2],
      ['Vino crianza', 300, bebidas, -2], ['Agua', 180, bebidas, -2], ['Refresco', 260, bebidas, -2],
      ['Gilda', 250, pintxos, 0], ['Tortilla', 300, pintxos, 0], ['Txampi', 350, pintxos, 0],
      ['Croqueta', 220, pintxos, 0],
      ['Rabas', 1200, raciones, 1], ['Pimientos de Padrón', 900, raciones, 1],
      ['Chuleta (kg)', 4800, raciones, 2], ['Bacalao al pil-pil', 2200, raciones, 2],
      ['Tarta de queso', 650, postres, 3], ['Goxua', 600, postres, 3],
    ];
    lista.forEach(([n, p, f, g], i) => art.run(n, p, f, g, i));

    const zona = db.prepare('INSERT INTO zonas (nombre, tipo, orden) VALUES (?, ?, ?)');
    zona.run('Barra', 'barra', 1);
    const comedor = Number(zona.run('Comedor', 'mesas', 2).lastInsertRowid);
    const terraza = Number(zona.run('Terraza', 'mesas', 3).lastInsertRowid);
    const mesa = db.prepare('INSERT INTO mesas (zona_id, nombre, x, y) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 8; i++) mesa.run(comedor, `M${i + 1}`, i % 4, Math.floor(i / 4));
    for (let i = 0; i < 6; i++) mesa.run(terraza, `T${i + 1}`, i % 3, Math.floor(i / 3));

    db.prepare("INSERT INTO operarios (nombre, pin) VALUES ('Encargado', '1234')").run();

    const fc = db.prepare('INSERT INTO formas_cobro (nombre, tipo, orden) VALUES (?, ?, ?)');
    fc.run('Efectivo', 'efectivo', 1);
    fc.run('Tarjeta', 'tarjeta', 2);
    fc.run('Pendiente de cobro', 'pendiente', 3);
  });
}
