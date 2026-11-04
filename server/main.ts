// Arranque del servidor del TPV en el PC Windows del local.
//   node server/main.ts            -> puerto 8080, datos en ./datos/tpv.db
//   PUERTO=9000 DATOS=C:\tpv node server/main.ts
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { openDb } from './db.ts';
import { crearServidor } from './app.ts';

const puerto = Number(process.env.PUERTO ?? 8080);
const carpeta = process.env.DATOS ?? join(process.cwd(), 'datos');
mkdirSync(carpeta, { recursive: true });

const db = openDb(join(carpeta, 'tpv.db'));
db.exec('PRAGMA journal_mode = WAL');

crearServidor(db).listen(puerto, '0.0.0.0', () => {
  console.log(`TPV LevaDigital funcionando en el puerto ${puerto}`);
  console.log(`  En este PC:        http://localhost:${puerto}`);
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  Desde PDA o tablet: http://${i.address}:${puerto}`);
    }
  }
});
