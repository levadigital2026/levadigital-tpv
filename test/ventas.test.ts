import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../server/db.ts';
import { crearServidor } from '../server/app.ts';
import { calcularHuella, desgloseIva } from '../server/ventas.ts';

async function arrancar() {
  const db = openDb(':memory:');
  const srv = crearServidor(db);
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`;
  const api = async (metodo: string, ruta: string, cuerpo?: unknown) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: cuerpo ? { 'content-type': 'application/json' } : {},
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    return { status: r.status, data: await r.json() as any };
  };
  return { db, api, cerrar: () => new Promise(r => srv.close(r)) };
}

test('venta completa en mesa: abrir, añadir, cambiar unidades y cobrar en efectivo', async () => {
  const { api, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    const comedor = ini.zonas.find((z: any) => z.nombre === 'Comedor');
    const mesa = ini.mesas.find((m: any) => m.zona_id === comedor.id);
    const cana = ini.articulos.find((a: any) => a.nombre === 'Caña');
    const rabas = ini.articulos.find((a: any) => a.nombre === 'Rabas');
    const efectivo = ini.formas_cobro.find((f: any) => f.tipo === 'efectivo');

    let c = (await api('POST', '/cuentas', { zona_id: comedor.id, mesa_id: mesa.id, comensales: 2 })).data;
    // Abrir otra vez la misma mesa devuelve la misma cuenta.
    assert.equal((await api('POST', '/cuentas', { zona_id: comedor.id, mesa_id: mesa.id })).data.id, c.id);

    c = (await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: cana.id })).data;
    c = (await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: rabas.id })).data;
    c = (await api('PATCH', `/lineas/${c.lineas[0].id}`, { unidades: 3 })).data;
    assert.equal(c.total, 3 * 220 + 1200);

    const corto = await api('POST', `/cuentas/${c.id}/cobrar`, { forma_cobro_id: efectivo.id, entregado: 1000 });
    assert.equal(corto.status, 400);

    const t = (await api('POST', `/cuentas/${c.id}/cobrar`, { forma_cobro_id: efectivo.id, entregado: 2000 })).data;
    assert.equal(t.numero, 1);
    assert.equal(t.total, 1860);
    assert.equal(t.cambio, 140);
    assert.equal(t.lineas.length, 2);
    assert.deepEqual(t.impuestos, [{ iva: 10, base: 1691, cuota: 169, total: 1860 }]);

    // Ya no se puede tocar una cuenta cobrada y la mesa queda libre.
    assert.equal((await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: cana.id })).status, 400);
    assert.equal((await api('GET', '/cuentas')).data.length, 0);
  } finally { await cerrar(); }
});

test('los tickets se numeran seguidos, se encadenan y se anulan con ticket negativo', async () => {
  const { api, db, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    const barra = ini.zonas.find((z: any) => z.tipo === 'barra');
    const cafe = ini.articulos.find((a: any) => a.nombre === 'Café solo');
    const tarjeta = ini.formas_cobro.find((f: any) => f.tipo === 'tarjeta');

    const vender = async () => {
      const c = (await api('POST', '/cuentas', { zona_id: barra.id })).data;
      await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: cafe.id, unidades: 2 });
      return (await api('POST', `/cuentas/${c.id}/cobrar`, { forma_cobro_id: tarjeta.id })).data;
    };
    const t1 = await vender();
    const t2 = await vender();
    assert.equal(t2.numero, t1.numero + 1);
    assert.equal(t2.huella_anterior, t1.huella);
    assert.equal(t1.huella, calcularHuella('', t1));

    const anul = (await api('POST', `/tickets/${t1.id}/anular`)).data;
    assert.equal(anul.total, -280);
    assert.equal(anul.anula_ticket_id, t1.id);
    assert.equal(anul.huella_anterior, t2.huella);
    assert.equal((await api('POST', `/tickets/${t1.id}/anular`)).status, 400);

    const caja = (await api('GET', '/caja')).data;
    assert.equal(caja.total, 280);

    const cierre = (await api('POST', '/caja/cierre', { fondo_inicial: 10000 })).data;
    assert.equal(cierre.total, 280);
    assert.equal((await api('GET', '/caja')).data.total, 0);
    assert.equal((await api('GET', '/tickets')).data.length, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as any).n, 3);
  } finally { await cerrar(); }
});

test('gestión: crear familia y artículo; un artículo vendido se desactiva en vez de borrarse', async () => {
  const { api, cerrar } = await arrancar();
  try {
    const fam = (await api('POST', '/gestion/familias', { nombre: 'Combinados', color: '#123456' })).data;
    const art = (await api('POST', '/gestion/articulos', { nombre: 'Gin tonic', precio: 800, iva: 10, familia_id: fam.id })).data;
    assert.equal(art.familia_id, fam.id);
    assert.equal((await api('POST', '/gestion/articulos', { precio: 100 })).status, 400);
    assert.equal((await api('GET', '/gestion/usuarios_secretos')).status, 404);

    const ini = (await api('GET', '/inicio')).data;
    const barra = ini.zonas.find((z: any) => z.tipo === 'barra');
    const c = (await api('POST', '/cuentas', { zona_id: barra.id })).data;
    await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: art.id });
    assert.deepEqual((await api('DELETE', `/gestion/articulos/${art.id}`)).data, { desactivado: true });
    assert.equal((await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: art.id })).status, 400);
  } finally { await cerrar(); }
});

test('desglose de IVA con varios tipos', () => {
  assert.deepEqual(desgloseIva([{ iva: 21, importe: 1210 }, { iva: 10, importe: 550 }, { iva: 10, importe: 550 }]), [
    { iva: 10, base: 1000, cuota: 100, total: 1100 },
    { iva: 21, base: 1000, cuota: 210, total: 1210 },
  ]);
});

test('borrar todas las líneas y botonera configurable', async () => {
  const { api, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    assert.ok(ini.botones.length >= 10);
    assert.ok(ini.acciones.borrar_todo);
    const barra = ini.zonas.find((z: any) => z.tipo === 'barra');
    const c = (await api('POST', '/cuentas', { zona_id: barra.id })).data;
    await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: ini.articulos[0].id });
    await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: ini.articulos[1].id });
    const vacia = (await api('DELETE', `/cuentas/${c.id}/lineas`)).data;
    assert.equal(vacia.lineas.length, 0);
    assert.equal(vacia.total, 0);

    const b = ini.botones.find((x: any) => x.accion === 'nombre');
    const cambiado = (await api('PUT', `/gestion/botones/${b.id}`, { texto: 'Poner nombre', visible: false, color: '#ff0000' })).data;
    assert.equal(cambiado.texto, 'Poner nombre');
    assert.equal(cambiado.visible, 0);
    assert.equal((await api('POST', '/gestion/botones', { accion: 'abrir_cajas_fuertes', texto: 'x' })).status, 400);
  } finally { await cerrar(); }
});

test('configuración: el botón de herramientas no se puede quitar y existen las nuevas tablas', async () => {
  const { api, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    const conf = ini.botones.find((b: any) => b.accion === 'configuracion');
    assert.ok(conf);
    assert.equal((await api('PUT', `/gestion/botones/${conf.id}`, { visible: false })).status, 400);
    assert.equal((await api('DELETE', `/gestion/botones/${conf.id}`)).status, 400);
    assert.equal((await api('PUT', `/gestion/botones/${conf.id}`, { color: '#000000' })).status, 200);
    assert.equal((await api('GET', '/gestion/ivas')).data.length, 3);
    assert.equal((await api('GET', '/gestion/puestos')).data.length, 1);
    assert.ok((await api('GET', '/gestion/conceptos_pago')).data.length > 0);
    const imp = (await api('POST', '/gestion/impresoras', { nombre: 'Cocina', ip: '192.168.1.50', uso: 'cocina' })).data;
    assert.equal(imp.puerto, 9100);
  } finally { await cerrar(); }
});
