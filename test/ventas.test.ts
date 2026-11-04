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
  const api = async (metodo: string, ruta: string, cuerpo?: unknown, cab: Record<string, string> = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...cab },
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
    // Borrar todo también cierra la cuenta.
    assert.equal(vacia.estado, 'vacia');
    assert.equal((await api('GET', '/cuentas')).data.length, 0);

    const b = ini.botones.find((x: any) => x.accion === 'nombre');
    const cambiado = (await api('PUT', `/gestion/botones/${b.id}`, { texto: 'Poner nombre', visible: false, color: '#ff0000' })).data;
    assert.equal(cambiado.texto, 'Poner nombre');
    assert.equal(cambiado.visible, 0);
    assert.equal((await api('POST', '/gestion/botones', { accion: 'abrir_cajas_fuertes', texto: 'x' })).status, 400);
  } finally { await cerrar(); }
});

test('configuración: va en el menú de arriba (no en la botonera) y existen las nuevas tablas', async () => {
  const { api, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    assert.ok(!ini.botones.some((b: any) => b.accion === 'configuracion'));
    assert.equal((await api('POST', '/gestion/botones', { accion: 'configuracion', texto: 'x' })).status, 400);
    assert.equal((await api('GET', '/gestion/ivas')).data.length, 3);
    assert.equal((await api('GET', '/gestion/puestos')).data.length, 1);
    assert.ok((await api('GET', '/gestion/conceptos_pago')).data.length > 0);
    const imp = (await api('POST', '/gestion/impresoras', { nombre: 'Cocina', ip: '192.168.1.50', uso: 'cocina' })).data;
    assert.equal(imp.puerto, 9100);
  } finally { await cerrar(); }
});

test('texto de comanda: se cambia para cocina pero el ticket lleva la descripción original', async () => {
  const { api, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    const cafe = ini.articulos.find((a: any) => a.nombre === 'Café solo');
    const delCafe = ini.comentarios.filter((c: any) => c.familia_id === cafe.familia_id).map((c: any) => c.texto);
    assert.ok(delCafe.includes('Con hielo'));
    const barra = ini.zonas.find((z: any) => z.tipo === 'barra');
    const tarjeta = ini.formas_cobro.find((f: any) => f.tipo === 'tarjeta');

    let c = (await api('POST', '/cuentas', { zona_id: barra.id })).data;
    c = (await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: cafe.id })).data;
    const id = c.lineas[0].id;
    c = (await api('PATCH', `/lineas/${id}`, { detalle: '  Café solo   con hielo ' })).data;
    assert.equal(c.lineas[0].detalle, 'Café solo con hielo');
    // Volver a la descripción original deja el texto de comanda vacío.
    c = (await api('PATCH', `/lineas/${id}`, { detalle: 'Café solo' })).data;
    assert.equal(c.lineas[0].detalle, '');
    await api('PATCH', `/lineas/${id}`, { detalle: 'Café solo con hielo' });

    const t = (await api('POST', `/cuentas/${c.id}/cobrar`, { forma_cobro_id: tarjeta.id })).data;
    assert.equal(t.lineas[0].descripcion, 'Café solo');
  } finally { await cerrar(); }
});

test('informe de borrados y registro de actividad', async () => {
  const { api, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    const barra = ini.zonas.find((z: any) => z.tipo === 'barra');
    const cafe = ini.articulos.find((a: any) => a.nombre === 'Café solo');
    const rabas = ini.articulos.find((a: any) => a.nombre === 'Rabas');
    const c = (await api('POST', '/cuentas', { zona_id: barra.id, nombre: 'esquina' })).data;
    let cu = (await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: cafe.id, unidades: 2 })).data;
    cu = (await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: rabas.id })).data;
    await api('DELETE', `/lineas/${cu.lineas[0].id}`);
    await api('DELETE', `/cuentas/${c.id}/lineas`);

    const r = (await api('GET', '/informes/borrados')).data;
    assert.equal(r.totales.lineas, 2);
    assert.equal(r.totales.importe, 280 + 1200);
    assert.equal(r.totales.cuentas, 1);
    assert.deepEqual(r.por_familia.map((f: any) => f.clave).sort(), ['Cafés', 'Raciones']);
    assert.equal(r.por_operario[0].clave, 'Sin operario');
    assert.equal(r.detalle[0].cuenta, 'Barra · esquina');

    await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: cafe.id }); // cuenta cerrada: error
    const reg = (await api('GET', '/registro')).data;
    const acciones = reg.map((x: any) => x.accion);
    assert.ok(acciones.includes('Borrar todo y cerrar la cuenta'));
    assert.ok(acciones.includes('Borrar línea'));
    assert.ok(reg.some((x: any) => x.nivel === 'aviso' && x.estado === 400));
    assert.ok((await api('GET', '/registro?q=Borrar')).data.every((x: any) => x.accion.includes('Borrar')));
    await api('POST', '/gestion/operarios', { nombre: 'Ana', pin: '9999' });
    assert.ok(!JSON.stringify((await api('GET', '/registro')).data).includes('9999'));
  } finally { await cerrar(); }
});

test('subfamilias: una familia no puede quedar dentro de sí misma', async () => {
  const { api, cerrar } = await arrancar();
  try {
    const comida = (await api('POST', '/gestion/familias', { nombre: 'Comida' })).data;
    const carne = (await api('POST', '/gestion/familias', { nombre: 'Carne', padre_id: comida.id })).data;
    const filete = (await api('POST', '/gestion/familias', { nombre: 'Filetes', padre_id: carne.id })).data;
    assert.equal(carne.padre_id, comida.id);
    assert.equal((await api('PUT', `/gestion/familias/${comida.id}`, { padre_id: filete.id })).status, 400);
    assert.equal((await api('PUT', `/gestion/familias/${comida.id}`, { padre_id: comida.id })).status, 400);
  } finally { await cerrar(); }
});

test('aspecto: se guarda, se valida y vuelve en /inicio', async () => {
  const { api, cerrar } = await arrancar();
  try {
    let ini = (await api('GET', '/inicio')).data;
    assert.equal(ini.aspecto.botonera_cols, 3);
    const a = (await api('PUT', '/aspecto', { botonera_cols: 2, familias_px: 300, color_principal: '#FF0000' })).data;
    assert.equal(a.botonera_cols, 2);
    assert.equal(a.color_principal, '#ff0000');
    assert.equal((await api('PUT', '/aspecto', { botonera_cols: 9 })).status, 400);
    assert.equal((await api('PUT', '/aspecto', { color_cobrar: 'red' })).status, 400);
    ini = (await api('GET', '/inicio')).data;
    assert.equal(ini.aspecto.familias_px, 300);
  } finally { await cerrar(); }
});

test('imágenes: subir, validar ruta y servir', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { usarCarpetaImagenes } = await import('../server/imagenes.ts');
  usarCarpetaImagenes(mkdtempSync(join(tmpdir(), 'img-')));
  const { api, cerrar } = await arrancar();
  try {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const r = (await api('POST', '/imagenes', { nombre: 'Café ../raro.png', datos: png })).data;
    assert.match(r.ruta, /^Propias\/Café raro(png)?\.png$/);
    const lista = (await api('GET', '/imagenes')).data;
    assert.ok(lista.carpetas.some((c: any) => c.nombre === 'Propias'));
    const art = (await api('POST', '/gestion/articulos', { nombre: 'Foto', precio: 100, imagen: r.ruta, color_fondo: '#AABBCC' })).data;
    assert.equal(art.imagen, r.ruta);
    assert.equal(art.color_fondo, '#aabbcc');
    assert.equal((await api('PUT', `/gestion/articulos/${art.id}`, { imagen: '../datos/tpv.db' })).status, 400);
    assert.equal((await api('PUT', `/gestion/articulos/${art.id}`, { color_texto: 'rojo' })).status, 400);
  } finally { await cerrar(); }
});

test('ordenar: guarda el orden nuevo de artículos y rechaza tablas sin orden', async () => {
  const { api, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    const cafe = ini.articulos.find((a: any) => a.nombre === 'Café solo');
    const ids = ini.articulos.filter((a: any) => a.familia_id === cafe.familia_id).map((a: any) => a.id).reverse();
    assert.deepEqual((await api('POST', '/gestion/articulos/ordenar', { ids })).data, { ordenados: ids.length });
    const despues = (await api('GET', '/inicio')).data.articulos.filter((a: any) => a.familia_id === cafe.familia_id).map((a: any) => a.id);
    assert.deepEqual(despues, ids);
    assert.equal((await api('POST', '/gestion/departamentos/ordenar', { ids: [1] })).status, 400);
    assert.equal((await api('POST', '/gestion/botones/ordenar', { ids: [1, 1] })).status, 400);
  } finally { await cerrar(); }
});

test('alérgenos e imágenes automáticas', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { usarCarpetaImagenes } = await import('../server/imagenes.ts');
  const dir = mkdtempSync(join(tmpdir(), 'img-'));
  mkdirSync(join(dir, 'Alergenos')); mkdirSync(join(dir, 'articulos'));
  for (const f of ['Alergenos/trigo.png', 'Alergenos/leche.png', 'articulos/ColaCao.bmp', 'articulos/cafesolo2.bmp', 'articulos/rabas.bmp']) writeFileSync(join(dir, f), 'x');
  usarCarpetaImagenes(dir);
  const { api, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    assert.equal(ini.alergenos.length, 14);
    assert.equal(ini.alergenos.find((a: any) => a.codigo === 'gluten').imagen, 'Alergenos/trigo.png');
    assert.equal(ini.alergenos.find((a: any) => a.codigo === 'sesamo').imagen, '');
    const rabas = ini.articulos.find((a: any) => a.nombre === 'Rabas');
    const r = (await api('PUT', `/gestion/articulos/${rabas.id}`, { alergenos: 'gluten,pescado,gluten' })).data;
    assert.equal(r.alergenos, 'gluten,pescado');
    assert.equal((await api('PUT', `/gestion/articulos/${rabas.id}`, { alergenos: 'polen' })).status, 400);

    const auto = (await api('POST', '/imagenes/asignar', {})).data;
    const puestas = Object.fromEntries(auto.puestas.map((x: any) => [x.nombre, x.imagen]));
    assert.equal(puestas['Colacao'], 'articulos/ColaCao.bmp');
    assert.equal(puestas['Café solo'], 'articulos/cafesolo2.bmp');
    assert.equal(puestas['Rabas'], 'articulos/rabas.bmp');
    assert.ok(auto.sin.includes('Txakoli'));
  } finally { await cerrar(); }
});

test('orden de plato, comanda agrupada y marchar', async () => {
  const { api, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    const nombres = ini.ordenes_plato.map((o: any) => o.nombre);
    assert.deepEqual(nombres, ['Entrantes', 'Primeros', 'Segundos', 'Postres', 'Bebidas']);
    const segundos = ini.ordenes_plato.find((o: any) => o.nombre === 'Segundos');
    const postres = ini.ordenes_plato.find((o: any) => o.nombre === 'Postres');
    const comedor = ini.zonas.find((z: any) => z.nombre === 'Comedor');
    const mesa = ini.mesas.find((m: any) => m.zona_id === comedor.id);
    const tarta = ini.articulos.find((a: any) => a.nombre === 'Tarta de queso');
    const rabas = ini.articulos.find((a: any) => a.nombre === 'Rabas');
    const cana = ini.articulos.find((a: any) => a.nombre === 'Caña');
    assert.equal(tarta.orden_plato_id, postres.id); // migrado desde el antiguo grupo de cocina

    const c = (await api('POST', '/cuentas', { zona_id: comedor.id, mesa_id: mesa.id })).data;
    await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: tarta.id });
    let cu = (await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: rabas.id })).data;
    cu = (await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: cana.id })).data;
    const lRabas = cu.lineas.find((l: any) => l.descripcion === 'Rabas');
    cu = (await api('POST', `/cuentas/${c.id}/orden_plato`, { orden_plato_id: segundos.id, lineas: [lRabas.id] })).data;
    assert.equal(cu.lineas.find((l: any) => l.id === lRabas.id).orden_plato_id, segundos.id);

    const com = (await api('GET', `/cuentas/${c.id}/comanda`)).data;
    assert.deepEqual(com.grupos.map((g: any) => g.nombre), ['Segundos', 'Postres', 'Sin orden']);
    assert.match(com.cuenta, /de Comedor$/);
    const m = (await api('POST', `/cuentas/${c.id}/marchar`, { orden_plato_id: segundos.id })).data;
    assert.match(m.texto, /^MARCHAR Segundos · .* de Comedor$/);
    assert.equal((await api('GET', '/cocina/marchas')).data.length, 1);
  } finally { await cerrar(); }
});

test('operarios: clave, RFID, permisos por puesto y control de empleados', async () => {
  const { db, cerrar } = await arrancar();
  const srv = crearServidor(db);
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`;
  const api = async (metodo: string, ruta: string, cuerpo?: unknown, cab: Record<string, string> = {}) => {
    const r = await fetch(base + ruta, { method: metodo, headers: { ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...cab }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, data: await r.json() as any };
  };
  try {
    const ini = (await api('GET', '/inicio')).data;
    const encargado = ini.operarios.find((o: any) => o.nombre === 'Encargado');
    assert.ok(encargado.con_clave);
    assert.ok(!('pin' in encargado));
    assert.ok(encargado.permisos.includes('configuracion'));
    const ana = (await api('POST', '/gestion/operarios', { nombre: 'Ana', rfid: 'AB12CD', permisos: 'cobrar' })).data;
    assert.equal((await api('POST', '/gestion/operarios', { nombre: 'Otro', rfid: 'AB12CD' })).status, 400);

    assert.equal((await api('POST', '/operarios/entrar', { operario_id: encargado.id, clave: '0000' })).status, 400);
    assert.equal((await api('POST', '/operarios/entrar', { operario_id: encargado.id, clave: '1234' })).data.nombre, 'Encargado');
    assert.equal((await api('POST', '/operarios/entrar', { rfid: 'AB12CD' })).data.nombre, 'Ana');

    const puesto = ini.puestos[0];
    await api('PUT', `/gestion/puestos/${puesto.id}`, { usar_permisos: true });
    const comoAna = { 'x-operario': String(ana.id), 'x-puesto': String(puesto.id) };
    const comoJefe = { 'x-operario': String(encargado.id), 'x-puesto': String(puesto.id) };
    const barra = ini.zonas.find((z: any) => z.tipo === 'barra');
    const tarjeta = ini.formas_cobro.find((f: any) => f.tipo === 'tarjeta');
    const c = (await api('POST', '/cuentas', { zona_id: barra.id }, comoAna)).data;
    let cu = (await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: ini.articulos[0].id, unidades: 2 }, comoAna)).data;
    cu = (await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: ini.articulos[1].id }, comoAna)).data;
    // Ana no puede borrar líneas ni entrar en configuración; sin operario tampoco se puede cobrar.
    const r1 = await api('DELETE', `/lineas/${cu.lineas[1].id}`, undefined, comoAna);
    assert.equal(r1.status, 403);
    assert.match(r1.data.error, /Borrar líneas/);
    assert.equal((await api('PUT', `/gestion/puestos/${puesto.id}`, { nombre: 'x' }, comoAna)).status, 403);
    assert.equal((await api('POST', `/cuentas/${c.id}/cobrar`, { forma_cobro_id: tarjeta.id }, { 'x-puesto': String(puesto.id) })).status, 403);
    assert.equal((await api('DELETE', `/lineas/${cu.lineas[1].id}`, undefined, comoJefe)).status, 200);
    const t = (await api('POST', `/cuentas/${c.id}/cobrar`, { forma_cobro_id: tarjeta.id }, comoAna)).data;
    assert.equal(t.operario_id, ana.id);

    const inf = (await api('GET', '/informes/empleados', undefined, comoJefe)).data;
    const filaAna = inf.empleados.find((e: any) => e.nombre === 'Ana');
    const filaJefe = inf.empleados.find((e: any) => e.nombre === 'Encargado');
    assert.equal(filaAna.tickets, 1);
    assert.equal(filaAna.unidades, 2);
    assert.equal(filaJefe.lineas_borradas, 1);
    assert.ok(inf.actividad.some((a: any) => a.operario === 'Ana' && a.accion === 'Cobrar cuenta'));
    assert.equal((await api('GET', '/informes/empleados', undefined, comoAna)).status, 403);
  } finally { await new Promise(r => srv.close(r)); await cerrar(); }
});

test('cierre de caja: totales por forma de pago, cuadre, cierre ciego e informe', async () => {
  const { api, db, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    const comedor = ini.zonas.find((z: any) => z.nombre === 'Comedor');
    const mesa = ini.mesas.find((m: any) => m.zona_id === comedor.id);
    const barra = ini.zonas.find((z: any) => z.tipo === 'barra');
    const ef = ini.formas_cobro.find((f: any) => f.tipo === 'efectivo');
    const tj = ini.formas_cobro.find((f: any) => f.tipo === 'tarjeta');
    const [a1, a2] = ini.articulos;
    const vender = async (zona: any, mesaId: number | null, art: any, unidades: number, forma: any) => {
      const c = (await api('POST', '/cuentas', { zona_id: zona.id, mesa_id: mesaId })).data;
      await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: art.id, unidades });
      return (await api('POST', `/cuentas/${c.id}/cobrar`, { forma_cobro_id: forma.id, entregado: 100000 })).data;
    };
    await vender(comedor, mesa.id, a1, 3, ef);
    await vender(barra, null, a2, 1, tj);
    // Una cuenta borrada entera.
    const cb = (await api('POST', '/cuentas', { zona_id: barra.id })).data;
    await api('POST', `/cuentas/${cb.id}/lineas`, { articulo_id: a2.id, unidades: 2 });
    await api('DELETE', `/cuentas/${cb.id}/lineas`);
    // Venta del año pasado (mismo día de la semana) para la comparativa.
    const viejo = Number(db.prepare("INSERT INTO cierres (resumen) VALUES ('{}')").run().lastInsertRowid);
    db.prepare(`INSERT INTO tickets (serie, numero, emitido_en, total, forma_cobro_id, huella_anterior, huella, cierre_id)
                VALUES ('X', 1, datetime('now', '-364 days'), 500, ?, '', '', ?)`).run(ef.id, viejo);

    const caja = (await api('GET', '/caja')).data;
    const total = 3 * a1.precio + a2.precio;
    assert.equal(caja.total, total);
    assert.equal(caja.por_forma.find((f: any) => f.id === ef.id).total, 3 * a1.precio);
    assert.equal(caja.articulos[0].unidades, 3);
    assert.equal(caja.zonas.length, 2);
    assert.equal(caja.mesas[0].nombre, mesa.nombre);
    assert.equal(caja.borrados.cuentas, 1);
    assert.equal(caja.comparativa.total_anterior, 500);
    assert.equal(caja.formas_contar.length, 2);

    // Cierre ciego en el puesto: Ana (sin permiso de cuadre) no ve importes y tiene que contar todo.
    const puesto = ini.puestos[0];
    await api('PUT', `/gestion/puestos/${puesto.id}`, { cierre_ciego: true, cierre_secciones: 'articulos,familias' });
    const ana = (await api('POST', '/gestion/operarios', { nombre: 'Ana', permisos: 'cobrar,cierre_caja' })).data;
    const encargado = ini.operarios.find((o: any) => o.nombre === 'Encargado');
    const comoAna = { 'x-operario': String(ana.id), 'x-puesto': String(puesto.id) };
    const comoJefe = { 'x-operario': String(encargado.id), 'x-puesto': String(puesto.id) };
    const oculta = (await api('GET', '/caja', undefined, comoAna)).data;
    assert.equal(oculta.oculto, true);
    assert.equal(oculta.total, undefined);
    assert.equal((await api('POST', '/caja/cierre', { contado: { [ef.id]: 1000 } }, comoAna)).status, 400);
    const ci = (await api('POST', '/caja/cierre', { fondo_inicial: 5000, contado: { [ef.id]: 5000 + 3 * a1.precio - 50, [tj.id]: a2.precio } }, comoAna)).data;
    assert.equal(ci.oculto, true);
    assert.equal(ci.total, undefined);
    assert.equal(ci.contado.length, 2);

    // El encargado ve el cuadre: falta 0,50 en efectivo y la tarjeta cuadra.
    const det = (await api('GET', `/informes/cierres/${ci.id}`, undefined, comoJefe)).data;
    assert.equal(det.total, total);
    assert.equal(det.cuadre.find((f: any) => f.id === ef.id).diferencia, -50);
    assert.equal(det.cuadre.find((f: any) => f.id === tj.id).diferencia, 0);
    assert.deepEqual(det.secciones, ['articulos', 'familias']);
    assert.equal(det.operario, 'Ana');
    const lista = (await api('GET', '/informes/cierres', undefined, comoJefe)).data;
    assert.equal(lista[0].descuadre, -50);
    // Tras el cierre, todo empieza de cero (también los borrados).
    const nueva = (await api('GET', '/caja', undefined, comoJefe)).data;
    assert.equal(nueva.total, 0);
    assert.equal(nueva.borrados.cuentas, 0);
  } finally { await cerrar(); }
});

test('carta de demostración: sustituye familias y artículos', async () => {
  const { api, db, cerrar } = await arrancar();
  try {
    const ini = (await api('GET', '/inicio')).data;
    // Una venta anterior no impide cargar la carta; una cuenta abierta con artículos, sí.
    const barra = ini.zonas.find((z: any) => z.tipo === 'barra');
    const c = (await api('POST', '/cuentas', { zona_id: barra.id })).data;
    await api('POST', `/cuentas/${c.id}/lineas`, { articulo_id: ini.articulos[0].id });
    assert.equal((await api('POST', '/carta-demo')).status, 400);
    await api('POST', `/cuentas/${c.id}/cobrar`, { forma_cobro_id: ini.formas_cobro[0].id, entregado: 10000 });
    const r = (await api('POST', '/carta-demo')).data;
    assert.deepEqual(r, { familias: 23, articulos: 140 });
    const nuevo = (await api('GET', '/inicio')).data;
    const cafes = nuevo.familias.find((f: any) => f.nombre === 'CAFES');
    assert.equal(cafes.imagen, 'Carta/cafe.svg');
    const cana = nuevo.articulos.find((a: any) => a.nombre === 'CAÑA');
    assert.equal(cana.precio, 280);
    assert.equal(cana.iva, 10);
    assert.ok(cana.orden_plato_id);
    assert.ok(nuevo.comentarios.some((x: any) => x.familia_id === cafes.id && x.texto === 'Con hielo'));
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as any).n, 1);
  } finally { await cerrar(); }
});
