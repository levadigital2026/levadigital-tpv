// Aplicación web del TPV LevaDigital (TPV, PDA). Sin dependencias.

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euros = c => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const uds = n => Number.isInteger(n) ? String(n) : n.toLocaleString('es-ES', { maximumFractionDigits: 3 });
const hora = iso => new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  .toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function api(metodo, ruta, cuerpo) {
  const r = await fetch('/api' + ruta, {
    method: metodo,
    headers: cuerpo ? { 'content-type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || 'Error de comunicación');
  return datos;
}

function aviso(texto, error = false) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.toggle('error', error);
  el.classList.remove('oculto');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.add('oculto'), error ? 4000 : 2000);
}

async function intentar(fn) {
  try { return await fn(); } catch (e) { aviso(e.message, true); }
}

function abrirModal(html) {
  $('#modal-caja').innerHTML = html;
  $('#modal').classList.remove('oculto');
}
function cerrarModal() {
  $('#modal').classList.add('oculto');
  $('#modal-caja').innerHTML = '';
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') cerrarModal(); });

// ---------- Estado ----------
const E = {
  vista: 'venta',
  datos: null,          // catálogo, zonas, mesas, formas de cobro
  familia: null,        // familia seleccionada
  cuenta: null,         // cuenta en pantalla
  abiertas: [],
  lineaSel: null,
  calc: '',             // lo tecleado en la calculadora
  zonaMesas: null,
  ticketSel: null,
  tablaGestion: 'articulos',
  verTeclado: (() => { try { return localStorage.getItem('verTeclado') === '1'; } catch { return false; } })(),
};

async function cargarDatos() {
  E.datos = await api('GET', '/inicio');
  if (!E.datos.botones) {
    throw new Error('El servidor del TPV es de una versión anterior. Cierra todas las ventanas negras del TPV y vuelve a abrir "Iniciar TPV.bat".');
  }
  $('#local').textContent = E.datos.empresa.nombre;
  const raices = familiasRaiz();
  if (!E.familia || !E.datos.familias.some(f => f.id === E.familia)) E.familia = raices[0]?.id ?? null;
}
const familiasRaiz = () => E.datos.familias.filter(f => !f.padre_id);
const zonaBarra = () => E.datos.zonas.find(z => z.tipo === 'barra') ?? E.datos.zonas[0];

async function cargarAbiertas() {
  E.abiertas = await api('GET', '/cuentas');
}

function nombreCuenta(c) {
  if (!c) return 'Nueva cuenta';
  if (c.mesa_nombre) return `${c.zona_nombre} · ${c.mesa_nombre}`;
  return c.nombre ? `${c.zona_nombre} · ${c.nombre}` : `${c.zona_nombre} · cuenta ${c.id}`;
}

// ---------- Navegación ----------
const VISTAS = { venta: pintarVenta, mesas: pintarMesas, tickets: pintarTickets, caja: pintarCaja, gestion: () => pintarGestion(), config: pintarConfig, abiertas: pintarAbiertas, empresa: pintarEmpresa };
function ir(vista) {
  E.vista = vista;
  document.querySelectorAll('#menu button').forEach(b => b.classList.toggle('activo', b.dataset.vista === vista));
  return VISTAS[vista]();
}
$('#menu').addEventListener('click', e => { const b = e.target.closest('button'); if (b) intentar(() => ir(b.dataset.vista)); });

// ---------- Venta ----------
async function pintarVenta() {
  $('#vista').onclick = null;
  await cargarAbiertas();
  if (E.cuenta) {
    E.cuenta = await api('GET', `/cuentas/${E.cuenta.id}`).catch(() => null);
    if (E.cuenta && E.cuenta.estado !== 'abierta') E.cuenta = null;
  }
  const c = E.cuenta;
  const famActual = E.datos.familias.find(f => f.id === E.familia);
  const subfamilias = E.datos.familias.filter(f => f.padre_id === E.familia);
  const arts = E.datos.articulos.filter(a => a.activo && a.familia_id === E.familia);
  const colorDe = id => E.datos.familias.find(f => f.id === id)?.color ?? '#0064fc';

  $('#vista').innerHTML = `
  <div class="venta ${E.verTeclado ? 'ver-teclado' : ''}">
    <section class="panel cuenta">
      <div class="cuenta-cab">
        <div><b>${esc(nombreCuenta(c))}</b><small>${c ? `${c.comensales ? c.comensales + ' comensales · ' : ''}abierta ${hora(c.abierta_en)}` : 'Toca un artículo para empezar'}</small></div>
        <button id="b-teclado" title="Mostrar u ocultar la calculadora" class="${E.verTeclado ? 'activo' : ''}">123</button>
      </div>
      <div class="lineas">
        ${c && c.lineas.length ? c.lineas.map(l => `
          <div class="linea-caja">
            <button class="linea-anular" data-anular="${l.id}">Anular</button>
            <div class="linea ${l.id === E.lineaSel ? 'sel' : ''}" data-linea="${l.id}">
              <span class="uds">${uds(l.unidades)}</span><span>${esc(l.descripcion)}</span><span>${euros(Math.round(l.unidades * l.precio))}</span>
              ${l.detalle ? `<span class="det">${esc(l.detalle)}</span>` : ''}
            </div>
          </div>`).join('') : '<div class="vacio">Sin artículos</div>'}
      </div>
      <div class="total"><span>Total</span><span>${euros(c?.total ?? 0)}</span></div>
      <div class="teclado">
        <div class="pantalla" id="calc">${esc(E.calc)}</div>
        ${['7', '8', '9', 'C', '4', '5', '6', 'Un', '1', '2', '3', '€', '0', ',', '00', '⌫'].map(k =>
          `<button data-tecla="${k}">${k}</button>`).join('')}
      </div>
      <div class="acciones">
        ${E.datos.botones.filter(b => b.visible).map(b => `<button data-accion="${esc(b.accion)}" ${b.color ? `class="color" style="--bc:${esc(b.color)}"` : ''}
          ${accionActiva(b.accion, c) ? '' : 'disabled'} title="${esc(b.texto)}">${b.accion === 'configuracion' ? ICONO_HERRAMIENTAS : esc(b.texto)}</button>`).join('')}
      </div>
      <div class="fila-cobrar"><button class="cobrar" id="b-cobrar" ${c?.lineas.length ? '' : 'disabled'}>Cobrar ${c?.lineas.length ? euros(c.total) : ''}</button></div>
    </section>
    <section class="panel familias">
      ${familiasRaiz().map(f => `<button data-familia="${f.id}" style="--c:${esc(f.color)}" class="${f.id === E.familia || famActual?.padre_id === f.id ? 'activa' : ''}">${esc(f.nombre)}</button>`).join('')}
    </section>
    <section class="panel articulos">
      ${famActual?.padre_id ? `<button data-familia="${famActual.padre_id}">← Volver</button>` : ''}
      ${subfamilias.map(f => `<button data-familia="${f.id}" style="--c:${esc(f.color)}"><b>${esc(f.nombre)}</b><span>Subfamilia</span></button>`).join('')}
      ${arts.map(a => `<button data-articulo="${a.id}" style="--c:${esc(colorDe(a.familia_id))}"><b>${esc(a.nombre)}</b><span>${euros(a.precio)}</span></button>`).join('')}
      ${!arts.length && !subfamilias.length ? '<div class="vacio">Esta familia no tiene artículos</div>' : ''}
    </section>
  </div>`;
}

async function asegurarCuenta() {
  if (E.cuenta) return E.cuenta;
  E.cuenta = await api('POST', '/cuentas', { zona_id: zonaBarra().id });
  return E.cuenta;
}

function numeroCalc() {
  if (!E.calc) return null;
  const n = Number(E.calc.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

async function tecla(k) {
  if (/^[0-9]+$/.test(k)) { if (E.calc.length < 9) E.calc += k; }
  else if (k === '⌫') E.calc = E.calc.slice(0, -1);
  else if (k === ',') { if (!E.calc.includes(',')) E.calc = (E.calc || '0') + ','; }
  else if (k === 'C') E.calc = '';
  else if (k === 'Un' || k === '€') {
    const n = numeroCalc();
    if (!E.lineaSel) return aviso('Selecciona primero una línea de la cuenta', true);
    if (n === null) return aviso('Escribe primero la cantidad en la calculadora', true);
    const cambio = k === 'Un' ? { unidades: n } : { precio: Math.round(n * 100) };
    E.cuenta = await api('PATCH', `/lineas/${E.lineaSel}`, cambio);
    E.calc = '';
    return pintarVenta();
  }
  $('#calc').textContent = E.calc;
}

const ICONO_HERRAMIENTAS = `<svg viewBox="0 0 24 24" width="22" height="22" aria-label="Configuración" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/></svg>`;

// Botonera configurable: qué hace cada acción y cuándo está disponible.
function accionActiva(accion, c) {
  const conLineas = !!c?.lineas?.length;
  switch (accion) {
    case 'guardar': case 'comensales': case 'nombre': return !!c;
    case 'preticket': case 'borrar_todo': case 'efectivo_exacto': case 'tarjeta': return conLineas;
    case 'borrar_linea': case 'detalle': return conLineas && !!E.lineaSel;
    default: return true;
  }
}

async function borrarLinea(id) {
  E.cuenta = await api('DELETE', `/lineas/${id}`);
  if (E.lineaSel === id) E.lineaSel = null;
  return pintarVenta();
}

async function cobroRapido(tipo) {
  const fc = E.datos.formas_cobro.find(f => f.activa && f.tipo === tipo);
  if (!fc) return aviso('No hay ninguna forma de cobro de ese tipo activa', true);
  const ticket = await api('POST', `/cuentas/${E.cuenta.id}/cobrar`, { forma_cobro_id: fc.id });
  E.cuenta = null;
  E.lineaSel = null;
  verTicket(ticket);
  return pintarVenta();
}

async function accion(a) {
  const c = E.cuenta;
  switch (a) {
    case 'guardar': return guardarCuenta();
    case 'preticket': return verPreticket();
    case 'nueva': E.cuenta = null; E.lineaSel = null; return pintarVenta();
    case 'mesas': return ir('mesas');
    case 'configuracion': return ir('config');
    case 'borrar_linea': return borrarLinea(E.lineaSel);
    case 'borrar_todo':
      if (!confirm('¿Borrar todas las líneas de la cuenta?')) return;
      E.cuenta = await api('DELETE', `/cuentas/${c.id}/lineas`);
      E.lineaSel = null;
      return pintarVenta();
    case 'detalle': {
      const l = c.lineas.find(x => x.id === E.lineaSel);
      const texto = prompt('Detalle para cocina (ej.: sin sal, poco hecho)', l?.detalle ?? '');
      if (texto === null) return;
      E.cuenta = await api('PATCH', `/lineas/${E.lineaSel}`, { detalle: texto });
      return pintarVenta();
    }
    case 'comensales': {
      const r = prompt('Número de comensales', String(c.comensales || ''));
      if (r === null) return;
      E.cuenta = await api('PATCH', `/cuentas/${c.id}`, { comensales: Number(r) || 0 });
      return pintarVenta();
    }
    case 'nombre': {
      const r = prompt('Nombre de la cuenta', c.nombre || '');
      if (r === null) return;
      E.cuenta = await api('PATCH', `/cuentas/${c.id}`, { nombre: r.trim() });
      return pintarVenta();
    }
    case 'efectivo_exacto': return cobroRapido('efectivo');
    case 'tarjeta': return cobroRapido('tarjeta');
    case 'ultimo_ticket': {
      const lista = await api('GET', '/tickets?todos=1');
      if (!lista.length) return aviso('Todavía no hay tickets', true);
      return verTicket(await api('GET', `/tickets/${lista[0].id}`));
    }
  }
}

// Deslizar una línea hacia la izquierda muestra el botón Anular.
let arrastre = null;
$('#vista').addEventListener('pointerdown', e => {
  const l = e.target.closest('.linea');
  if (!l || E.vista !== 'venta') return;
  document.querySelectorAll('.linea.abierta').forEach(x => { if (x !== l) x.classList.remove('abierta'); });
  arrastre = { el: l, x0: e.clientX, y0: e.clientY, dx: 0, base: l.classList.contains('abierta') ? -96 : 0, movido: false };
});
$('#vista').addEventListener('pointermove', e => {
  if (!arrastre) return;
  const dx = e.clientX - arrastre.x0;
  if (!arrastre.movido && Math.abs(dx) < 8) return;
  if (!arrastre.movido && Math.abs(e.clientY - arrastre.y0) > Math.abs(dx)) { arrastre = null; return; }
  arrastre.movido = true;
  arrastre.dx = dx;
  arrastre.el.style.transition = 'none';
  arrastre.el.style.transform = `translateX(${Math.max(-120, Math.min(0, arrastre.base + dx))}px)`;
});
const soltar = () => {
  if (!arrastre) return;
  const { el, base, dx, movido } = arrastre;
  el.style.transition = '';
  el.style.transform = '';
  if (movido) {
    el.classList.toggle('abierta', base + dx < -48);
    el.dataset.arrastrado = '1';
  }
  arrastre = null;
};
$('#vista').addEventListener('pointerup', soltar);
$('#vista').addEventListener('pointercancel', soltar);

async function guardarCuenta() {
  const c = E.cuenta;
  if (!c) return;
  if (!c.mesa_id && !c.nombre && c.lineas.length) {
    const nombre = prompt('Nombre para encontrar la cuenta (ej.: barba, esquina)', '');
    if (nombre === null) return;
    if (nombre.trim()) await api('PATCH', `/cuentas/${c.id}`, { nombre: nombre.trim() });
  }
  E.cuenta = null;
  E.lineaSel = null;
  aviso('Cuenta guardada');
  return pintarVenta();
}

$('#vista').addEventListener('click', e => intentar(async () => {
  if (E.vista !== 'venta') return;
  const b = e.target.closest('[data-familia],[data-articulo],[data-cuenta],[data-tecla],[data-anular],[data-linea],[data-accion],button');
  if (!b) return;
  if (b.dataset.familia) { E.familia = Number(b.dataset.familia); return pintarVenta(); }
  if (b.dataset.articulo) {
    const cuenta = await asegurarCuenta();
    const n = numeroCalc();
    E.cuenta = await api('POST', `/cuentas/${cuenta.id}/lineas`, { articulo_id: Number(b.dataset.articulo), unidades: n && n > 0 ? n : 1 });
    E.calc = '';
    E.lineaSel = E.cuenta.lineas.at(-1)?.id ?? null;
    return pintarVenta();
  }
  if (b.dataset.cuenta) { E.cuenta = { id: Number(b.dataset.cuenta) }; E.lineaSel = null; return pintarVenta(); }
  if (b.dataset.anular) return borrarLinea(Number(b.dataset.anular));
  if (b.dataset.linea) {
    if (b.dataset.arrastrado) { delete b.dataset.arrastrado; return; }
    if (b.classList.contains('abierta')) { b.classList.remove('abierta'); return; }
    const id = Number(b.dataset.linea); E.lineaSel = E.lineaSel === id ? null : id; return pintarVenta();
  }
  if (b.dataset.accion) return accion(b.dataset.accion);
  if (b.dataset.tecla) return tecla(b.dataset.tecla);
  if (b.id === 'b-teclado') {
    E.verTeclado = !E.verTeclado;
    try { localStorage.setItem('verTeclado', E.verTeclado ? '1' : ''); } catch {}
    return pintarVenta();
  }
  if (b.id === 'b-cobrar') return abrirCobro();
}));

// ---------- Cobro ----------
function abrirCobro() {
  const c = E.cuenta;
  let entregado = '';
  const formas = E.datos.formas_cobro.filter(f => f.activa);
  const pintar = () => {
    const ent = entregado ? Math.round(Number(entregado.replace(',', '.')) * 100) : 0;
    abrirModal(`
      <h2><span>Cobrar ${esc(nombreCuenta(c))}</span><button data-m="cerrar">✕</button></h2>
      <div class="cobro">
        <div>
          <div>Total</div><div class="grande">${euros(c.total)}</div>
          <div style="margin-top:10px">Entregado</div><div class="grande">${ent ? euros(ent) : '—'}</div>
          <div style="margin-top:10px">Cambio</div><div class="grande" style="color:var(--cobrar)">${ent >= c.total ? euros(ent - c.total) : '—'}</div>
        </div>
        <div>
          <div class="billetes">${[5, 10, 20, 50].map(b => `<button data-billete="${b}">${b} €</button>`).join('')}</div>
          <div class="teclado" style="margin-top:6px">
            ${['7', '8', '9', 'C', '4', '5', '6', '', '1', '2', '3', '', '0', ',', '', ''].map(k => k ? `<button data-ct="${k}">${k}</button>` : '<span></span>').join('')}
          </div>
        </div>
        <div class="formas" style="grid-column:1/-1">
          ${formas.map(f => `<button data-forma="${f.id}" class="${f.tipo === 'efectivo' ? 'efectivo' : ''}">${esc(f.nombre)}</button>`).join('')}
        </div>
      </div>`);
  };
  pintar();
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.m === 'cerrar') return cerrarModal();
    if (b.dataset.billete) { entregado = b.dataset.billete; return pintar(); }
    if (b.dataset.ct) {
      const k = b.dataset.ct;
      if (k === 'C') entregado = '';
      else if (k === ',') { if (!entregado.includes(',')) entregado = (entregado || '0') + ','; }
      else if (entregado.length < 8) entregado += k;
      return pintar();
    }
    if (b.dataset.forma) {
      const ent = entregado ? Math.round(Number(entregado.replace(',', '.')) * 100) : undefined;
      const ticket = await api('POST', `/cuentas/${c.id}/cobrar`, { forma_cobro_id: Number(b.dataset.forma), entregado: ent });
      E.cuenta = null;
      E.lineaSel = null;
      verTicket(ticket);
      return pintarVenta();
    }
  });
}

// ---------- Tickets ----------
function htmlTicket(t, titulo) {
  const e = t.empresa;
  return `<div class="ticket">
    <div class="c"><b>${esc(e.nombre)}</b><br>${esc(e.direccion)}${e.nif ? '<br>NIF ' + esc(e.nif) : ''}</div><hr>
    <div class="c">${esc(titulo)}</div>
    <div>${esc(t.serie)}-${t.numero} · ${hora(t.emitido_en)}</div>
    ${t.mesa_nombre ? `<div>${esc(t.zona_nombre)} · ${esc(t.mesa_nombre)}</div>` : ''}<hr>
    ${t.lineas.map(l => `<div class="fila"><span>${uds(l.unidades)} ${esc(l.descripcion)}</span><span>${euros(l.importe)}</span></div>`).join('')}<hr>
    <div class="fila grande"><span>TOTAL</span><span>${euros(t.total)}</span></div>
    ${t.impuestos.map(i => `<div class="fila"><span>Base ${i.iva}%: ${euros(i.base)}</span><span>IVA ${euros(i.cuota)}</span></div>`).join('')}<hr>
    <div class="fila"><span>${esc(t.forma_cobro)}</span><span>${euros(t.entregado)}</span></div>
    ${t.cambio ? `<div class="fila"><span>Cambio</span><span>${euros(t.cambio)}</span></div>` : ''}
    ${t.anula_ticket_id ? '<div class="c"><b>TICKET DE ANULACIÓN</b></div>' : ''}
    <div class="c" style="margin-top:8px">Gracias por su visita</div>
  </div>`;
}

function verTicket(t) {
  abrirModal(`<h2><span>Ticket ${esc(t.serie)}-${t.numero}</span><button data-m="cerrar">✕</button></h2>
    ${htmlTicket(t, 'FACTURA SIMPLIFICADA')}
    <div class="botones"><button class="primario" data-m="imprimir">Imprimir</button><button data-m="cerrar">Cerrar</button></div>`);
  $('#modal-caja').onclick = e => {
    const b = e.target.closest('button');
    if (b?.dataset.m === 'cerrar') cerrarModal();
    if (b?.dataset.m === 'imprimir') window.print();
  };
}

function verPreticket() {
  const c = E.cuenta;
  const pre = {
    empresa: E.datos.empresa, serie: 'PRE', numero: c.id, emitido_en: new Date().toISOString(), mesa_nombre: c.mesa_nombre, zona_nombre: c.zona_nombre,
    lineas: c.lineas.map(l => ({ ...l, importe: Math.round(l.unidades * l.precio) })), total: c.total, impuestos: [],
    forma_cobro: 'Pendiente', entregado: 0, cambio: 0,
  };
  abrirModal(`<h2><span>Pre-ticket</span><button data-m="cerrar">✕</button></h2>
    ${htmlTicket(pre, 'PRE-TICKET (sin validez fiscal)')}
    <div class="botones"><button class="primario" data-m="imprimir">Imprimir</button><button data-m="cerrar">Cerrar</button></div>`);
  $('#modal-caja').onclick = e => {
    const b = e.target.closest('button');
    if (b?.dataset.m === 'cerrar') cerrarModal();
    if (b?.dataset.m === 'imprimir') window.print();
  };
}

async function pintarTickets() {
  const lista = await api('GET', '/tickets');
  const t = E.ticketSel ? await api('GET', `/tickets/${E.ticketSel}`).catch(() => null) : null;
  $('#vista').innerHTML = `<div class="dos-col">
    <section class="panel scroll">
      <h3>Tickets desde el último cierre (${lista.length})</h3>
      <table><thead><tr><th>Número</th><th>Hora</th><th>Cobro</th><th class="num">Total</th></tr></thead><tbody>
      ${lista.map(x => `<tr class="clic ${x.id === E.ticketSel ? 'sel' : ''} ${x.anulado_por ? 'anulado' : ''}" data-ticket="${x.id}">
        <td>${esc(x.serie)}-${x.numero}${x.anula_ticket_id ? ' (anulación)' : ''}</td><td>${hora(x.emitido_en)}</td><td>${esc(x.forma_cobro)}</td><td class="num">${euros(x.total)}</td></tr>`).join('')}
      </tbody></table>
      ${lista.length ? '' : '<div class="vacio">Todavía no hay tickets</div>'}
    </section>
    <section class="panel scroll">
      ${t ? `${htmlTicket(t, t.anula_ticket_id ? 'ANULACIÓN' : 'FACTURA SIMPLIFICADA')}
        <div class="botones">
          <button class="primario" id="b-reimprimir">Imprimir</button>
          ${!t.anula_ticket_id && !t.anulado_por ? '<button class="peligro" id="b-anular">Anular ticket</button>' : ''}
        </div>` : '<div class="vacio">Selecciona un ticket</div>'}
    </section></div>`;
  $('#vista').onclick = e => intentar(async () => {
    const fila = e.target.closest('[data-ticket]');
    if (fila) { E.ticketSel = Number(fila.dataset.ticket); return pintarTickets(); }
    if (e.target.id === 'b-reimprimir') return verTicket(t);
    if (e.target.id === 'b-anular') {
      if (!confirm(`¿Anular el ticket ${t.serie}-${t.numero}? Se emitirá un ticket en negativo.`)) return;
      const n = await api('POST', `/tickets/${t.id}/anular`);
      E.ticketSel = n.id;
      aviso('Ticket anulado');
      return pintarTickets();
    }
  });
}

// ---------- Mesas ----------
async function pintarMesas() {
  await cargarAbiertas();
  const zonas = E.datos.zonas;
  if (!E.zonaMesas || !zonas.some(z => z.id === E.zonaMesas)) E.zonaMesas = zonas.find(z => z.tipo === 'mesas')?.id ?? zonas[0]?.id;
  const zona = zonas.find(z => z.id === E.zonaMesas);
  const abiertaDe = m => E.abiertas.find(a => a.mesa_id === m.id);
  let cuerpo;
  if (zona?.tipo === 'mesas') {
    const mesas = E.datos.mesas.filter(m => m.zona_id === zona.id);
    const cols = Math.max(1, ...mesas.map(m => m.x + 1));
    cuerpo = `<div class="plano" style="grid-template-columns:repeat(${cols}, minmax(110px, 1fr))">
      ${mesas.map(m => { const a = abiertaDe(m); return `<button class="mesa ${a ? 'ocupada' : ''}" data-mesa="${m.id}" style="grid-column:${m.x + 1};grid-row:${m.y + 1}">
        ${esc(m.nombre)}<small>${a ? euros(a.total) : 'Libre'}</small></button>`; }).join('')}
    </div>`;
  } else {
    const cuentas = E.abiertas.filter(a => a.zona_id === zona?.id);
    cuerpo = `<div class="plano"><div class="lista-barra">
      <button class="primario" data-nueva="1"><b>+ Nueva cuenta</b></button>
      ${cuentas.map(a => `<button data-abrir="${a.id}"><b>${esc(a.nombre || 'Cuenta ' + a.id)}</b><br>${euros(a.total)}</button>`).join('')}
    </div></div>`;
  }
  $('#vista').innerHTML = `<div class="mesas">
    <div class="pestanas">${zonas.map(z => `<button data-zona="${z.id}" class="${z.id === E.zonaMesas ? 'activa' : ''}">${esc(z.nombre)}</button>`).join('')}</div>
    ${cuerpo}</div>`;
  $('#vista').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.zona) { E.zonaMesas = Number(b.dataset.zona); return pintarMesas(); }
    if (b.dataset.mesa) {
      const mesa = E.datos.mesas.find(m => m.id === Number(b.dataset.mesa));
      let comensales = 0;
      if (!abiertaDe(mesa)) {
        const r = prompt(`Comensales en ${mesa.nombre}`, '2');
        if (r === null) return;
        comensales = Number(r) || 0;
      }
      E.cuenta = await api('POST', '/cuentas', { zona_id: zona.id, mesa_id: mesa.id, comensales });
    } else if (b.dataset.nueva) {
      E.cuenta = await api('POST', '/cuentas', { zona_id: zona.id });
    } else if (b.dataset.abrir) {
      E.cuenta = { id: Number(b.dataset.abrir) };
    } else return;
    E.lineaSel = null;
    return ir('venta');
  });
}

// ---------- Caja ----------
async function pintarCaja() {
  const r = await api('GET', '/caja');
  $('#vista').innerHTML = `<div class="dos-col">
    <section class="panel scroll">
      <h3>Ventas desde el último cierre</h3>
      <div class="cifras">
        <div class="cifra"><small>Total</small><b>${euros(r.total)}</b></div>
        ${r.por_forma.map(f => `<div class="cifra"><small>${esc(f.nombre)} · ${f.tickets} tickets</small><b>${euros(f.total)}</b></div>`).join('')}
      </div>
      <h3>Por familia</h3>
      <table><thead><tr><th>Familia</th><th class="num">Unidades</th><th class="num">Importe</th></tr></thead><tbody>
        ${r.por_familia.map(f => `<tr><td>${esc(f.nombre)}</td><td class="num">${uds(f.unidades)}</td><td class="num">${euros(f.total)}</td></tr>`).join('')}
      </tbody></table>
    </section>
    <section class="panel">
      <h3>Cierre de caja</h3>
      <div class="form">
        ${r.cuentas_abiertas ? `<div class="peligro">Hay ${r.cuentas_abiertas} cuentas abiertas sin cobrar.</div>` : ''}
        <label>Fondo de caja inicial (€)<input id="fondo" inputmode="decimal" value="0"></label>
        <label>Efectivo contado en el cajón (€)<input id="contado" inputmode="decimal" placeholder="Opcional"></label>
        <button class="primario" id="b-cierre" style="padding:14px">Hacer cierre de caja</button>
      </div>
    </section></div>`;
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.id !== 'b-cierre') return;
    if (!confirm('¿Hacer el cierre de caja? Las ventas pasarán al histórico.')) return;
    const aCent = v => v.trim() ? Math.round(Number(v.replace(',', '.')) * 100) : undefined;
    const c = await api('POST', '/caja/cierre', { fondo_inicial: aCent($('#fondo').value) ?? 0, efectivo_contado: aCent($('#contado').value) });
    aviso(`Cierre ${c.id} hecho: ${euros(c.total)}`);
    return pintarCaja();
  });
}

// ---------- Gestión ----------
const GESTION = {
  articulos: { titulo: 'Artículos', campos: [['nombre', 'Nombre'], ['precio', 'Precio (€)', 'euros'], ['iva', 'IVA %', 'num'], ['familia_id', 'Familia', 'familias'], ['grupo_cocina', 'Grupo cocina', 'grupo'], ['orden', 'Orden', 'num'], ['activo', 'Activo', 'bool']] },
  familias: { titulo: 'Familias', campos: [['nombre', 'Nombre'], ['color', 'Color', 'color'], ['padre_id', 'Subfamilia de', 'familias'], ['departamento_id', 'Departamento', 'departamentos'], ['orden', 'Orden', 'num']] },
  departamentos: { titulo: 'Departamentos', campos: [['nombre', 'Nombre']] },
  zonas: { titulo: 'Zonas', campos: [['nombre', 'Nombre'], ['tipo', 'Tipo', 'tipozona'], ['orden', 'Orden', 'num']] },
  mesas: { titulo: 'Mesas', campos: [['nombre', 'Nombre'], ['zona_id', 'Zona', 'zonas'], ['x', 'Columna', 'num'], ['y', 'Fila', 'num']] },
  formas_cobro: { titulo: 'Formas de cobro', campos: [['nombre', 'Nombre'], ['tipo', 'Tipo', 'tipocobro'], ['activa', 'Activa', 'bool'], ['orden', 'Orden', 'num']] },
  operarios: { titulo: 'Operarios', campos: [['nombre', 'Nombre'], ['pin', 'PIN']] },
  ivas: { titulo: 'IVAs', campos: [['nombre', 'Nombre'], ['codigo', 'Código'], ['porcentaje', 'IVA %', 'num'], ['recargo', 'Recargo equivalencia %', 'num'], ['orden', 'Orden', 'num']] },
  puestos: { titulo: 'Puestos', campos: [['nombre', 'Nombre'], ['tipo', 'Tipo', 'tipopuesto'], ['impresora_tickets_id', 'Impresora de tickets', 'impresoras'], ['orden', 'Orden', 'num']] },
  impresoras: { titulo: 'Impresoras de cocina y tickets', campos: [['nombre', 'Nombre'], ['ip', 'Dirección IP'], ['puerto', 'Puerto', 'num'], ['uso', 'Uso', 'usoimpresora'], ['departamento_id', 'Departamento', 'departamentos'], ['activa', 'Activa', 'bool'], ['orden', 'Orden', 'num']] },
  conceptos_pago: { titulo: 'Conceptos de pago', campos: [['nombre', 'Nombre'], ['orden', 'Orden', 'num']] },
  botones: { titulo: 'Botonera', campos: [['texto', 'Texto'], ['accion', 'Acción', 'accion'], ['color', 'Color', 'colorop'], ['orden', 'Orden', 'num'], ['visible', 'Visible', 'bool']] },
};
const GRUPOS = [[-2, 'Ninguno'], [0, 'Entrantes'], [1, 'Primeros'], [2, 'Segundos'], [3, 'Postres']];
const OPCIONES = {
  tipozona: [['mesas', 'Mesas'], ['barra', 'Barra']],
  tipocobro: [['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['pendiente', 'Pendiente de cobro'], ['otro', 'Otro']],
  tipopuesto: [['tpv', 'TPV'], ['pda', 'PDA camarero'], ['kds', 'Pantalla de cocina']],
  usoimpresora: [['cocina', 'Cocina'], ['barra', 'Barra'], ['tickets', 'Tickets'], ['otro', 'Otro']],
};
const REFS = ['familias', 'departamentos', 'zonas', 'impresoras'];

function valorCelda(tipo, v) {
  if (tipo === 'euros') return euros(v);
  if (tipo === 'bool') return v ? 'Sí' : 'No';
  if (tipo === 'grupo') return GRUPOS.find(g => g[0] === v)?.[1] ?? '';
  if (OPCIONES[tipo]) return OPCIONES[tipo].find(o => o[0] === v)?.[1] ?? v;
  if (REFS.includes(tipo)) return E.datos[tipo].find(x => x.id === v)?.nombre ?? '';
  if (tipo === 'accion') return esc(E.datos.acciones[v] ?? v);
  if (tipo === 'colorop') return v ? `<span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${esc(v)}"></span>` : 'Normal';
  if (tipo === 'color') return `<span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${esc(v)}"></span>`;
  return esc(v);
}

function campoForm([k, etiqueta, tipo], fila) {
  const v = fila?.[k];
  if (tipo === 'bool') return `<label><span>${etiqueta}</span><select name="${k}"><option value="1" ${v !== 0 ? 'selected' : ''}>Sí</option><option value="0" ${v === 0 ? 'selected' : ''}>No</option></select></label>`;
  if (tipo === 'colorop') return `<label>${etiqueta}<span style="display:flex;gap:8px;align-items:center"><input type="color" name="${k}" value="${esc(v || '#0064fc')}" ${v ? '' : 'disabled'}>
    <label style="display:flex;gap:6px;align-items:center;color:inherit"><input type="checkbox" name="${k}_normal" ${v ? '' : 'checked'} onchange="this.form.elements['${k}'].disabled=this.checked"> Sin color</label></span></label>`;
  const opts = tipo === 'accion' ? Object.entries(E.datos.acciones) : tipo === 'grupo' ? GRUPOS : OPCIONES[tipo] ?? (REFS.includes(tipo) ? [['', '—'], ...E.datos[tipo].map(x => [x.id, x.nombre])] : null);
  if (opts) return `<label>${etiqueta}<select name="${k}">${opts.map(([val, txt]) => `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(txt)}</option>`).join('')}</select></label>`;
  if (tipo === 'color') return `<label>${etiqueta}<input type="color" name="${k}" value="${esc(v ?? '#3d5a80')}"></label>`;
  if (tipo === 'euros') return `<label>${etiqueta}<input name="${k}" inputmode="decimal" value="${v !== undefined ? (v / 100).toFixed(2).replace('.', ',') : ''}"></label>`;
  return `<label>${etiqueta}<input name="${k}" ${tipo === 'num' ? 'inputmode="decimal"' : ''} value="${esc(v ?? '')}"></label>`;
}

async function pintarGestion(editar) {
  const def = GESTION[E.tablaGestion];
  const filas = await api('GET', `/gestion/${E.tablaGestion}`);
  const fila = editar === 'nuevo' ? {} : filas.find(f => f.id === editar);
  $('#vista').innerHTML = `<div class="mesas">
    ${cabeceraConfig(def.titulo)}
    <div class="dos-col" style="padding:0;flex:1;min-height:0">
      <section class="panel scroll">
        <div class="botones"><button class="primario" data-editar="nuevo">+ Añadir</button></div>
        <table><thead><tr>${def.campos.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
        ${filas.map(f => `<tr class="clic ${f.id === editar ? 'sel' : ''}" data-editar="${f.id}">${def.campos.map(([k, , t]) => `<td>${valorCelda(t, f[k])}</td>`).join('')}</tr>`).join('')}
        </tbody></table>
      </section>
      <section class="panel scroll">
        ${fila ? `<h3>${editar === 'nuevo' ? 'Nuevo' : 'Editar'}</h3>
          <form class="form" id="f-gestion">${def.campos.map(c => campoForm(c, fila)).join('')}
            <div class="botones" style="padding:0"><button class="primario" type="submit">Guardar</button>
            ${editar !== 'nuevo' ? '<button type="button" class="peligro" id="b-borrar">Borrar</button>' : ''}</div>
          </form>` : '<div class="vacio">Selecciona una fila o pulsa Añadir</div>'}
      </section>
    </div></div>`;

  $('#vista').onclick = e => intentar(async () => {
    const b = e.target.closest('[data-volver],[data-editar],#b-borrar');
    if (!b) return;
    if (b.dataset.volver) return ir('config');
    if (b.dataset.editar) return pintarGestion(b.dataset.editar === 'nuevo' ? 'nuevo' : Number(b.dataset.editar));
    if (b.id === 'b-borrar') {
      if (!confirm('¿Borrar este registro?')) return;
      const r = await api('DELETE', `/gestion/${E.tablaGestion}/${editar}`);
      aviso(r.desactivado ? 'El artículo tiene ventas: se ha desactivado' : 'Borrado');
      await cargarDatos();
      return pintarGestion();
    }
  });
  const form = $('#f-gestion');
  if (form) form.onsubmit = e => intentar(async () => {
    e.preventDefault();
    const datos = {};
    for (const [k, , tipo] of def.campos) {
      const v = form.elements[k].value;
      if (tipo === 'euros') datos[k] = Math.round(Number(v.replace(',', '.')) * 100);
      else if (tipo === 'colorop') datos[k] = form.elements[k + '_normal'].checked ? '' : v;
      else if (['num', 'grupo', 'bool'].includes(tipo)) datos[k] = Number(String(v).replace(',', '.'));
      else if (REFS.includes(tipo)) datos[k] = v === '' ? null : Number(v);
      else datos[k] = v;
    }
    const r = editar === 'nuevo'
      ? await api('POST', `/gestion/${E.tablaGestion}`, datos)
      : await api('PUT', `/gestion/${E.tablaGestion}/${editar}`, datos);
    aviso('Guardado');
    await cargarDatos();
    return pintarGestion(r.id);
  });
}

async function pintarEmpresa() {
  const emp = await api('GET', '/empresa');
  const campos = [['nombre', 'Nombre comercial'], ['nif', 'NIF'], ['direccion', 'Dirección'], ['serie_tickets', 'Serie de tickets']];
  $('#vista').innerHTML = `<div class="mesas">
    ${cabeceraConfig('Datos de empresa')}
    <section class="panel" style="max-width:520px"><form class="form" id="f-empresa">
      ${campos.map(([k, t]) => `<label>${t}<input name="${k}" value="${esc(emp[k])}"></label>`).join('')}
      <div class="botones" style="padding:0"><button class="primario" type="submit">Guardar</button></div>
    </form></section></div>`;
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.closest('[data-volver]')) return ir('config');
  });
  $('#f-empresa').onsubmit = e => intentar(async () => {
    e.preventDefault();
    const f = e.target;
    await api('PUT', '/empresa', Object.fromEntries(campos.map(([k]) => [k, f.elements[k].value])));
    await cargarDatos();
    aviso('Datos de empresa guardados');
  });
}

// ---------- Configuración ----------
function cabeceraConfig(titulo) {
  return `<div class="cab-config"><button data-volver="1">← Configuración</button><h2>${esc(titulo)}</h2></div>`;
}

const SECCIONES_CONFIG = [
  ['Uso diario', [
    ['abiertas', 'Cuentas abiertas', 'Ver y recuperar las cuentas sin cobrar'],
    ['informes', 'Informes', 'Ventas por forma de cobro y por familia'],
  ]],
  ['Carta', [
    ['articulos', 'Artículos', 'Precios, IVA y familia'],
    ['familias', 'Familias', 'Colores, orden y subfamilias'],
    ['departamentos', 'Departamentos', 'Agrupan familias (barra, cocina...)'],
  ]],
  ['Local', [
    ['zonas', 'Zonas', 'Barra, comedor, terraza...'],
    ['mesas', 'Mesas', 'Mesas de cada zona'],
    ['puestos', 'Puestos', 'TPV, PDA y pantallas de cocina'],
    ['impresoras', 'Impresoras', 'Tickets, cocina y barra'],
    ['operarios', 'Operarios', 'Camareros y claves'],
  ]],
  ['Cobros e impuestos', [
    ['formas_cobro', 'Formas de pago', 'Efectivo, tarjeta, pendiente...'],
    ['ivas', 'IVAs', 'Tipos de IVA y recargo'],
    ['conceptos_pago', 'Conceptos de pago', 'Entradas y salidas de caja'],
  ]],
  ['Personalización', [
    ['empresa', 'Datos de empresa', 'Nombre, NIF, dirección y serie'],
    ['botones', 'Botonera', 'Botones de la pantalla de venta'],
  ]],
];

function pintarConfig() {
  $('#vista').innerHTML = `<div class="config scroll">
    <h2>${ICONO_HERRAMIENTAS} Configuración</h2>
    ${SECCIONES_CONFIG.map(([titulo, items]) => `<h3>${titulo}</h3><div class="baldosas">
      ${items.map(([k, t, d]) => `<button data-ir="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}
    </div>`).join('')}
  </div>`;
  $('#vista').onclick = e => intentar(async () => {
    const b = e.target.closest('[data-ir]');
    if (!b) return;
    const k = b.dataset.ir;
    if (k === 'abiertas' || k === 'empresa') return ir(k);
    if (k === 'informes') return ir('caja');
    E.tablaGestion = k;
    return ir('gestion');
  });
}

async function pintarAbiertas() {
  await cargarAbiertas();
  $('#vista').innerHTML = `<div class="mesas">
    ${cabeceraConfig(`Cuentas abiertas (${E.abiertas.length})`)}
    <div class="plano"><div class="lista-barra">
      ${E.abiertas.map(a => `<button data-abrir="${a.id}"><b>${esc(nombreCuenta(a))}</b><br>${euros(a.total)}<br><small>${hora(a.abierta_en)}</small></button>`).join('')}
      ${E.abiertas.length ? '' : '<div class="vacio">No hay cuentas abiertas</div>'}
    </div></div></div>`;
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.closest('[data-volver]')) return ir('config');
    const b = e.target.closest('[data-abrir]');
    if (!b) return;
    E.cuenta = { id: Number(b.dataset.abrir) };
    E.lineaSel = null;
    return ir('venta');
  });
}

// ---------- Tiempo real y arranque ----------
function conectarEventos() {
  const es = new EventSource('/api/eventos');
  es.onopen = () => $('#conexion').classList.add('ok');
  es.onerror = () => $('#conexion').classList.remove('ok');
  let t;
  es.onmessage = ev => {
    const { tipo } = JSON.parse(ev.data);
    clearTimeout(t);
    t = setTimeout(() => intentar(async () => {
      if (tipo === 'gestion' || tipo === 'empresa') await cargarDatos();
      if (!$('#modal').classList.contains('oculto')) return;
      if (['venta', 'mesas', 'abiertas'].includes(E.vista)) await VISTAS[E.vista]();
    }), 250);
  };
}

function reloj() {
  $('#reloj').textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

intentar(async () => {
  reloj();
  setInterval(reloj, 15000);
  await cargarDatos();
  await ir('venta');
  conectarEventos();
});
