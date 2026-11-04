// Aplicación web del TPV LevaDigital (TPV, PDA). Sin dependencias.

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euros = c => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const uds = n => Number.isInteger(n) ? String(n) : n.toLocaleString('es-ES', { maximumFractionDigits: 3 });
const hora = iso => new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  .toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function api(metodo, ruta, cuerpo) {
  const cab = cuerpo ? { 'content-type': 'application/json' } : {};
  // Cada petición lleva el operario en uso y el puesto de este dispositivo (permisos y control de empleados).
  if (typeof E !== 'undefined') {
    if (E.operario) cab['x-operario'] = String(E.operario.id);
    if (E.puestoId) cab['x-puesto'] = String(E.puestoId);
  }
  const r = await fetch('/api' + ruta, {
    method: metodo,
    headers: cab,
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
  $('#modal-caja').classList.remove('ancho');
  if (E.pedirTrasModal) { E.pedirTrasModal = false; setTimeout(mostrarPanelOperarios, 0); }
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
  aplicarAspecto(E.datos.aspecto);
  // Puesto de este dispositivo (se elige en Configuración) y operario en uso.
  let p = null;
  try { p = Number(localStorage.getItem('puesto')) || null; } catch {}
  E.puestoId = E.datos.puestos.some(x => x.id === p) ? p : E.datos.puestos[0]?.id ?? null;
  if (E.operario) {
    const o = E.datos.operarios.find(x => x.id === E.operario.id);
    E.operario = o ? { id: o.id, nombre: o.nombre, permisos: o.permisos } : null;
  }
  pintarOperarioActual();
  const raices = familiasRaiz();
  const existe = id => E.datos.familias.some(f => f.id === id);
  if (E.nivelFam && !existe(E.nivelFam)) E.nivelFam = null;
  if (!E.familia || !existe(E.familia)) {
    E.familia = raices[0]?.id ?? null;
    E.nivelFam = E.datos.familias.some(f => f.padre_id === E.familia) ? E.familia : null;
  }
}
// Pone los tamaños y colores elegidos en Configuración > Aspecto como variables CSS.
const COLORES_ASPECTO = { color_principal: '--marca', color_cabecera: '--azul', color_cobrar: '--cobrar' };
function aplicarAspecto(a, raiz = document.documentElement) {
  if (!a || !E.datos?.aspecto_campos) return;
  for (const [k, def] of Object.entries(E.datos.aspecto_campos)) {
    if (a[k] === undefined) continue;
    if (COLORES_ASPECTO[k]) raiz.style.setProperty(COLORES_ASPECTO[k], a[k]);
    else raiz.style.setProperty(`--a-${k}`, a[k] + def[6]);
  }
}

const familiasRaiz = () => E.datos.familias.filter(f => !f.padre_id);
const hijasDe = id => E.datos.familias.filter(f => f.padre_id === id);

// Imagen y colores propios de un artículo o familia.
const urlImagen = r => '/imagenes/' + r.split('/').map(encodeURIComponent).join('/');
function estiloBoton(x, acento) {
  const clases = [x.color_fondo ? 'con-fondo' : '', x.color_texto ? 'con-texto' : '', x.imagen ? 'con-imagen' : ''].join(' ');
  const estilo = `--c:${esc(acento)};${x.color_fondo ? `--bf:${esc(x.color_fondo)};` : ''}${x.color_texto ? `--bt:${esc(x.color_texto)};` : ''}`;
  return { clases, estilo };
}
function botonFamilia(f, clasesExtra, contenido) {
  const { clases, estilo } = estiloBoton(f, f.color);
  return `<button data-familia="${f.id}" style="${estilo}" class="${clases} ${clasesExtra}">${f.imagen ? `<img class="mini" src="${esc(urlImagen(f.imagen))}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="nom">${esc(f.nombre)}</span>${contenido ?? ''}</button>`;
}
const SIN_IMAGEN = `onerror="this.parentElement.classList.remove('con-imagen');this.remove()"`;
function botonArticulo(a, acento, subtitulo, dato = `data-articulo="${a.id}"`) {
  const { clases, estilo } = estiloBoton(a, acento);
  return `<button ${dato} style="${estilo}" class="${clases}">${a.imagen ? `<img src="${esc(urlImagen(a.imagen))}" alt="" loading="lazy" ${SIN_IMAGEN}>` : ''}${a.alergenos ? `<span class="alerg-art">${iconosAlergenos(a.alergenos)}</span>` : ''}<em class="pie"><b>${esc(a.nombre)}</b><span>${subtitulo}</span></em></button>`;
}

// Alérgenos: icono de la carpeta "Alergenos" del banco o, si falta, una etiqueta con el nombre.
const alergeno = c => E.datos.alergenos?.find(a => a.codigo === c);
function iconosAlergenos(codigos, conNombre = false) {
  return String(codigos || '').split(',').filter(Boolean).map(c => {
    const a = alergeno(c);
    if (!a) return '';
    const icono = a.imagen ? `<img class="ico-alerg" src="${esc(urlImagen(a.imagen))}" alt="${esc(a.nombre)}" title="${esc(a.nombre)}">` : `<i class="ico-alerg txt" title="${esc(a.nombre)}">${esc(a.nombre.slice(0, 2))}</i>`;
    return conNombre ? `<span class="alerg-nombre">${icono}${esc(a.nombre)}</span>` : icono;
  }).join('');
}
const nombresAlergenos = codigos => String(codigos || '').split(',').map(c => alergeno(c)?.nombre).filter(Boolean).join(', ');

// Columna de familias: las principales o, al entrar en una familia con subfamilias, sus subfamilias.
function columnaFamilias() {
  const padre = E.datos.familias.find(f => f.id === E.nivelFam);
  const boton = f => {
    const tieneHijas = hijasDe(f.id).length > 0;
    const activa = f.id === E.familia || (!padre && antecesores(E.familia).includes(f.id));
    return botonFamilia(f, `${activa ? 'activa' : ''} ${tieneHijas ? 'con-sub' : ''}`, tieneHijas ? '<i>›</i>' : '');
  };
  if (!padre) return familiasRaiz().map(boton).join('');
  return `<button class="volver-fam" data-subir="1">← ${padre.padre_id ? esc(E.datos.familias.find(f => f.id === padre.padre_id)?.nombre ?? 'Familias') : 'Familias'}</button>
    ${botonFamilia(padre, `padre-fam ${padre.id === E.familia ? 'activa' : ''}`)}
    ${hijasDe(padre.id).map(f => `<div class="sub-fam">${boton(f)}</div>`).join('')}`;
}
function antecesores(id) {
  const lista = [];
  for (let f = E.datos.familias.find(x => x.id === id); f?.padre_id && lista.length < 20; f = E.datos.familias.find(x => x.id === f.padre_id)) lista.push(f.padre_id);
  return lista;
}
const zonaBarra = () => E.datos.zonas.find(z => z.tipo === 'barra') ?? E.datos.zonas[0];

async function cargarAbiertas() {
  E.abiertas = await api('GET', '/cuentas');
  const n = $('#n-abiertas');
  if (n) { n.textContent = E.abiertas.length || ''; n.classList.toggle('oculto', !E.abiertas.length); }
}

function nombreCuenta(c) {
  if (!c) return 'Nueva cuenta';
  if (c.mesa_nombre) return `${c.zona_nombre} · ${c.mesa_nombre}`;
  return c.nombre ? `${c.zona_nombre} · ${c.nombre}` : `${c.zona_nombre} · cuenta ${c.id}`;
}

// ---------- Navegación ----------
const VISTAS = { venta: pintarVenta, mesas: pintarMesas, tickets: pintarTickets, caja: pintarCaja, gestion: () => pintarGestion(), config: pintarConfig, abiertas: pintarAbiertas, empresa: pintarEmpresa, borrados: pintarBorrados, registro: pintarRegistro, aspecto: pintarAspecto, empleados: pintarEmpleados };
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
              ${l.detalle ? `<span class="det" title="Texto de la comanda">✎ ${esc(l.detalle)}</span>` : ''}
              ${l.orden_plato_id ? `<span class="op-plato">${esc(E.datos.ordenes_plato.find(o => o.id === l.orden_plato_id)?.nombre ?? '')}</span>` : ''}
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
        ${E.datos.botones.filter(b => b.visible).map(b => `<button data-accion="${esc(b.accion)}" data-id="${b.id}" ${b.color ? `class="color" style="--bc:${esc(b.color)}"` : ''}
          ${accionActiva(b.accion, c) ? '' : 'disabled'} title="${esc(b.texto)}">${b.accion === 'configuracion' ? ICONO_HERRAMIENTAS : esc(b.texto)}</button>`).join('')}
      </div>
      <div class="fila-cobrar"><button class="cobrar" id="b-cobrar" ${c?.lineas.length ? '' : 'disabled'}>Cobrar ${c?.lineas.length ? euros(c.total) : ''}</button></div>
    </section>
    <section class="panel familias">
      ${columnaFamilias()}
    </section>
    <section class="panel articulos">
      ${arts.length ? '' : subfamilias.map(f => botonArticulo(f, f.color, 'Subfamilia', `data-familia="${f.id}"`)).join('')}
      ${arts.map(a => botonArticulo(a, colorDe(a.familia_id), euros(a.precio))).join('')}
      ${!arts.length && !subfamilias.length ? `<div class="vacio">${famActual ? 'Esta familia no tiene artículos' : 'No hay familias'}</div>` : ''}
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
    case 'borrar_todo': case 'marchar': return !!c;
    case 'orden_plato': case 'comanda': return conLineas;
    case 'preticket': case 'efectivo_exacto': case 'tarjeta': return conLineas;
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
  trasOperacion();
  return pintarVenta();
}

async function accion(a) {
  const c = E.cuenta;
  switch (a) {
    case 'guardar': return guardarCuenta();
    case 'preticket': return verPreticket();
    case 'nueva': E.cuenta = null; E.lineaSel = null; return pintarVenta();
    case 'mesas': return ir('mesas');
    case 'configuracion':
      if (!tienePermiso('configuracion')) return aviso('Tu operario no tiene permiso para entrar en configuración', true);
      return ir('config');
    case 'orden_plato': return elegirOrdenPlato();
    case 'marchar': return marcharCocina();
    case 'comanda': return verComanda();
    case 'borrar_linea': return borrarLinea(E.lineaSel);
    case 'borrar_todo':
      if (!confirm(`¿Borrar todo y cerrar la cuenta "${nombreCuenta(c)}"?\nLo borrado quedará en el informe de borrados.`)) return;
      await api('DELETE', `/cuentas/${c.id}/lineas`);
      E.cuenta = null;
      E.lineaSel = null;
      aviso('Cuenta borrada y cerrada');
      return pintarVenta();
    case 'detalle': return editarComanda(E.lineaSel);
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

// Comentarios que se ofrecen para una línea: los del artículo, los de su familia y los generales.
function comentariosDe(l) {
  const art = E.datos.articulos.find(a => a.id === l.articulo_id);
  const lista = E.datos.comentarios ?? [];
  const peso = c => c.articulo_id ? (c.articulo_id === l.articulo_id ? 0 : -1)
    : c.familia_id ? (art && c.familia_id === art.familia_id ? 1 : -1) : 2;
  return lista.map(c => [peso(c), c]).filter(([p]) => p >= 0).sort((a, b) => a[0] - b[0] || a[1].orden - b[1].orden).map(([, c]) => c);
}

// Texto de la comanda: lo que sale en la impresora de cocina o barra. El ticket lleva siempre la descripción original.
function editarComanda(id) {
  const l = E.cuenta?.lineas?.find(x => x.id === id);
  if (!l) return;
  E.lineaSel = id;
  const coms = comentariosDe(l);
  abrirModal(`<h2><span>Comanda: ${esc(l.descripcion)}</span><button data-cerrar="1">✕</button></h2>
    <div class="comanda">
      <label>Texto para cocina / barra</label>
      <textarea id="txt-comanda" rows="2" maxlength="200">${esc(l.detalle || l.descripcion)}</textarea>
      <small>En el ticket del cliente saldrá: <b>${esc(l.descripcion)}</b></small>
      ${(() => { const al = E.datos.articulos.find(a => a.id === l.articulo_id)?.alergenos; return al ? `<div class="alerg-lista"><b>Alérgenos:</b> ${iconosAlergenos(al, true)}</div>` : ''; })()}
      ${coms.length ? `<div class="chips">${coms.map(c => `<button data-com="${esc(c.texto)}">${esc(c.texto)}</button>`).join('')}</div>` : ''}
      <div class="botones-modal">
        <button data-original="1">Restaurar original</button>
        <button data-cerrar="1">Cancelar</button>
        <button class="primario" data-guardar="1">Guardar</button>
      </div>
    </div>`);
  const txt = $('#txt-comanda');
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cerrar) return cerrarModal();
    if (b.dataset.original) { txt.value = l.descripcion; return txt.focus(); }
    if (b.dataset.com) {
      const c = b.dataset.com;
      txt.value = `${txt.value.trim()} ${c.charAt(0).toLowerCase()}${c.slice(1)}`.trim();
      return;
    }
    if (b.dataset.guardar) {
      E.cuenta = await api('PATCH', `/lineas/${l.id}`, { detalle: txt.value });
      cerrarModal();
      return pintarVenta();
    }
  });
}

// Mantener pulsada una línea abre el texto de la comanda; deslizarla a la izquierda muestra Anular.
const PULSACION_LARGA_MS = 1000;
let arrastre = null;
$('#vista').addEventListener('pointerdown', e => {
  const l = e.target.closest('.linea');
  if (!l || E.vista !== 'venta') return;
  delete l.dataset.arrastrado;
  document.querySelectorAll('.linea.abierta').forEach(x => { if (x !== l) x.classList.remove('abierta'); });
  arrastre = { el: l, x0: e.clientX, y0: e.clientY, dx: 0, base: l.classList.contains('abierta') ? -96 : 0, movido: false };
  arrastre.larga = setTimeout(() => {
    if (!arrastre || arrastre.movido) return;
    l.dataset.arrastrado = '1';   // que el clic de soltar no cambie la selección
    l.classList.remove('abierta');
    arrastre = null;
    editarComanda(Number(l.dataset.linea));
  }, PULSACION_LARGA_MS);
});
$('#vista').addEventListener('contextmenu', e => { if (e.target.closest('.linea')) e.preventDefault(); });
$('#vista').addEventListener('pointermove', e => {
  if (!arrastre) return;
  const dx = e.clientX - arrastre.x0;
  if (!arrastre.movido && Math.abs(dx) < 8 && Math.abs(e.clientY - arrastre.y0) < 8) return;
  clearTimeout(arrastre.larga);
  if (!arrastre.movido && Math.abs(dx) < 8) return;
  if (!arrastre.movido && Math.abs(e.clientY - arrastre.y0) > Math.abs(dx)) { arrastre = null; return; }
  arrastre.movido = true;
  arrastre.dx = dx;
  arrastre.el.style.transition = 'none';
  arrastre.el.style.transform = `translateX(${Math.max(-120, Math.min(0, arrastre.base + dx))}px)`;
});
const soltar = () => {
  if (!arrastre) return;
  clearTimeout(arrastre.larga);
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
  trasOperacion();
  return pintarVenta();
}

// ---------- Ordenar botones arrastrando ----------
// Mantener pulsado 3 segundos un botón de la botonera, una familia o un artículo lo "suelta";
// después se arrastra a su nuevo sitio y al levantar el dedo se guarda el orden.
const PULSACION_ORDENAR_MS = 3000;
let orden = null;
function grupoOrdenable(el) {
  const acc = el.closest('.acciones [data-accion]');
  if (acc) return { tabla: 'botones', cont: acc.parentElement, item: acc, items: () => [...acc.parentElement.querySelectorAll(':scope > [data-accion]')], id: x => x.dataset.id };
  const art = el.closest('.articulos [data-articulo]');
  if (art) return { tabla: 'articulos', cont: art.parentElement, item: art, items: () => [...art.parentElement.querySelectorAll(':scope > [data-articulo]')], id: x => x.dataset.articulo };
  const fam = el.closest('.familias [data-familia]');
  if (fam && !fam.classList.contains('padre-fam')) {
    const item = fam.parentElement.classList.contains('sub-fam') ? fam.parentElement : fam;
    const cont = item.parentElement;
    const items = () => [...cont.children].filter(x => (x.matches('[data-familia]') && !x.classList.contains('padre-fam')) || x.classList.contains('sub-fam'));
    return { tabla: 'familias', cont, item, items, id: x => (x.dataset.familia ?? x.querySelector('[data-familia]').dataset.familia) };
  }
  return null;
}
$('#vista').addEventListener('pointerdown', e => {
  if (E.vista !== 'venta' || orden?.activo) return;
  const g = grupoOrdenable(e.target);
  if (!g) return;
  const boton = g.item.matches('button') ? g.item : g.item.querySelector('button');
  boton.classList.add('cargando-orden');
  orden = { ...g, boton, x0: e.clientX, y0: e.clientY, activo: false };
  orden.t = setTimeout(() => {
    if (!orden) return;
    orden.activo = true;
    orden.inicial = orden.items().map(orden.id).join(',');
    boton.classList.remove('cargando-orden');
    boton.classList.add('moviendo');
    orden.cont.classList.add('ordenando');
    navigator.vibrate?.(60);
    aviso('Arrastra el botón a su nuevo sitio y suelta');
  }, PULSACION_ORDENAR_MS);
});
function cancelarPulsacion() {
  if (!orden || orden.activo) return;
  clearTimeout(orden.t);
  orden.boton.classList.remove('cargando-orden');
  orden = null;
}
document.addEventListener('pointermove', e => {
  if (!orden) return;
  if (!orden.activo) {
    if (Math.hypot(e.clientX - orden.x0, e.clientY - orden.y0) > 10) cancelarPulsacion();
    return;
  }
  const bajo = document.elementFromPoint(e.clientX, e.clientY);
  const destino = bajo && orden.items().find(x => x.contains(bajo));
  if (!destino || destino === orden.item) return;
  const r = destino.getBoundingClientRect();
  const enColumna = getComputedStyle(orden.cont).flexDirection === 'column';
  const antes = enColumna ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
  orden.cont.insertBefore(orden.item, antes ? destino : destino.nextSibling);
});
// Mientras se arrastra, que la pantalla no haga scroll.
document.addEventListener('touchmove', e => { if (orden?.activo) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => { if (orden || e.target.closest('.venta .acciones, .venta .familias, .venta .articulos')) e.preventDefault(); });
async function soltarOrden() {
  if (!orden) return;
  if (!orden.activo) return cancelarPulsacion();
  const o = orden;
  orden = null;
  E.sinClic = Date.now();
  o.boton.classList.remove('moviendo');
  o.cont.classList.remove('ordenando');
  const ids = o.items().map(o.id).map(Number);
  if (ids.join(',') === o.inicial) return;
  await intentar(async () => {
    await api('POST', `/gestion/${o.tabla}/ordenar`, { ids });
    await cargarDatos();
    aviso('Orden guardado');
  });
  return pintarVenta();
}
document.addEventListener('pointerup', () => soltarOrden());
document.addEventListener('pointercancel', () => soltarOrden());

$('#vista').addEventListener('click', e => intentar(async () => {
  if (E.vista !== 'venta') return;
  // El clic que llega al soltar un botón que se estaba moviendo no cuenta.
  if (Date.now() - (E.sinClic ?? 0) < 600) return;
  const b = e.target.closest('[data-familia],[data-articulo],[data-cuenta],[data-tecla],[data-anular],[data-linea],[data-accion],button');
  if (!b) return;
  if (b.dataset.familia) {
    const id = Number(b.dataset.familia);
    E.familia = id;
    // Una familia con subfamilias abre el despliegue en la columna de familias.
    if (hijasDe(id).length && id !== E.nivelFam) E.nivelFam = id;
    return pintarVenta();
  }
  if (b.dataset.subir) {
    const actual = E.datos.familias.find(f => f.id === E.nivelFam);
    E.familia = actual?.id ?? E.familia;
    E.nivelFam = actual?.padre_id ?? null;
    return pintarVenta();
  }
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
      trasOperacion();
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
    ${t.lineas.map(l => `<div class="fila"><span>${uds(l.unidades)} ${esc(l.descripcion)}</span><span>${euros(l.importe)}</span></div>${l.alergenos ? `<div class="alerg-ticket">Alérgenos: ${esc(l.alergenos)}</div>` : ''}`).join('')}<hr>
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
    lineas: c.lineas.map(l => ({ ...l, importe: Math.round(l.unidades * l.precio), alergenos: nombresAlergenos(E.datos.articulos.find(a => a.id === l.articulo_id)?.alergenos) })), total: c.total, impuestos: [],
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
  articulos: { titulo: 'Artículos', campos: [['nombre', 'Nombre'], ['precio', 'Precio (€)', 'euros'], ['iva', 'IVA %', 'num'], ['familia_id', 'Familia', 'familias'], ['orden_plato_id', 'Orden de plato', 'ordenes_plato'], ['orden', 'Orden', 'num'], ['activo', 'Activo', 'bool'], ['imagen', 'Imagen', 'imagen'], ['color_fondo', 'Color de fondo', 'colorop'], ['color_texto', 'Color de letra', 'colorop'], ['alergenos', 'Alérgenos', 'alergenos']] },
  familias: { titulo: 'Familias', campos: [['nombre', 'Nombre'], ['color', 'Color', 'color'], ['padre_id', 'Subfamilia de', 'familias'], ['departamento_id', 'Departamento', 'departamentos'], ['orden', 'Orden', 'num'], ['imagen', 'Imagen', 'imagen'], ['color_fondo', 'Color de fondo', 'colorop'], ['color_texto', 'Color de letra', 'colorop']] },
  departamentos: { titulo: 'Departamentos', campos: [['nombre', 'Nombre']] },
  zonas: { titulo: 'Zonas', campos: [['nombre', 'Nombre'], ['tipo', 'Tipo', 'tipozona'], ['orden', 'Orden', 'num']] },
  mesas: { titulo: 'Mesas', campos: [['nombre', 'Nombre'], ['zona_id', 'Zona', 'zonas'], ['x', 'Columna', 'num'], ['y', 'Fila', 'num']] },
  formas_cobro: { titulo: 'Formas de cobro', campos: [['nombre', 'Nombre'], ['tipo', 'Tipo', 'tipocobro'], ['activa', 'Activa', 'bool'], ['orden', 'Orden', 'num']] },
  operarios: { titulo: 'Operarios', campos: [['nombre', 'Nombre'], ['pin', 'Clave (vacía = entra sin clave)', 'clave'], ['rfid', 'Pulsera RFID', 'rfid'], ['permisos', 'Permisos', 'permisos'], ['orden', 'Orden', 'num']] },
  ordenes_plato: { titulo: 'Órdenes de plato', campos: [['nombre', 'Nombre'], ['orden', 'Orden', 'num']] },
  ivas: { titulo: 'IVAs', campos: [['nombre', 'Nombre'], ['codigo', 'Código'], ['porcentaje', 'IVA %', 'num'], ['recargo', 'Recargo equivalencia %', 'num'], ['orden', 'Orden', 'num']] },
  puestos: { titulo: 'Puestos', campos: [['nombre', 'Nombre'], ['tipo', 'Tipo', 'tipopuesto'], ['impresora_tickets_id', 'Impresora de tickets', 'impresoras'], ['usar_permisos', 'Activar permisos de operarios', 'bool'], ['pedir_operario', 'Pedir operario en cada operación', 'bool'], ['orden', 'Orden', 'num']] },
  impresoras: { titulo: 'Impresoras de cocina y tickets', campos: [['nombre', 'Nombre'], ['ip', 'Dirección IP'], ['puerto', 'Puerto', 'num'], ['uso', 'Uso', 'usoimpresora'], ['departamento_id', 'Departamento', 'departamentos'], ['activa', 'Activa', 'bool'], ['orden', 'Orden', 'num']] },
  comentarios: { titulo: 'Comentarios de comanda', campos: [['texto', 'Comentario'], ['familia_id', 'Solo familia', 'familias'], ['articulo_id', 'Solo artículo', 'articulos'], ['orden', 'Orden', 'num']] },
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
const REFS = ['familias', 'departamentos', 'zonas', 'impresoras', 'articulos', 'ordenes_plato'];

function valorCelda(tipo, v) {
  if (tipo === 'euros') return euros(v);
  if (tipo === 'bool') return v ? 'Sí' : 'No';
  if (tipo === 'grupo') return GRUPOS.find(g => g[0] === v)?.[1] ?? '';
  if (OPCIONES[tipo]) return OPCIONES[tipo].find(o => o[0] === v)?.[1] ?? v;
  if (REFS.includes(tipo)) return E.datos[tipo].find(x => x.id === v)?.nombre ?? '';
  if (tipo === 'accion') return esc(E.datos.acciones[v] ?? v);
  if (tipo === 'colorop') return v ? `<span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${esc(v)}"></span>` : 'Normal';
  if (tipo === 'color') return `<span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${esc(v)}"></span>`;
  if (tipo === 'imagen') return v ? `<img class="mini-tabla" src="${esc(urlImagen(v))}" alt="" loading="lazy" onerror="this.replaceWith('—')">` : '';
  if (tipo === 'alergenos') return `<span class="alerg-tabla">${iconosAlergenos(v)}</span>`;
  if (tipo === 'clave') return v ? '••••' : 'Sin clave';
  if (tipo === 'rfid') return v ? 'Sí' : '—';
  if (tipo === 'permisos') return String(v || '').split(',').filter(Boolean).map(p => esc(E.datos.permisos[p] ?? p)).join(', ') || 'Ninguno';
  return esc(v);
}

function campoForm([k, etiqueta, tipo], fila) {
  const v = fila?.[k];
  if (tipo === 'bool') return `<label><span>${etiqueta}</span><select name="${k}"><option value="1" ${v !== 0 ? 'selected' : ''}>Sí</option><option value="0" ${v === 0 ? 'selected' : ''}>No</option></select></label>`;
  if (tipo === 'clave') return `<label>${etiqueta}<input name="${k}" type="password" inputmode="numeric" autocomplete="new-password" value="${esc(v ?? '')}"></label>`;
  if (tipo === 'rfid') return `<label>${etiqueta}<input name="${k}" value="${esc(v ?? '')}" placeholder="Toca aquí y pasa la pulsera por el lector" autocomplete="off" onkeydown="if(event.key==='Enter')event.preventDefault()"></label>`;
  if (tipo === 'permisos') {
    const sel = new Set(String(v || '').split(',').filter(Boolean));
    return `<div class="campo-alergenos"><span>${etiqueta}</span><input type="hidden" name="${k}" value="${esc(v ?? '')}">
      <div class="rejilla-permisos">${Object.entries(E.datos.permisos).map(([p, t]) => `<button type="button" data-alergeno="${p}" class="${sel.has(p) ? 'activo' : ''}">${esc(t)}</button>`).join('')}</div></div>`;
  }
  if (tipo === 'alergenos') {
    const sel = new Set(String(v || '').split(',').filter(Boolean));
    return `<div class="campo-alergenos"><span>${etiqueta}</span><input type="hidden" name="${k}" value="${esc(v ?? '')}">
      <div class="rejilla-alergenos">${(E.datos.alergenos ?? []).map(a => `<button type="button" data-alergeno="${a.codigo}" class="${sel.has(a.codigo) ? 'activo' : ''}">
        ${a.imagen ? `<img src="${esc(urlImagen(a.imagen))}" alt="">` : `<i class="ico-alerg txt">${esc(a.nombre.slice(0, 2))}</i>`}<span>${esc(a.nombre)}</span></button>`).join('')}</div></div>`;
  }
  if (tipo === 'imagen') return `<div class="campo-imagen"><span>${etiqueta}</span><input type="hidden" name="${k}" value="${esc(v ?? '')}">
    <div class="vista-imagen" data-elegir-imagen="${k}">${v ? `<img src="${esc(urlImagen(v))}" alt="">` : '<small>Sin imagen</small>'}</div>
    <div class="botones" style="padding:0"><button type="button" data-elegir-imagen="${k}">Elegir imagen</button>${v ? `<button type="button" data-quitar-imagen="${k}">Quitar</button>` : ''}</div></div>`;
  if (tipo === 'colorop' || tipo === 'color') return `<div class="campo-color"><span>${etiqueta}</span>${campoColor(k, tipo === 'color' ? (v || '#3d5a80') : (v || ''), tipo === 'colorop')}</div>`;
  const opts = tipo === 'accion' ? Object.entries(E.datos.acciones) : tipo === 'grupo' ? GRUPOS : OPCIONES[tipo] ?? (REFS.includes(tipo) ? [['', '—'], ...E.datos[tipo].map(x => [x.id, x.nombre])] : null);
  if (opts) return `<label>${etiqueta}<select name="${k}">${opts.map(([val, txt]) => `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(txt)}</option>`).join('')}</select></label>`;
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
        <div class="botones"><button class="primario" data-editar="nuevo">+ Añadir</button>
          ${E.tablaGestion === 'articulos' ? '<button data-auto-imagenes="1" title="Busca en el banco una imagen con el mismo nombre que el artículo">Poner imágenes automáticamente</button>' : ''}</div>
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
    const b = e.target.closest('[data-volver],[data-editar],#b-borrar,[data-elegir-imagen],[data-quitar-imagen],[data-alergeno],[data-auto-imagenes]');
    if (!b) return;
    if (b.dataset.volver) return ir('config');
    if (b.dataset.alergeno) {
      b.classList.toggle('activo');
      const caja = b.closest('.campo-alergenos');
      caja.querySelector('input').value = [...caja.querySelectorAll('[data-alergeno].activo')].map(x => x.dataset.alergeno).join(',');
      return;
    }
    if (b.dataset.autoImagenes) {
      if (!confirm('¿Buscar en el banco una imagen para cada artículo que no tenga? Las imágenes que ya has puesto no se cambian.')) return;
      const r = await api('POST', '/imagenes/asignar', {});
      await cargarDatos();
      await pintarGestion(editar);
      abrirModal(`<h2><span>Imágenes automáticas</span><button data-m="cerrar" onclick="this.closest('#modal').click()">✕</button></h2>
        <div class="form"><p><b>${r.puestas.length}</b> artículos con imagen nueva${r.puestas.length ? ': ' + r.puestas.map(x => esc(x.nombre)).join(', ') : ''}.</p>
        ${r.sin.length ? `<p class="nota">Sin imagen parecida (${r.sin.length}): ${r.sin.map(esc).join(', ')}. Puedes elegirlas a mano.</p>` : ''}</div>`);
      $('#modal-caja').onclick = ev => { if (ev.target.closest('[data-m="cerrar"]')) cerrarModal(); };
      return;
    }
    if (b.dataset.elegirImagen || b.dataset.quitarImagen) {
      const k = b.dataset.elegirImagen || b.dataset.quitarImagen;
      const input = $('#f-gestion').elements[k];
      const ruta = b.dataset.quitarImagen ? '' : await elegirImagen(input.value);
      if (ruta === null) return;
      input.value = ruta;
      const vista = $(`#f-gestion .vista-imagen[data-elegir-imagen="${k}"]`);
      vista.innerHTML = ruta ? `<img src="${esc(urlImagen(ruta))}" alt="">` : '<small>Sin imagen</small>';
      return;
    }
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
  ['Informes', [
    ['informes', 'Ventas y caja', 'Ventas por forma de cobro y por familia'],
    ['borrados', 'Borrados', 'Líneas y cuentas borradas por operario, hora, familia y artículo'],
    ['empleados', 'Control de empleados', 'Ventas, borrados y actividad de cada operario'],
    ['registro', 'Registro de actividad', 'Todo lo que pasa en el TPV, con fecha y hora'],
  ]],
  ['Carta', [
    ['articulos', 'Artículos', 'Precios, IVA y familia'],
    ['familias', 'Familias', 'Colores, orden y subfamilias'],
    ['departamentos', 'Departamentos', 'Agrupan familias (barra, cocina...)'],
    ['ordenes_plato', 'Órdenes de plato', 'Primeros, segundos, postres... para la comanda'],
    ['comentarios', 'Comentarios de comanda', 'Con hielo, sin azúcar... por familia o artículo'],
  ]],
  ['Local', [
    ['zonas', 'Zonas', 'Barra, comedor, terraza...'],
    ['mesas', 'Mesas', 'Mesas de cada zona'],
    ['puestos', 'Puestos', 'TPV, PDA y pantallas de cocina'],
    ['impresoras', 'Impresoras', 'Tickets, cocina y barra'],
    ['operarios', 'Operarios', 'Camareros, claves, pulseras y permisos'],
    ['este_puesto', 'Puesto de este dispositivo', 'Qué puesto es esta pantalla'],
  ]],
  ['Cobros e impuestos', [
    ['formas_cobro', 'Formas de pago', 'Efectivo, tarjeta, pendiente...'],
    ['ivas', 'IVAs', 'Tipos de IVA y recargo'],
    ['conceptos_pago', 'Conceptos de pago', 'Entradas y salidas de caja'],
  ]],
  ['Personalización', [
    ['empresa', 'Datos de empresa', 'Nombre, NIF, dirección y serie'],
    ['aspecto', 'Aspecto', 'Tamaño de zonas y botones, colores'],
    ['escala', 'Tamaño en esta pantalla', 'Automático o fijo para este TPV'],
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
    if (k === 'este_puesto') return elegirPuesto();
    if (k === 'escala') return elegirEscala();
    if (['abiertas', 'empresa', 'borrados', 'registro', 'aspecto', 'empleados'].includes(k)) return ir(k);
    if (k === 'informes') return ir('caja');
    E.tablaGestion = k;
    return ir('gestion');
  });
}

async function pintarAbiertas() {
  await cargarAbiertas();
  $('#vista').innerHTML = `<div class="mesas">
    <h2 class="titulo-vista">Cuentas abiertas (${E.abiertas.length})</h2>
    <div class="plano"><div class="lista-barra">
      ${E.abiertas.map(a => `<button data-abrir="${a.id}"><b>${esc(nombreCuenta(a))}</b><br>${euros(a.total)}<br><small>${hora(a.abierta_en)}</small></button>`).join('')}
      ${E.abiertas.length ? '' : '<div class="vacio">No hay cuentas abiertas</div>'}
    </div></div></div>`;
  $('#vista').onclick = e => intentar(async () => {
    const b = e.target.closest('[data-abrir]');
    if (!b) return;
    E.cuenta = { id: Number(b.dataset.abrir) };
    E.lineaSel = null;
    return ir('venta');
  });
}

// ---------- Tamaño según la pantalla ----------
// "auto": se diseña para 1280x800 o más; en pantallas menores (1024x768...) todo se reduce
// en proporción. En PDA y móviles (menos de 760 px de ancho) no se toca. Cada pantalla
// puede fijar su propio tamaño en Configuración > Tamaño en esta pantalla.
const ESCALAS = [['auto', 'Automático'], ['0.6', '60 %'], ['0.7', '70 %'], ['0.8', '80 %'], ['0.9', '90 %'], ['1', '100 %'], ['1.1', '110 %'], ['1.25', '125 %']];
function escalaElegida() { try { return localStorage.getItem('escala') || 'auto'; } catch { return 'auto'; } }
function ajustarEscala() {
  const elegida = escalaElegida();
  let k = Number(elegida);
  if (elegida === 'auto' || !k) {
    const w = window.innerWidth, h = window.innerHeight;
    k = w <= 760 ? 1 : Math.max(0.6, Math.min(1, w / 1280, h / 800));
  }
  document.documentElement.style.setProperty('--escala', String(Math.round(k * 100) / 100));
}
ajustarEscala();
window.addEventListener('resize', ajustarEscala);

function elegirEscala() {
  const pintar = () => {
    const actual = escalaElegida();
    abrirModal(`<h2><span>Tamaño en esta pantalla</span><button data-m="cerrar">✕</button></h2>
      <div class="form"><p class="nota">Pantalla de ${screen.width}×${screen.height}. "Automático" lo ajusta solo según el tamaño; si prefieres, fija uno. Se guarda solo en este dispositivo.</p>
      <div class="po-nombres ordenes">${ESCALAS.map(([v, t]) => `<button data-escala="${v}" class="${v === actual ? 'activo' : ''}"><b>${t}</b></button>`).join('')}</div></div>`);
    $('#modal-caja').onclick = e => {
      const b = e.target.closest('button');
      if (b?.dataset.m === 'cerrar') return cerrarModal();
      if (b?.dataset.escala) {
        try { localStorage.setItem('escala', b.dataset.escala); } catch {}
        ajustarEscala();
        pintar();
      }
    };
  };
  pintar();
}

// ---------- Operarios ----------
const puestoActual = () => E.datos?.puestos?.find(p => p.id === E.puestoId);
const puestoPideOperario = () => !!(E.datos.operarios.length && (puestoActual()?.usar_permisos || puestoActual()?.pedir_operario));
function tienePermiso(p) {
  if (!puestoActual()?.usar_permisos) return true;
  if (p === 'configuracion' && !E.datos.operarios.some(o => o.permisos.includes('configuracion'))) return true;
  return !!E.operario?.permisos.includes(p);
}
function ponerOperario(o) {
  E.operario = o ? { id: o.id, nombre: o.nombre, permisos: o.permisos } : null;
  try { sessionStorage.setItem('operario', JSON.stringify(E.operario)); } catch {}
  pintarOperarioActual();
}
function pintarOperarioActual() {
  let el = $('#operario-actual');
  if (!el) {
    el = document.createElement('button');
    el.id = 'operario-actual';
    el.title = 'Cambio de operario';
    el.onclick = () => mostrarPanelOperarios();
    $('.estado').prepend(el);
  }
  el.textContent = E.operario ? `👤 ${E.operario.nombre}` : '👤 Sin operario';
  el.classList.toggle('oculto', !E.datos?.operarios?.length);
}
// Tras cobrar o guardar: si el puesto pide operario en cada operación, se vuelve al panel.
function trasOperacion() {
  if (!puestoActual()?.pedir_operario || !E.datos.operarios.length) return;
  ponerOperario(null);
  if ($('#modal').classList.contains('oculto')) mostrarPanelOperarios();
  else E.pedirTrasModal = true;
}

async function entrarOperario(datos) {
  const o = await api('POST', '/operarios/entrar', datos);
  ponerOperario(o);
  $('#panel-operarios')?.remove();
  aviso(`Hola, ${o.nombre}`);
}

function mostrarPanelOperarios() {
  $('#panel-operarios')?.remove();
  const obligatorio = puestoPideOperario();
  const panel = document.createElement('div');
  panel.id = 'panel-operarios';
  panel.innerHTML = `<div class="po-caja">
    <div class="po-cab"><h2>¿Quién eres?</h2><small>Toca tu nombre o pasa tu pulsera por el lector</small></div>
    <div class="po-nombres">${E.datos.operarios.map(o => `<button data-op="${o.id}"><b>${esc(o.nombre)}</b>${o.con_clave ? '<small>🔒 con clave</small>' : ''}</button>`).join('')
      || '<div class="vacio">No hay operarios. Créalos en Configuración, Operarios.</div>'}</div>
    <div class="po-clave oculto" id="po-clave">
      <div class="po-nombre" id="po-nombre"></div>
      <div class="po-puntos" id="po-puntos"></div>
      <div class="po-teclas">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>
      <div class="po-acc"><button data-volver-op="1">Volver</button><button class="primario" data-ok="1">Entrar</button></div>
    </div>
    <div class="po-pie">
      <span>Puesto: <b>${esc(puestoActual()?.nombre ?? '—')}</b></span>
      ${obligatorio ? '' : '<button data-cerrar-op="1">Seguir sin operario</button>'}
    </div>
  </div>`;
  document.body.append(panel);
  let elegido = null, clave = '';
  const pintarClave = () => { $('#po-puntos').textContent = '•'.repeat(clave.length) || ' '; };
  panel.onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cerrarOp) return panel.remove();
    if (b.dataset.op) {
      elegido = E.datos.operarios.find(o => o.id === Number(b.dataset.op));
      if (!elegido.con_clave) return entrarOperario({ operario_id: elegido.id });
      clave = '';
      $('#po-nombre').textContent = elegido.nombre;
      pintarClave();
      $('.po-nombres', panel).classList.add('oculto');
      $('#po-clave').classList.remove('oculto');
      return;
    }
    if (b.dataset.volverOp) { $('#po-clave').classList.add('oculto'); $('.po-nombres', panel).classList.remove('oculto'); return; }
    if (b.dataset.k) {
      const k = b.dataset.k;
      clave = k === 'C' ? '' : k === '⌫' ? clave.slice(0, -1) : (clave + k).slice(0, 12);
      return pintarClave();
    }
    if (b.dataset.ok) {
      try { await entrarOperario({ operario_id: elegido.id, clave }); }
      catch (err) { clave = ''; pintarClave(); throw err; }
    }
  });
}

// Lector RFID: escribe el código muy rápido y termina con Enter, como un teclado.
(() => {
  let buf = '', ultimo = 0;
  document.addEventListener('keydown', e => {
    if (e.target.closest?.('input, textarea, select')) return;
    const ahora = Date.now();
    if (ahora - ultimo > 80) buf = '';
    ultimo = ahora;
    if (e.key === 'Enter') {
      if (buf.length >= 4) { const codigo = buf; buf = ''; e.preventDefault(); intentar(() => entrarOperario({ rfid: codigo })); }
      buf = '';
    } else if (e.key.length === 1) buf += e.key;
  });
})();

function elegirPuesto() {
  abrirModal(`<h2><span>Puesto de este dispositivo</span><button data-m="cerrar">✕</button></h2>
    <div class="form"><p class="nota">Cada pantalla (TPV, PDA...) es un puesto. Sus opciones de operarios y permisos se configuran en Configuración, Puestos.</p>
    <div class="po-nombres">${E.datos.puestos.map(p => `<button data-puesto="${p.id}" class="${p.id === E.puestoId ? 'activo' : ''}"><b>${esc(p.nombre)}</b><small>${p.usar_permisos ? 'Con permisos' : 'Sin permisos'}${p.pedir_operario ? ' · pide operario' : ''}</small></button>`).join('')}</div></div>`);
  $('#modal-caja').onclick = e => {
    const b = e.target.closest('button');
    if (b?.dataset.m === 'cerrar') return cerrarModal();
    if (b?.dataset.puesto) {
      E.puestoId = Number(b.dataset.puesto);
      try { localStorage.setItem('puesto', String(E.puestoId)); } catch {}
      cerrarModal();
      aviso(`Este dispositivo es ahora "${puestoActual().nombre}"`);
      if (!E.operario && puestoPideOperario()) mostrarPanelOperarios();
    }
  };
}

// ---------- Orden de comanda y marchar ----------
function elegirOrdenPlato() {
  const c = E.cuenta;
  const l = c.lineas.find(x => x.id === E.lineaSel);
  const opciones = E.datos.ordenes_plato;
  if (!opciones.length) return aviso('Crea primero los órdenes de plato en Configuración', true);
  abrirModal(`<h2><span>Orden de comanda</span><button data-m="cerrar">✕</button></h2>
    <div class="form">
      <p>${l ? `Para <b>${esc(l.descripcion)}</b>` : 'Para <b>todas las líneas sin orden</b> (selecciona una línea para cambiar solo esa)'}</p>
      <div class="po-nombres ordenes">${opciones.map(o => `<button data-op="${o.id}" class="${l?.orden_plato_id === o.id ? 'activo' : ''}"><b>${esc(o.nombre)}</b></button>`).join('')}
        ${l?.orden_plato_id ? '<button data-op="0"><b>Quitar orden</b></button>' : ''}</div>
    </div>`);
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (b?.dataset.m === 'cerrar') return cerrarModal();
    if (!b?.dataset.op) return;
    const id = Number(b.dataset.op) || null;
    E.cuenta = await api('POST', `/cuentas/${c.id}/orden_plato`, { orden_plato_id: id, lineas: l ? [l.id] : [] });
    cerrarModal();
    return pintarVenta();
  });
}

function marcharCocina() {
  const c = E.cuenta;
  abrirModal(`<h2><span>Marchar cocina · ${esc(nombreCuenta(c))}</span><button data-m="cerrar">✕</button></h2>
    <div class="form"><p>¿Qué hay que marchar?</p>
      <div class="po-nombres ordenes">${E.datos.ordenes_plato.map(o => `<button data-op="${o.id}"><b>${esc(o.nombre)}</b><small>${c.lineas.filter(x => x.orden_plato_id === o.id).length} líneas</small></button>`).join('')}</div>
    </div>`);
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (b?.dataset.m === 'cerrar') return cerrarModal();
    if (!b?.dataset.op) return;
    const r = await api('POST', `/cuentas/${c.id}/marchar`, { orden_plato_id: Number(b.dataset.op) });
    cerrarModal();
    aviso(`Enviado: ${r.texto}`);
  });
}

async function verComanda() {
  const r = await api('GET', `/cuentas/${E.cuenta.id}/comanda`);
  abrirModal(`<h2><span>Comanda</span><button data-m="cerrar">✕</button></h2>
    <div class="ticket comanda-previa"><div class="c"><b>${esc(r.cuenta)}</b><br>${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${E.operario ? ' · ' + esc(E.operario.nombre) : ''}</div>
      ${r.grupos.map(g => `<div class="grupo-comanda">— ${esc(g.nombre.toUpperCase())} —</div>${g.lineas.map(l => `<div class="fila"><span>${uds(l.unidades)} x ${esc(l.texto)}</span></div>`).join('')}`).join('')}
    </div>
    <p class="nota" style="padding:0 16px">Así saldrá en la impresora de cocina o barra cuando conectemos las impresoras.</p>
    <div class="botones"><button data-m="cerrar">Cerrar</button></div>`);
  $('#modal-caja').onclick = e => { if (e.target.closest('[data-m="cerrar"]')) cerrarModal(); };
}

// ---------- Control de empleados ----------
async function pintarEmpleados(desde = E.empDesde ?? hoyLocal(), hasta = E.empHasta ?? hoyLocal(), op = E.empOp ?? '') {
  E.empDesde = desde; E.empHasta = hasta; E.empOp = op;
  const r = await api('GET', `/informes/empleados?desde=${desde}&hasta=${hasta}&operario=${op}`);
  $('#vista').innerHTML = `<div class="informe scroll">
    ${cabeceraConfig('Control de empleados')}
    <div class="filtros">
      <label>Desde <input type="date" id="e-desde" value="${desde}"></label>
      <label>Hasta <input type="date" id="e-hasta" value="${hasta}"></label>
      <label>Operario <select id="e-op"><option value="">Todos</option>${E.datos.operarios.map(o => `<option value="${o.id}" ${String(o.id) === String(op) ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select></label>
    </div>
    <section class="panel"><table><thead><tr><th>Operario</th><th class="num">Tickets</th><th class="num">Vendido</th><th class="num">Artículos</th>
      <th class="num">Anulaciones</th><th class="num">Importe anulado</th><th class="num">Líneas borradas</th><th class="num">Importe borrado</th></tr></thead><tbody>
      ${r.empleados.map(x => `<tr><td><b>${esc(x.nombre)}</b></td><td class="num">${x.tickets}</td><td class="num">${euros(x.vendido)}</td><td class="num">${uds(x.unidades)}</td>
        <td class="num">${x.anulaciones}</td><td class="num">${euros(x.anulado)}</td><td class="num">${x.lineas_borradas}</td><td class="num">${euros(x.importe_borrado)}</td></tr>`).join('')
        || '<tr><td colspan="8" class="vacio">Sin datos en estas fechas</td></tr>'}
    </tbody></table></section>
    <h3>Qué ha hecho cada uno</h3>
    <section class="panel"><table><thead><tr><th>Fecha y hora</th><th>Operario</th><th>Acción</th></tr></thead><tbody>
      ${r.actividad.map(a => `<tr class="nivel-${esc(a.nivel)}"><td>${esc(a.fecha.slice(8, 10) + '/' + a.fecha.slice(5, 7) + ' ' + a.fecha.slice(11, 19))}</td><td>${esc(a.operario || '—')}</td><td>${esc(a.accion)}</td></tr>`).join('')
        || '<tr><td colspan="3" class="vacio">Sin actividad</td></tr>'}
    </tbody></table></section>
  </div>`;
  $('#vista').onchange = () => intentar(() => pintarEmpleados($('#e-desde').value, $('#e-hasta').value, $('#e-op').value));
  $('#vista').onclick = e => { if (e.target.closest('[data-volver]')) ir('config'); };
}

// ---------- Paleta de colores ----------
// Campo de color: una muestra que abre la paleta; el valor va en un input oculto.
function campoColor(nombre, valor, permitirVacio) {
  return `<span class="selector-color"><input type="hidden" name="${esc(nombre)}" value="${esc(valor)}">
    <button type="button" class="muestra-color ${valor ? '' : 'vacia'}" data-color-campo="${permitirVacio ? 'vacio' : 'lleno'}" style="--mc:${esc(valor || 'transparent')}"></button>
    <small>${valor ? esc(valor.toUpperCase()) : 'Sin color'}</small></span>`;
}
function refrescarMuestra(span) {
  const v = span.querySelector('input').value;
  const b = span.querySelector('.muestra-color');
  b.style.setProperty('--mc', v || 'transparent');
  b.classList.toggle('vacia', !v);
  span.querySelector('small').textContent = v ? v.toUpperCase() : 'Sin color';
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-color-campo]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  const span = b.closest('.selector-color');
  const input = span.querySelector('input');
  intentar(async () => {
    const c = await elegirColor(input.value, b.dataset.colorCampo === 'vacio');
    if (c === null) return;
    input.value = c;
    refrescarMuestra(span);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}, true);

const COLORES_BASICOS = [
  '#ff8080', '#ffff80', '#80ff80', '#00ff80', '#80ffff', '#0080ff', '#ff80c0', '#ff80ff',
  '#ff0000', '#ffff00', '#80ff00', '#00ff40', '#00ffff', '#0080c0', '#8080c0', '#ff00ff',
  '#804040', '#ff8040', '#00ff00', '#008080', '#004080', '#8080ff', '#800040', '#ff0080',
  '#800000', '#ff8000', '#008000', '#008040', '#0000ff', '#0000a0', '#800080', '#8000ff',
  '#400000', '#804000', '#004000', '#004040', '#000080', '#000040', '#400040', '#400080',
  '#000000', '#808000', '#808040', '#808080', '#408080', '#c0c0c0', '#e6e6e6', '#ffffff',
];
const COLORES_MARCA = ['#0064fc', '#0b1527', '#3c3c3b', '#2e9d4f', '#c8443a', '#f59e0b', '#6f4e37', '#2a9d8f'];

const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r, g, b) => '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
function hsl2rgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function leerPersonalizados() {
  try { const v = JSON.parse(localStorage.getItem('coloresPersonalizados') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Paleta: colores básicos, colores de la marca, colores personalizados y espectro.
// Devuelve el color elegido (#rrggbb), '' para "sin color" o null si se cancela.
function elegirColor(actual, permitirVacio) {
  return new Promise(resolve => {
    let [h, s, l] = rgb2hsl(...hex2rgb(/^#[0-9a-f]{6}$/i.test(actual) ? actual : '#0064fc'));
    let personal = leerPersonalizados();
    const actualHex = () => rgb2hex(...hsl2rgb(h, s, l));
    const fila = (lista, clase = '') => lista.map(c => `<button type="button" class="${clase}" data-c="${c}" style="--mc:${c}" title="${c.toUpperCase()}"></button>`).join('');
    abrirModal(`<h2><span>Elegir color</span><button data-cancelar="1">✕</button></h2>
      <div class="paleta">
        <div class="paleta-izq">
          <h4>Colores básicos</h4><div class="muestras">${fila(COLORES_BASICOS)}</div>
          <h4>Colores LevaDigital</h4><div class="muestras">${fila(COLORES_MARCA)}</div>
          <h4>Colores personalizados</h4><div class="muestras" id="pal-personal"></div>
        </div>
        <div class="paleta-der">
          <div class="espectro-caja"><canvas id="pal-espectro" width="256" height="200"></canvas><i id="pal-cruz"></i></div>
          <div class="luz-caja"><canvas id="pal-luz" width="22" height="200"></canvas><i id="pal-flecha"></i></div>
          <div class="pal-datos">
            <div class="pal-previa" id="pal-previa"></div>
            <label>Código <input id="pal-hex" maxlength="7" autocomplete="off"></label>
            <label>Rojo <input id="pal-r" type="number" min="0" max="255"></label>
            <label>Verde <input id="pal-g" type="number" min="0" max="255"></label>
            <label>Azul <input id="pal-b" type="number" min="0" max="255"></label>
            <button type="button" data-agregar="1">Agregar a los colores personalizados</button>
          </div>
        </div>
      </div>
      <div class="botones" style="justify-content:flex-end">
        ${permitirVacio ? '<button type="button" data-vacio="1">Sin color</button>' : ''}
        <button type="button" data-cancelar="1">Cancelar</button>
        <button type="button" class="primario" data-aceptar="1">Aceptar</button>
      </div>`);
    const esp = $('#pal-espectro'), luz = $('#pal-luz');
    const cx = esp.getContext('2d');
    for (let x = 0; x < esp.width; x++) {
      const g = cx.createLinearGradient(0, 0, 0, esp.height);
      g.addColorStop(0, `hsl(${x / esp.width * 360},100%,50%)`);
      g.addColorStop(1, `hsl(${x / esp.width * 360},0%,50%)`);
      cx.fillStyle = g;
      cx.fillRect(x, 0, 1, esp.height);
    }
    const pintar = (desdeCampos = false) => {
      const lx = luz.getContext('2d');
      const g = lx.createLinearGradient(0, 0, 0, luz.height);
      g.addColorStop(0, '#fff'); g.addColorStop(.5, `hsl(${h},${s}%,50%)`); g.addColorStop(1, '#000');
      lx.fillStyle = g; lx.fillRect(0, 0, luz.width, luz.height);
      $('#pal-cruz').style.left = `${h / 360 * 100}%`;
      $('#pal-cruz').style.top = `${100 - s}%`;
      $('#pal-flecha').style.top = `${100 - l}%`;
      const hex = actualHex();
      $('#pal-previa').style.background = hex;
      if (!desdeCampos) {
        $('#pal-hex').value = hex.toUpperCase();
        const [r, gg, b] = hex2rgb(hex);
        $('#pal-r').value = r; $('#pal-g').value = gg; $('#pal-b').value = b;
      }
      $('#pal-personal').innerHTML = fila(personal) + '<span class="hueco"></span>'.repeat(Math.max(0, 16 - personal.length));
      document.querySelectorAll('.paleta .muestras button').forEach(b => b.classList.toggle('elegido', b.dataset.c === hex));
    };
    const ponerHex = hex => { [h, s, l] = rgb2hsl(...hex2rgb(hex)); };
    const arrastrar = (el, fn) => {
      const mover = e => { const r = el.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))); pintar(); };
      el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); mover(e); el.onpointermove = mover; });
      el.addEventListener('pointerup', () => { el.onpointermove = null; });
    };
    arrastrar(esp.parentElement, (x, y) => { h = x * 360; s = (1 - y) * 100; if (l < 5 || l > 95) l = 50; });
    arrastrar(luz.parentElement, (x, y) => { l = (1 - y) * 100; });
    $('#pal-hex').oninput = e => { const v = e.target.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) { ponerHex(v.startsWith('#') ? v : '#' + v); pintar(true); } };
    for (const id of ['#pal-r', '#pal-g', '#pal-b']) $(id).oninput = () => { ponerHex(rgb2hex(+$('#pal-r').value, +$('#pal-g').value, +$('#pal-b').value)); pintar(true); $('#pal-hex').value = actualHex().toUpperCase(); };
    const fin = v => { cerrarModal(); resolve(v); };
    $('#modal-caja').onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.c) { ponerHex(b.dataset.c); return pintar(); }
      if (b.dataset.cancelar) return fin(null);
      if (b.dataset.vacio) return fin('');
      if (b.dataset.aceptar) return fin(actualHex());
      if (b.dataset.agregar) {
        personal = [actualHex(), ...personal.filter(c => c !== actualHex())].slice(0, 16);
        try { localStorage.setItem('coloresPersonalizados', JSON.stringify(personal)); } catch {}
        return pintar();
      }
    };
    $('#modal-caja').ondblclick = e => { const b = e.target.closest('button[data-c]'); if (b) fin(b.dataset.c); };
    const obs = new MutationObserver(() => { if ($('#modal').classList.contains('oculto')) { obs.disconnect(); resolve(null); } });
    obs.observe($('#modal'), { attributes: true, attributeFilter: ['class'] });
    pintar();
  });
}

// ---------- Banco de imágenes ----------
// Abre el selector y devuelve la ruta elegida (o null si se cancela).
function elegirImagen(actual = '') {
  return new Promise(resolve => intentar(async () => {
    E.imagenes = await api('GET', '/imagenes');
    const { carpetas } = E.imagenes;
    let grupo = carpetas.find(c => c.imagenes.includes(actual))?.nombre ?? carpetas[0]?.nombre ?? '';
    let filtro = '';
    const nombreDe = r => r.split('/').pop().replace(/\.[^.]+$/, '');
    $('#modal-caja').classList.add('ancho');
    abrirModal(`<h2><span>Elegir imagen</span><button data-cancelar="1">✕</button></h2>
      <div class="banco">
        <div class="banco-carpetas" id="banco-carpetas"></div>
        <div class="banco-der">
          <div class="banco-barra">
            <input id="banco-buscar" placeholder="Buscar en todas las carpetas..." autocomplete="off">
            <label class="boton-subir">Subir imagen<input type="file" id="banco-subir" accept="image/*" hidden></label>
          </div>
          <div class="banco-grid" id="banco-grid"></div>
        </div>
      </div>`);
    const pintar = () => {
      $('#banco-carpetas').innerHTML = carpetas.map(c => `<button data-grupo="${esc(c.nombre)}" class="${c.nombre === grupo && !filtro ? 'activa' : ''}">${esc(c.nombre)} <small>${c.imagenes.length}</small></button>`).join('')
        || '<div class="vacio">No hay carpetas</div>';
      const lista = filtro
        ? carpetas.flatMap(c => c.imagenes).filter(r => r.toLowerCase().includes(filtro.toLowerCase())).slice(0, 300)
        : carpetas.find(c => c.nombre === grupo)?.imagenes ?? [];
      $('#banco-grid').innerHTML = lista.map(r => `<button data-img="${esc(r)}" class="${r === actual ? 'actual' : ''}" title="${esc(r)}"><img src="${esc(urlImagen(r))}" alt="" loading="lazy"><span>${esc(nombreDe(r))}</span></button>`).join('')
        || `<div class="vacio">${carpetas.length ? 'No hay imágenes' : `Copia las imágenes en la carpeta<br><b>${esc(E.imagenes.carpeta)}</b><br>o súbelas con el botón "Subir imagen".`}</div>`;
    };
    pintar();
    const cerrar = v => { cerrarModal(); resolve(v); };
    $('#modal-caja').onclick = e => {
      const b = e.target.closest('[data-grupo],[data-img],[data-cancelar]');
      if (!b) return;
      if (b.dataset.cancelar) return cerrar(null);
      if (b.dataset.grupo) { grupo = b.dataset.grupo; filtro = ''; $('#banco-buscar').value = ''; return pintar(); }
      if (b.dataset.img) return cerrar(b.dataset.img);
    };
    $('#banco-buscar').oninput = e => { filtro = e.target.value.trim(); pintar(); };
    $('#banco-subir').onchange = e => intentar(async () => {
      const f = e.target.files[0];
      if (!f) return;
      const r = await api('POST', '/imagenes', { nombre: f.name, datos: await reducirImagen(f) });
      aviso('Imagen subida a la carpeta Propias');
      cerrar(r.ruta);
    });
    // Si se cierra tocando fuera, cuenta como cancelar.
    const obs = new MutationObserver(() => { if ($('#modal').classList.contains('oculto')) { obs.disconnect(); resolve(null); } });
    obs.observe($('#modal'), { attributes: true, attributeFilter: ['class'] });
  }));
}

// Reduce la foto a un máximo de 320 px para que el TPV vaya ligero.
function reducirImagen(archivo, max = 320) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      // WEBP a 320 px: unos 10-20 KB por imagen.
      const webp = c.toDataURL('image/webp', 0.82);
      ok(webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => mal(new Error('No se ha podido leer la imagen'));
    img.src = URL.createObjectURL(archivo);
  });
}

// ---------- Aspecto ----------
// Ajustes a la izquierda y, a la derecha, la pantalla de venta real en pequeño, que cambia al mover cada ajuste.
function pintarAspecto() {
  const campos = Object.entries(E.datos.aspecto_campos);
  const val = { ...E.datos.aspecto };
  const grupos = [...new Set(campos.map(([, d]) => d[0]))];
  const control = ([k, [, etiqueta, tipo, min, max, , unidad]]) => tipo === 'color'
    ? `<div class="ajuste"><span>${esc(etiqueta)}</span>${campoColor(k, val[k], false)}</div>`
    : `<label class="ajuste"><span>${esc(etiqueta)}</span><output id="o-${k}">${val[k]}${unidad}</output>
        <input type="range" name="${k}" min="${min}" max="${max}" step="1" value="${val[k]}"></label>`;
  $('#vista').innerHTML = `<div class="mesas">
    ${cabeceraConfig('Aspecto de la pantalla de venta')}
    <div class="aspecto">
      <section class="panel ajustes" id="ajustes">
        ${grupos.map(g => `<h3>${esc(g)}</h3>${campos.filter(([, d]) => d[0] === g).map(control).join('')}`).join('')}
        <div class="acciones-aspecto">
          <button class="primario" data-guardar="1">Guardar</button>
          <button data-defecto="1">Valores de fábrica</button>
        </div>
      </section>
      <div class="previa" id="previa"><iframe src="/" title="Vista previa" tabindex="-1"></iframe><small>Vista previa</small></div>
    </div></div>`;
  const marco = $('#previa iframe');
  const escalar = () => { const p = $('#previa'); if (p) marco.style.transform = `scale(${Math.min(p.clientWidth / 1280, p.clientHeight / 800)})`; };
  escalar();
  new ResizeObserver(escalar).observe($('#previa'));
  const aPrevia = () => { try { aplicarAspecto(val, marco.contentDocument.documentElement); } catch {} };
  marco.addEventListener('load', () => setTimeout(aPrevia, 300));
  const leer = () => {
    for (const el of $('#ajustes').querySelectorAll('input')) {
      val[el.name] = el.type === 'range' ? Number(el.value) : el.value;
      const o = $(`#o-${el.name}`);
      if (o) o.textContent = el.value + E.datos.aspecto_campos[el.name][6];
    }
    aPrevia();
  };
  $('#ajustes').oninput = leer;
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.closest('[data-volver]')) return ir('config');
    if (e.target.closest('[data-defecto]')) {
      for (const el of $('#ajustes').querySelectorAll('input')) el.value = E.datos.aspecto_campos[el.name][5];
      $('#ajustes').querySelectorAll('.selector-color').forEach(refrescarMuestra);
      return leer();
    }
    if (e.target.closest('[data-guardar]')) {
      E.datos.aspecto = await api('PUT', '/aspecto', val);
      aplicarAspecto(E.datos.aspecto);
      aviso('Aspecto guardado. Se aplica en todos los puestos.');
    }
  });
}

// ---------- Informes de configuración ----------
const hoyLocal = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

function tablaGrupo(titulo, filas, etiqueta = x => x) {
  return `<div class="grupo-inf"><h3>${titulo}</h3><table><thead><tr><th></th><th class="num">Veces</th><th class="num">Uds.</th><th class="num">Importe</th></tr></thead><tbody>
    ${filas.map(f => `<tr><td>${esc(etiqueta(f.clave))}</td><td class="num">${f.veces}</td><td class="num">${uds(f.unidades)}</td><td class="num">${euros(f.importe)}</td></tr>`).join('')
      || '<tr><td colspan="4" class="vacio">Nada</td></tr>'}
  </tbody></table></div>`;
}

async function pintarBorrados(desde = E.infDesde ?? hoyLocal(), hasta = E.infHasta ?? hoyLocal()) {
  E.infDesde = desde; E.infHasta = hasta;
  const r = await api('GET', `/informes/borrados?desde=${desde}&hasta=${hasta}`);
  const t = r.totales;
  $('#vista').innerHTML = `<div class="informe scroll">
    ${cabeceraConfig('Informe de borrados')}
    <div class="filtros">
      <label>Desde <input type="date" id="f-desde" value="${desde}"></label>
      <label>Hasta <input type="date" id="f-hasta" value="${hasta}"></label>
      <button data-rango="hoy">Hoy</button><button data-rango="7">7 días</button><button data-rango="30">30 días</button>
    </div>
    <div class="cifras">
      <div class="cifra"><small>Importe borrado</small><b>${euros(t.importe)}</b></div>
      <div class="cifra"><small>Líneas borradas</small><b>${t.lineas}</b></div>
      <div class="cifra"><small>Unidades</small><b>${uds(t.unidades)}</b></div>
      <div class="cifra"><small>Cuentas borradas enteras</small><b>${t.cuentas}</b></div>
    </div>
    <div class="grupos-inf">
      ${tablaGrupo('Por operario', r.por_operario)}
      ${tablaGrupo('Por fecha', r.por_dia, d => d.split('-').reverse().join('/'))}
      ${tablaGrupo('Por hora', r.por_hora, h => `${h}:00 a ${h}:59`)}
      ${tablaGrupo('Por familia', r.por_familia)}
      ${tablaGrupo('Por artículo', r.por_articulo)}
    </div>
    <h3>Detalle</h3>
    <section class="panel"><table><thead><tr><th>Fecha y hora</th><th>Operario</th><th>Cuenta</th><th>Tipo</th><th>Artículo</th><th class="num">Uds.</th><th class="num">Importe</th></tr></thead><tbody>
      ${r.detalle.map(b => `<tr><td>${esc(b.fecha.slice(8, 10) + '/' + b.fecha.slice(5, 7) + ' ' + b.fecha.slice(11, 16))}</td><td>${esc(b.operario || 'Sin operario')}</td>
        <td>${esc(b.cuenta)}</td><td>${b.tipo === 'cuenta' ? 'Borrar todo' : 'Línea'}</td><td>${esc(b.descripcion)}</td>
        <td class="num">${uds(b.unidades)}</td><td class="num">${euros(b.importe)}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">No se ha borrado nada en estas fechas</td></tr>'}
    </tbody></table></section>
  </div>`;
  $('#vista').onchange = e => { if (e.target.type === 'date') intentar(() => pintarBorrados($('#f-desde').value, $('#f-hasta').value)); };
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.closest('[data-volver]')) return ir('config');
    const b = e.target.closest('[data-rango]');
    if (!b) return;
    const hoy = hoyLocal();
    if (b.dataset.rango === 'hoy') return pintarBorrados(hoy, hoy);
    const d = new Date(Date.now() - (Number(b.dataset.rango) - 1) * 86400000);
    return pintarBorrados(new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10), hoy);
  });
}

async function pintarRegistro(fecha = E.regFecha ?? hoyLocal(), q = E.regTexto ?? '', nivel = E.regNivel ?? '') {
  E.regFecha = fecha; E.regTexto = q; E.regNivel = nivel;
  const filas = await api('GET', `/registro?fecha=${fecha}&q=${encodeURIComponent(q)}&nivel=${nivel}`);
  $('#vista').innerHTML = `<div class="informe scroll">
    ${cabeceraConfig('Registro de actividad')}
    <div class="filtros">
      <label>Día <input type="date" id="r-fecha" value="${fecha}"></label>
      <label>Buscar <input id="r-texto" value="${esc(q)}" placeholder="cobrar, borrar, mesa..."></label>
      <label>Tipo <select id="r-nivel">${[['', 'Todo'], ['info', 'Acciones'], ['aviso', 'Avisos'], ['error', 'Errores']]
        .map(([v, t]) => `<option value="${v}" ${v === nivel ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <p class="nota">También se guarda un fichero por día en la carpeta <b>datos\\registro</b> del TPV.</p>
    <section class="panel"><table><thead><tr><th>Hora</th><th>Tipo</th><th>Acción</th><th>Desde</th><th>Datos</th></tr></thead><tbody>
      ${filas.map(f => `<tr class="nivel-${esc(f.nivel)}"><td>${esc(f.fecha.slice(11, 19))}</td><td>${f.nivel === 'info' ? 'Acción' : f.nivel === 'aviso' ? 'Aviso' : 'Error'}</td>
        <td>${esc(f.accion)}<br><small>${esc(f.metodo)} ${esc(f.ruta)}</small></td><td>${esc(f.origen)}</td><td class="datos">${esc(f.datos)}</td></tr>`).join('')
        || '<tr><td colspan="5" class="vacio">Sin actividad ese día</td></tr>'}
    </tbody></table></section>
  </div>`;
  const recargar = () => intentar(() => pintarRegistro($('#r-fecha').value, $('#r-texto').value, $('#r-nivel').value));
  $('#vista').onchange = e => { if (e.target.id !== 'r-texto') recargar(); };
  $('#r-texto').onkeydown = e => { if (e.key === 'Enter') recargar(); };
  $('#vista').onclick = e => { if (e.target.closest('[data-volver]')) ir('config'); };
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
      if (tipo === 'gestion' || tipo === 'empresa' || tipo === 'aspecto') await cargarDatos();
      if (!['venta', 'mesas', 'abiertas'].includes(E.vista)) await cargarAbiertas();
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
  try { E.operario = JSON.parse(sessionStorage.getItem('operario') || 'null'); } catch {}
  await cargarDatos();
  await ir('venta');
  conectarEventos();
  if (!E.operario && puestoPideOperario()) mostrarPanelOperarios();
});
