// Crea una licencia de módulos para una instalación. Solo para LevaDigital: necesita la clave privada.
//   node herramientas/crear-licencia.ts <ruta clave privada> <instalación> <módulos separados por comas | todos> [caduca AAAA-MM-DD] [titular]
//   Ejemplo: node herramientas/crear-licencia.ts D:\licencias\clave-privada-licencias.pem 1A2B-3C4D-5E6F clientes,stocks 2027-12-31 "Bar Horbel"
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { MODULOS } from '../server/licencia.ts';

const [ruta, instalacion, mods, caduca = '', titular = ''] = process.argv.slice(2);
if (!ruta || !instalacion || !mods) {
  console.log('Uso: node herramientas/crear-licencia.ts <clave privada> <instalación> <módulos|todos> [caduca AAAA-MM-DD] [titular]');
  console.log('Módulos: ' + Object.keys(MODULOS).join(', '));
  process.exit(1);
}
const m = mods === 'todos' ? Object.keys(MODULOS) : mods.split(',').map(x => x.trim()).filter(Boolean);
const malos = m.filter(x => !(x in MODULOS));
if (malos.length) { console.error('Módulos desconocidos: ' + malos.join(', ')); process.exit(1); }
if (caduca && !/^\d{4}-\d{2}-\d{2}$/.test(caduca)) { console.error('La caducidad va como AAAA-MM-DD'); process.exit(1); }
const datos = Buffer.from(JSON.stringify({ i: instalacion.trim().toUpperCase(), m, ...(caduca ? { c: caduca } : {}), ...(titular ? { n: titular } : {}) })).toString('base64url');
const firma = sign(null, Buffer.from(datos), createPrivateKey(readFileSync(ruta))).toString('base64url');
console.log(`\nLicencia para ${instalacion} (${m.join(', ')}${caduca ? ', caduca ' + caduca : ''}):\n\nLEVA1.${datos}.${firma}\n`);
