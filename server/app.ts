// Servidor HTTP del TPV: API JSON, avisos en tiempo real (SSE) y la aplicación web.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DB, ACCIONES } from './db.ts';
import * as v from './ventas.ts';
import * as g from './gestion.ts';
import { registrar, describir, leerRegistro } from './registro.ts';
import { listarImagenes, subirImagen, leerImagen } from './imagenes.ts';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

type Handler = (p: { db: DB; params: string[]; body: any; url: URL }) => unknown;
type Ruta = { metodo: string; patron: RegExp; handler: Handler; cambia: boolean };

const rutas: Ruta[] = [];
function ruta(metodo: string, patron: string, handler: Handler) {
  const re = new RegExp('^' + patron.replace(/:(\w+)/g, '([^/]+)') + '$');
  rutas.push({ metodo, patron: re, handler, cambia: metodo !== 'GET' });
}
const num = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n)) throw new v.ErrorTPV('Identificador no válido');
  return n;
};

// Datos para pintar el TPV de una vez.
ruta('GET', '/api/inicio', ({ db }) => ({
  empresa: g.getEmpresa(db),
  departamentos: g.listar(db, 'departamentos'),
  familias: g.listar(db, 'familias'),
  articulos: g.listar(db, 'articulos'),
  zonas: g.listar(db, 'zonas'),
  mesas: g.listar(db, 'mesas'),
  formas_cobro: g.listar(db, 'formas_cobro'),
  botones: g.listar(db, 'botones'),
  impresoras: g.listar(db, 'impresoras'),
  comentarios: g.listar(db, 'comentarios'),
  aspecto: g.getAspecto(db),
  aspecto_campos: g.ASPECTO,
  acciones: ACCIONES,
}));

ruta('GET', '/api/cuentas', ({ db }) => v.cuentasAbiertas(db));
ruta('POST', '/api/cuentas', ({ db, body }) => v.abrirCuenta(db, body));
ruta('GET', '/api/cuentas/:id', ({ db, params }) => v.getCuenta(db, num(params[0])));
ruta('PATCH', '/api/cuentas/:id', ({ db, params, body }) => v.actualizarCuenta(db, num(params[0]), body));
ruta('DELETE', '/api/cuentas/:id/lineas', ({ db, params }) => v.borrarTodasLineas(db, num(params[0])));
ruta('POST', '/api/cuentas/:id/lineas', ({ db, params, body }) => v.anadirLinea(db, num(params[0]), body));
ruta('POST', '/api/cuentas/:id/cobrar', ({ db, params, body }) => v.cobrarCuenta(db, num(params[0]), body));
ruta('PATCH', '/api/lineas/:id', ({ db, params, body }) => v.modificarLinea(db, num(params[0]), body));
ruta('DELETE', '/api/lineas/:id', ({ db, params }) => v.borrarLinea(db, num(params[0])));

ruta('GET', '/api/tickets', ({ db, url }) => v.listarTickets(db, url.searchParams.get('todos') !== '1'));
ruta('GET', '/api/tickets/:id', ({ db, params }) => v.getTicket(db, num(params[0])));
ruta('POST', '/api/tickets/:id/anular', ({ db, params }) => v.anularTicket(db, num(params[0])));

ruta('GET', '/api/caja', ({ db }) => v.resumenCaja(db));
ruta('POST', '/api/caja/cierre', ({ db, body }) => v.cerrarCaja(db, body));

ruta('GET', '/api/informes/borrados', ({ db, url }) => v.informeBorrados(db, url.searchParams.get('desde'), url.searchParams.get('hasta')));
ruta('GET', '/api/registro', ({ db, url }) => leerRegistro(db, url.searchParams.get('fecha'), url.searchParams.get('q'), url.searchParams.get('nivel')));

ruta('GET', '/api/imagenes', () => listarImagenes());
ruta('POST', '/api/imagenes', ({ body }) => subirImagen(body));
ruta('GET', '/api/aspecto', ({ db }) => g.getAspecto(db));
ruta('PUT', '/api/aspecto', ({ db, body }) => g.setAspecto(db, body));
ruta('GET', '/api/empresa', ({ db }) => g.getEmpresa(db));
ruta('PUT', '/api/empresa', ({ db, body }) => g.setEmpresa(db, body));
ruta('GET', '/api/gestion/:tabla', ({ db, params }) => g.listar(db, params[0]));
ruta('POST', '/api/gestion/:tabla', ({ db, params, body }) => g.crear(db, params[0], body));
ruta('PUT', '/api/gestion/:tabla/:id', ({ db, params, body }) => g.actualizar(db, params[0], num(params[1]), body));
ruta('POST', '/api/gestion/:tabla/ordenar', ({ db, params, body }) => g.ordenar(db, params[0], body));
ruta('DELETE', '/api/gestion/:tabla/:id', ({ db, params }) => g.borrar(db, params[0], num(params[1])));

// Avisos a todos los puestos conectados (TPV, PDA, KDS) cuando algo cambia.
const oyentes = new Set<ServerResponse>();
function avisar(tipo: string) {
  for (const r of oyentes) r.write(`data: ${JSON.stringify({ tipo, en: Date.now() })}\n\n`);
}

async function leerCuerpo(req: IncomingMessage) {
  const trozos: Buffer[] = [];
  let tam = 0;
  for await (const t of req) {
    tam += t.length;
    if (tam > 8_000_000) throw new v.ErrorTPV('Petición demasiado grande', 413);
    trozos.push(t);
  }
  if (!trozos.length) return {};
  try {
    return JSON.parse(Buffer.concat(trozos).toString('utf8'));
  } catch {
    throw new v.ErrorTPV('JSON no válido');
  }
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function estatico(res: ServerResponse, pathname: string) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const ruta = normalize(join(PUBLIC, rel));
  if (!ruta.startsWith(PUBLIC)) return json(res, 403, { error: 'Prohibido' });
  try {
    const datos = await readFile(ruta);
    // no-cache: el navegador comprueba siempre si hay una versión nueva tras actualizar el TPV.
    res.writeHead(200, { 'content-type': TIPOS[extname(ruta)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(datos);
  } catch {
    json(res, 404, { error: 'No encontrado' });
  }
}

export function crearServidor(db: DB) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origen = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    let body: any = {};
    try {
      if (url.pathname === '/api/eventos') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': conectado\n\n');
        oyentes.add(res);
        req.on('close', () => oyentes.delete(res));
        return;
      }
      if (url.pathname.startsWith('/imagenes/') && req.method === 'GET') {
        let rel = '';
        try { rel = decodeURIComponent(url.pathname.slice('/imagenes/'.length)); } catch {}
        const img = await leerImagen(rel);
        if (!img) return json(res, 404, { error: 'Imagen no encontrada' });
        res.writeHead(200, { 'content-type': img.tipo, 'cache-control': 'max-age=86400' });
        return res.end(img.datos);
      }
      if (url.pathname.startsWith('/api/')) {
        for (const r of rutas) {
          if (r.metodo !== req.method) continue;
          const m = r.patron.exec(url.pathname);
          if (!m) continue;
          body = r.metodo === 'GET' ? {} : await leerCuerpo(req);
          const data = await r.handler({ db, params: m.slice(1).map(decodeURIComponent), body, url });
          json(res, 200, data);
          if (r.cambia) {
            registrar(db, { accion: describir(r.metodo, url.pathname), metodo: r.metodo, ruta: url.pathname, estado: 200, origen, datos: body });
            avisar(url.pathname.split('/')[2]);
          }
          return;
        }
        return json(res, 404, { error: 'Ruta no encontrada' });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Método no permitido' });
      await estatico(res, url.pathname);
    } catch (e: any) {
      const status = e instanceof v.ErrorTPV ? e.status : 500;
      if (status === 500) console.error(e);
      if (url.pathname.startsWith('/api/')) {
        const metodo = req.method ?? '';
        registrar(db, {
          nivel: status >= 500 ? 'error' : 'aviso', accion: `${describir(metodo, url.pathname)}: ${status === 500 ? String(e?.message ?? e) : e.message}`,
          metodo, ruta: url.pathname, estado: status, origen, datos: body,
        });
      }
      json(res, status, { error: status === 500 ? 'Error interno del servidor' : e.message });
    }
  });
}
