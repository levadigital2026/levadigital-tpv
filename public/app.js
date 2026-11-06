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
  $('#modal-caja').classList.remove('ancho', 'a4');
  if (E.pedirTrasModal) { E.pedirTrasModal = false; setTimeout(mostrarPanelOperarios, 0); }
  if (E.alCerrarModal) { const f = E.alCerrarModal; E.alCerrarModal = null; setTimeout(() => intentar(f), 0); }
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
    if (def[2] === 'lado') raiz.dataset.mano = a[k];
    else if (COLORES_ASPECTO[k]) raiz.style.setProperty(COLORES_ASPECTO[k], a[k]);
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
const VISTAS = { venta: pintarVenta, mesas: pintarMesas, tickets: pintarTickets, caja: pintarCaja, gestion: () => pintarGestion(), config: pintarConfig, abiertas: pintarAbiertas, empresa: pintarEmpresa, borrados: pintarBorrados, registro: pintarRegistro, aspecto: pintarAspecto, empleados: pintarEmpleados, cierres: pintarCierres, clientes: () => pintarClientes(), stocks: () => pintarStocks(), modulos: pintarModulos, diseno: () => pintarDiseno() };
// Pantallas que cuelgan de Configuración (el botón de herramientas del menú queda marcado).
const VISTAS_CONFIG = new Set(['config', 'gestion', 'empresa', 'borrados', 'registro', 'aspecto', 'empleados', 'cierres', 'modulos', 'diseno']);
// Menús de arriba: en un puesto con permisos, cada uno se ve solo si el operario tiene su permiso.
const PERMISO_MENU = { mesas: 'menu_mesas', tickets: 'menu_tickets', caja: 'menu_caja', abiertas: 'menu_abiertas', clientes: 'menu_clientes', stocks: 'menu_stocks', config: 'configuracion' };
function pintarMenu() {
  if (!E.datos) return;
  document.querySelectorAll('#menu button[data-vista]').forEach(b => {
    const p = PERMISO_MENU[b.dataset.vista];
    b.classList.toggle('oculto', !!p && !tienePermiso(p));
  });
  // Si la pantalla abierta ya no está permitida para este operario, se vuelve a Venta.
  const actual = VISTAS_CONFIG.has(E.vista) ? 'config' : E.vista;
  if (PERMISO_MENU[actual] && !tienePermiso(PERMISO_MENU[actual])) { E.cuenta = null; intentar(() => ir('venta')); }
}
function ir(vista) {
  E.vista = vista;
  // Los manejadores de una pantalla no deben seguir activos en otra.
  const v = $('#vista'); v.onpointerdown = v.onchange = v.oninput = null;
  const marcada = VISTAS_CONFIG.has(vista) ? 'config' : vista;
  document.querySelectorAll('#menu button').forEach(b => b.classList.toggle('activo', b.dataset.vista === marcada));
  return VISTAS[vista]();
}
$('#menu').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.vista === 'config') {
    if (!tienePermiso('configuracion')) return aviso('Tu operario no tiene permiso para entrar en configuración', true);
    E.seccionConfig = null;
  }
  if (PERMISO_MENU[b.dataset.vista] && !tienePermiso(PERMISO_MENU[b.dataset.vista])) return aviso('Tu operario no tiene permiso para este menú', true);
  E.volverA = null;
  E.modoMesas = null;
  if (E.vista === 'venta') comandaAutomatica(E.cuenta);
  // "Venta" siempre empieza limpia: lo de las mesas ya está guardado y se abre desde Mesas.
  if (b.dataset.vista === 'venta') { E.cuenta = null; E.lineaSel = null; E.calc = ''; }
  if (b.dataset.vista === 'clientes') { E.eligiendoCliente = false; E.fichaCliente = null; E.volverCobro = false; }
  if (b.dataset.vista === 'stocks') E.tabStocks = E.tabStocks === 'nuevo_albaran' ? 'nuevo_albaran' : 'existencias';
  intentar(() => ir(b.dataset.vista));
});

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
        <div><b>${esc(nombreCuenta(c))}</b><small>${c ? `${c.comensales ? c.comensales + ' comensales · ' : ''}abierta ${hora(c.abierta_en)}` : 'Toca un artículo para empezar'}</small>
          ${c?.cliente ? `<small class="cliente-cuenta" data-accion="cliente">👤 ${esc(c.cliente.nombre)}${c.cliente.nif ? ' · ' + esc(c.cliente.nif) : ''}</small>` : ''}</div>
        <button id="b-teclado" title="Mostrar u ocultar la calculadora" class="${E.verTeclado ? 'activo' : ''}">123</button>
      </div>
      <div class="lineas">
        ${c && c.lineas.length ? c.lineas.map(l => `
          <div class="linea-caja">
            <button class="linea-anular" data-anular="${l.id}">Anular</button>
            <div class="linea ${l.id === E.lineaSel ? 'sel' : ''}" data-linea="${l.id}">
              <span class="uds">${l.por_peso ? uds(l.unidades) + '<small>kg</small>' : uds(l.unidades)}</span><span>${esc(l.descripcion)}${l.por_peso ? `<small class="peso-linea">${euros(l.precio)}/kg</small>` : ''}</span><span>${l.invitacion ? '<b class="invitacion">Invitación</b>' : euros(Math.round(l.unidades * l.precio))}</span>
              ${l.detalle ? `<span class="det" title="Texto de la comanda">✎ ${esc(l.detalle)}</span>` : ''}
              ${l.orden_plato_id ? `<span class="op-plato">${esc(E.datos.ordenes_plato.find(o => o.id === l.orden_plato_id)?.nombre ?? '')}</span>` : ''}
            </div>
          </div>`).join('') : '<div class="vacio">Sin artículos</div>'}
      </div>
      <div class="total"><span>Total${c?.lineas.length ? ` · ${uds(c.lineas.reduce((n, l) => n + l.unidades, 0))} uds.` : ''}</span><span>${euros(c?.total ?? 0)}</span></div>
      <div class="teclado">
        <div class="pantalla" id="calc">${esc(E.calc)}</div>
        ${['7', '8', '9', 'C', '4', '5', '6', 'Un', '1', '2', '3', '€', '0', ',', '00', '⌫'].map(k =>
          `<button data-tecla="${k}">${k}</button>`).join('')}
      </div>
    </section>
    <section class="panel familias">
      ${columnaFamilias()}
    </section>
    <section class="panel articulos">
      ${arts.length ? '' : subfamilias.map(f => botonArticulo(f, f.color, 'Subfamilia', `data-familia="${f.id}"`)).join('')}
      ${arts.map(a => botonArticulo(a, colorDe(a.familia_id), euros(a.precio) + (a.por_peso ? '/kg' : ''))).join('')}
      ${!arts.length && !subfamilias.length ? `<div class="vacio">${famActual ? 'Esta familia no tiene artículos' : 'No hay familias'}</div>` : ''}
    </section>
    <section class="panel mando">
      <div class="acciones">
        ${E.datos.botones.filter(b => b.visible && b.accion !== 'configuracion').map(b => `<button data-accion="${esc(b.accion)}" data-id="${b.id}" ${b.color ? 'class="color"' : ''}
          style="${estiloAccion(b)}" ${accionActiva(b.accion, c) ? '' : 'disabled'} title="${esc(b.texto)}">${esc(b.texto)}</button>`).join('')}
      </div>
      <button class="cobrar" id="b-cobrar" ${c?.lineas.length ? '' : 'disabled'}><small>COBRAR</small><b>${euros(c?.total ?? 0)}</b></button>
      <div class="mando-pie">
        <button id="b-cajon" title="Abre el cajón de la impresora de tickets de este puesto">Abrir cajón</button>
        <button id="b-salir" title="Cierra el TPV en esta pantalla">Salir</button>
      </div>
    </section>
  </div>`;
}

// Cada botón de la botonera puede ocupar varias columnas (ancho) y filas (alto).
const columnasBotonera = () => Math.max(1, Math.min(6, Number(E.datos.aspecto?.botonera_cols) || 2));
function estiloAccion(b, cols = columnasBotonera()) {
  return `${b.color ? `--bc:${esc(b.color)};` : ''}grid-column:span ${Math.min(b.ancho || 1, cols)};grid-row:span ${b.alto || 1}`;
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
$('.menu-config').innerHTML = ICONO_HERRAMIENTAS;

// Botonera configurable: qué hace cada acción y cuándo está disponible.
function accionActiva(accion, c) {
  const conLineas = !!c?.lineas?.length;
  switch (accion) {
    case 'guardar': case 'comensales': case 'nombre': return !!c;
    case 'borrar_todo': case 'marchar': case 'cliente': return !!c;
    case 'orden_plato': case 'comanda': return conLineas;
    case 'preticket': case 'efectivo_exacto': case 'tarjeta': return conLineas;
    case 'borrar_linea': case 'detalle': case 'invitacion': return conLineas && !!E.lineaSel;
    case 'dividir': return conLineas;
    case 'traspasar': return true;
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
  await trasCobro(ticket, opcionesCobro());
  return pintarVenta();
}

async function accion(a) {
  const c = E.cuenta;
  switch (a) {
    case 'guardar': return guardarCuenta();
    case 'preticket': return verPreticket();
    case 'nueva': comandaAutomatica(c); E.cuenta = null; E.lineaSel = null; return pintarVenta();
    case 'mesas': comandaAutomatica(c); return ir('mesas');
    case 'configuracion':
      if (!tienePermiso('configuracion')) return aviso('Tu operario no tiene permiso para entrar en configuración', true);
      return ir('config');
    case 'orden_plato': return elegirOrdenPlato();
    case 'cliente': return elegirClienteCuenta();
    case 'traspasar':
      if (!c?.lineas?.length) { E.modoMesas = 'traspasar'; aviso('Toca la mesa que quieres traspasar'); return ir('mesas'); }
      return abrirTraspaso(c.id);
    case 'dividir': return abrirDividir(c.id);
    case 'invitacion': return invitarLinea(E.lineaSel);
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
      // Con permiso, unas flechas dejan ir a los tickets anteriores.
      const nav = tienePermiso('tickets_anteriores') ? { ids: lista.map(x => x.id), i: 0 } : null;
      return verTicket(await api('GET', `/tickets/${lista[0].id}`), nav);
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
  // En barra se pide un nombre (no obligatorio) y se puede pasar a una mesa libre.
  if (!c.mesa_id && c.lineas.length) {
    abrirModal(`<h2><span>Guardar cuenta</span><button data-m="cerrar">✕</button></h2>
      <form class="form guardar-cuenta">
        <label>Nombre para encontrar la cuenta (no es obligatorio)<input name="nombre" value="${esc(c.nombre ?? '')}" placeholder="barba, esquina, gorra roja..." autocomplete="off"></label>
        <div class="botones-guardar">
          <button type="submit" class="primario">Guardar cuenta</button>
          <button type="button" data-m="mesa">Traspasar a mesa</button>
          <button type="button" data-m="cerrar">Cancelar</button>
        </div>
      </form>`);
    setTimeout(() => $('#modal-caja [name=nombre]')?.focus(), 30);
    const nombre = async () => { const n = $('#modal-caja [name=nombre]').value.trim(); if (n !== (c.nombre ?? '')) await api('PATCH', `/cuentas/${c.id}`, { nombre: n }); };
    $('#modal-caja form').onsubmit = ev => { ev.preventDefault(); intentar(async () => { await nombre(); cerrarModal(); return cuentaGuardada(c); }); };
    $('#modal-caja').onclick = ev => intentar(async () => {
      const b = ev.target.closest('button');
      if (b?.dataset.m === 'cerrar') return cerrarModal();
      if (b?.dataset.m === 'mesa') {
        await nombre();
        cerrarModal();
        E.modoMesas = 'destino'; E.traspasoOrigen = c.id;
        E.cuenta = null; E.lineaSel = null;
        if (!E.datos.zonas.some(z => z.id === E.zonaMesas && z.tipo === 'mesas')) E.zonaMesas = E.datos.zonas.find(z => z.tipo === 'mesas')?.id;
        return ir('mesas');
      }
    });
    return;
  }
  return cuentaGuardada(c);
}
function cuentaGuardada(c) {
  E.cuenta = null;
  E.lineaSel = null;
  aviso('Cuenta guardada');
  comandaAutomatica(c);
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
    // En la botonera, la pulsación larga abre la edición del botón (color, tamaño, posición).
    if (orden.tabla === 'botones') {
      const id = Number(orden.id(orden.item));
      boton.classList.remove('cargando-orden');
      orden = null;
      E.sinClic = Date.now() + 400;
      navigator.vibrate?.(60);
      if (!tienePermiso('configuracion')) return aviso('No tienes permiso para cambiar la botonera', true);
      return editarBoton(id);
    }
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
    const art = E.datos.articulos.find(a => a.id === Number(b.dataset.articulo));
    if (art?.por_peso) {
      const kg = numeroCalc() || await pedirPeso(art);
      if (!kg) return;
      const cuenta = await asegurarCuenta();
      E.cuenta = await api('POST', `/cuentas/${cuenta.id}/lineas`, { articulo_id: art.id, unidades: kg });
      E.calc = '';
      E.lineaSel = E.cuenta.lineas.at(-1)?.id ?? null;
      return pintarVenta();
    }
    const cuenta = await asegurarCuenta();
    const n = numeroCalc();
    E.cuenta = await api('POST', `/cuentas/${cuenta.id}/lineas`, { articulo_id: Number(b.dataset.articulo), unidades: n && n > 0 ? n : 1 });
    E.calc = '';
    E.lineaSel = E.cuenta.lineas.at(-1)?.id ?? null;
    return pintarVenta();
  }
  if (b.dataset.cuenta) { if (E.cuenta?.id !== Number(b.dataset.cuenta)) comandaAutomatica(E.cuenta); E.cuenta = { id: Number(b.dataset.cuenta) }; E.lineaSel = null; return pintarVenta(); }
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
  if (b.id === 'b-cajon') {
    const r = await api('POST', '/cajon');
    return aviso(`Cajón abierto (${r.impresora})`);
  }
  if (b.id === 'b-salir') return salirTPV();
}));

// ---------- Editar la botonera desde la pantalla de venta ----------
const COLORES_BOTON = ['#0064fc', '#00a3e0', '#2e9d4f', '#7cb342', '#f5a300', '#ef6c00', '#e53935', '#c2185b', '#7b1fa2', '#5d4037', '#546e7a', '#0b1527'];
function editarBoton(id) {
  const lista = () => E.datos.botones.filter(x => x.accion !== 'configuracion');
  const paso = (k, v, max) => `<div class="paso"><button data-paso="${k}" data-d="-1" ${v <= 1 ? 'disabled' : ''}>−</button><b>${v}</b><button data-paso="${k}" data-d="1" ${v >= max ? 'disabled' : ''}>+</button></div>`;
  const guardar = async cambios => {
    await api('PUT', `/gestion/botones/${id}`, cambios);
    await cargarDatos();
    pintarVenta();
    pintar();
  };
  const mover = async d => {
    const vis = lista().filter(x => x.visible).map(x => x.id);
    const i = vis.indexOf(id), j = i + d;
    if (i < 0 || j < 0 || j >= vis.length) return;
    const ids = E.datos.botones.map(x => x.id);
    const a = ids.indexOf(vis[i]), b = ids.indexOf(vis[j]);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    await api('POST', '/gestion/botones/ordenar', { ids });
    await cargarDatos();
    pintarVenta();
    pintar();
  };
  const pintar = () => {
    const b = E.datos.botones.find(x => x.id === id);
    if (!b) return cerrarModal();
    const n = columnasBotonera();
    const visibles = lista().filter(x => x.visible);
    const ocultos = lista().filter(x => !x.visible);
    abrirModal(`<h2><span>Editar botón</span><button data-m="cerrar">✕</button></h2>
      <div class="editar-boton">
        <div class="eb-opciones">
          <label class="eb-texto">Texto<input id="eb-texto" value="${esc(b.texto)}" maxlength="30"></label>
          <div class="eb-fila"><span>Color</span><div class="eb-colores">
            <button data-color="" class="normal ${!b.color ? 'activo' : ''}">Normal</button>
            ${COLORES_BOTON.map(c => `<button data-color="${c}" style="--mc:${c}" class="${b.color === c ? 'activo' : ''}"></button>`).join('')}
            <button data-m="otro" class="otro ${b.color && !COLORES_BOTON.includes(b.color) ? 'activo' : ''}" ${b.color && !COLORES_BOTON.includes(b.color) ? `style="--mc:${esc(b.color)}"` : ''}>Otro…</button></div></div>
          <div class="eb-fila"><span>Ancho</span>${paso('ancho', Math.min(b.ancho || 1, n), n)}<small>columnas</small></div>
          <div class="eb-fila"><span>Alto</span>${paso('alto', b.alto || 1, 4)}<small>filas</small></div>
          <div class="eb-fila"><span>Posición</span><div class="eb-mover"><button data-mover="-1">◀ Antes</button><button data-mover="1">Después ▶</button></div></div>
          <div class="eb-fila"><span>Botones por fila</span>${paso('cols', n, 6)}<small>en toda la botonera</small></div>
          <div class="eb-fila">${b.visible ? '<button data-m="ocultar" class="peligro">Quitar de la botonera</button>' : '<button data-m="mostrar" class="primario">Poner en la botonera</button>'}</div>
          ${ocultos.length ? `<div class="eb-fila eb-ocultos"><span>Quitados</span><div>${ocultos.map(o => `<button data-editar="${o.id}" class="${o.id === id ? 'activo' : ''}">${esc(o.texto)}</button>`).join('')}</div></div>` : ''}
        </div>
        <div class="eb-vista">
          <small>Así queda la botonera. Toca otro botón para editarlo.</small>
          <div class="acciones eb-previa" style="--a-botonera_cols:${n}">${visibles.map(x => `<button data-editar="${x.id}" class="${x.color ? 'color' : ''} ${x.id === id ? 'editando' : ''}" style="${estiloAccion(x, n)}">${esc(x.texto)}</button>`).join('')}</div>
          <div class="eb-pie"><button data-m="cerrar" class="primario">Listo</button></div>
        </div>
      </div>`);
    $('#modal-caja').classList.add('ancho');
    $('#modal-caja').onchange = e => { if (e.target.id === 'eb-texto' && e.target.value.trim()) intentar(() => guardar({ texto: e.target.value.trim() })); };
    $('#modal-caja').onclick = e => intentar(async () => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.m === 'cerrar') return cerrarModal();
      if (t.dataset.editar) { id = Number(t.dataset.editar); return pintar(); }
      if (t.dataset.color !== undefined) return guardar({ color: t.dataset.color });
      if (t.dataset.m === 'otro') {
        const c = await elegirColor(b.color, false);
        return c === null ? pintar() : guardar({ color: c });
      }
      if (t.dataset.paso === 'ancho') return guardar({ ancho: Math.min(b.ancho || 1, n) + Number(t.dataset.d) });
      if (t.dataset.paso === 'alto') return guardar({ alto: (b.alto || 1) + Number(t.dataset.d) });
      if (t.dataset.paso === 'cols') {
        E.datos.aspecto = await api('PUT', '/aspecto', { ...E.datos.aspecto, botonera_cols: n + Number(t.dataset.d) });
        aplicarAspecto(E.datos.aspecto);
        pintarVenta();
        return pintar();
      }
      if (t.dataset.mover) return mover(Number(t.dataset.mover));
      if (t.dataset.m === 'ocultar') return guardar({ visible: 0 });
      if (t.dataset.m === 'mostrar') return guardar({ visible: 1 });
    });
  };
  pintar();
}

// ---------- Salir ----------
async function salirTPV() {
  if (!confirm('¿Salir del TPV en esta pantalla?')) return;
  E.sinPantallaCompleta = true;
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  ponerOperario(null);
  window.close();
  // Si el navegador no deja cerrar la ventana, se queda una pantalla de "cerrado".
  setTimeout(() => {
    document.body.innerHTML = `<div class="tpv-cerrado"><img src="/icono-192.png" alt=""><h1>TPV cerrado</h1>
      <p>Ya puedes cerrar esta ventana.</p><button id="b-volver">Volver a entrar</button></div>`;
    document.getElementById('b-volver').onclick = () => location.reload();
  }, 300);
}

// ---------- Pantalla completa ----------
// Al primer toque se pone en pantalla completa (el navegador no deja hacerlo sin un toque).
// Mantener pulsado 3 segundos el logo la quita (y vuelve a ponerla). Se puede desactivar
// en Configuración > Tamaño en esta pantalla.
const pantallaCompletaActiva = () => { try { return localStorage.getItem('pantallaCompleta') !== '0'; } catch { return true; } };
function entrarPantallaCompleta() {
  if (E.sinPantallaCompleta || !pantallaCompletaActiva() || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
document.addEventListener('click', entrarPantallaCompleta, true);
document.addEventListener('keydown', entrarPantallaCompleta, true);
{
  const logo = $('.marca');
  let t = null;
  const parar = () => { clearTimeout(t); t = null; logo.classList.remove('cargando-orden'); };
  logo.addEventListener('pointerdown', () => {
    parar();
    logo.classList.add('cargando-orden');
    t = setTimeout(() => {
      logo.classList.remove('cargando-orden');
      navigator.vibrate?.(60);
      if (document.fullscreenElement) {
        E.sinPantallaCompleta = true;
        document.exitFullscreen().catch(() => {});
        aviso('Pantalla completa quitada. Mantén pulsado el logo 3 segundos para volver.');
      } else {
        // Al soltar el dedo (que cuenta como toque) vuelve a pantalla completa.
        E.sinPantallaCompleta = false;
        try { localStorage.setItem('pantallaCompleta', '1'); } catch {}
        aviso('Suelta para volver a pantalla completa');
      }
    }, PULSACION_ORDENAR_MS);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => logo.addEventListener(ev, () => { if (t) parar(); }));
  logo.addEventListener('contextmenu', e => e.preventDefault());
}

// ---------- Cobro ----------
// Cobro con varios pagos: se van añadiendo importes en distintas formas de pago hasta cubrir el total.
// Solo el efectivo puede pasar de lo que falta (da cambio).
const leerOpcionesCobro = () => { try { return JSON.parse(localStorage.getItem('opcionesCobro') || '{}'); } catch { return {}; } };
function opcionesCobro() {
  const o = leerOpcionesCobro();
  return { noImprimir: !!o.noImprimir, a4: !!o.a4, email: false };
}
// opc.partes: dividir el total entre N personas (N pagos). opc.alCancelar / opc.despues: para Dividir cuenta.
function abrirCobro(opc = {}) {
  const c = E.cuenta;
  const partes = opc.partes > 1 ? opc.partes : 0;
  const porDefecto = () => { const p = pendiente(); if (!partes) return p; const quedan = partes - pagos.length; return quedan <= 1 ? p : Math.min(p, Math.floor(c.total / partes)); };
  let entrada = '';
  const pagos = [];
  const guardadas = leerOpcionesCobro();
  const op = { noImprimir: !!guardadas.noImprimir, a4: !!guardadas.a4, email: !!guardadas.email && !!c.cliente?.email, para: c.cliente?.email || '' };
  const formas = E.datos.formas_cobro.filter(f => f.activa);
  const cent = () => entrada ? Math.round(Number(entrada.replace(',', '.')) * 100) : 0;
  const cobradoHasta = () => { let falta = c.total; for (const p of pagos) falta -= Math.min(p.importe, Math.max(falta, 0)); return c.total - Math.max(falta, 0); };
  const pendiente = () => c.total - cobradoHasta();
  const cambio = () => pagos.reduce((n, p) => n + p.importe, 0) - c.total;
  const pintar = () => {
    const pend = pendiente();
    abrirModal(`
      <h2><span>Cobrar ${esc(nombreCuenta(c))}</span><button data-m="cerrar">✕</button></h2>
      <div class="cobro">
        <div class="cobro-cifras">
          <div class="cc"><small>Total</small><b>${euros(c.total)}</b></div>
          <div class="cc"><small>Cobrado</small><b>${euros(cobradoHasta())}</b></div>
          <div class="cc pendiente ${pend ? '' : 'hecho'}"><small>${pend ? 'Falta por cobrar' : 'Cambio'}</small><b>${pend ? euros(pend) : euros(Math.max(cambio(), 0))}</b></div>
          <div class="cc"><small>${partes && pend ? `Pago ${Math.min(pagos.length + 1, partes)} de ${partes}` : 'Importe a añadir'}</small><b>${entrada ? euros(cent()) : '<span class="tenue">' + euros(pend ? porDefecto() : 0) + '</span>'}</b></div>
          ${partes ? `<div class="cc partes"><small>Entre ${partes} personas</small><b>${euros(Math.floor(c.total / partes))}</b><small>cada una${c.total % partes ? ' (la última paga los céntimos que sobran)' : ''}</small></div>` : ''}
          <div class="pagos-lista">${pagos.length ? pagos.map((p, i) => `<div><span>${esc(p.nombre)}</span><b>${euros(p.importe)}</b><button data-quitar="${i}" title="Quitar este pago">✕</button></div>`).join('')
            : '<small class="tenue">Teclea un importe y toca la forma de pago. Sin importe se cobra lo que falta.</small>'}</div>
        </div>
        <div>
          <div class="billetes">${[5, 10, 20, 50].map(b => `<button data-billete="${b}">${b} €</button>`).join('')}</div>
          <div class="teclado" style="margin-top:6px">
            ${['7', '8', '9', 'C', '4', '5', '6', '⌫', '1', '2', '3', '', '0', ',', '00', ''].map(k => k ? `<button data-ct="${k}">${k}</button>` : '<span></span>').join('')}
          </div>
        </div>
        <div class="formas" style="grid-column:1/-1">
          ${formas.map(f => `<button data-forma="${f.id}" class="${f.tipo === 'efectivo' ? 'efectivo' : ''}">${esc(f.nombre)}</button>`).join('')}
        </div>
        <div class="opciones-cobro" style="grid-column:1/-1">
          ${moduloActivo('clientes') ? `<button data-m="cliente" class="cliente-cobro">👤 ${c.cliente ? esc(c.cliente.nombre) + (c.cliente.nif ? ' · ' + esc(c.cliente.nif) : '') : 'Asignar cliente'}</button>` : ''}
          <label><input type="checkbox" data-op="noImprimir" ${op.noImprimir ? 'checked' : ''}> No imprimir</label>
          <label><input type="checkbox" data-op="a4" ${op.a4 ? 'checked' : ''}> Imprimir en A4</label>
          <label><input type="checkbox" data-op="email" ${op.email ? 'checked' : ''}> Enviar por email</label>
          <input type="email" data-para placeholder="correo@cliente.es" value="${esc(op.para)}" class="${op.email ? '' : 'oculto'}">
        </div>
      </div>`);
  };
  const guardarOp = () => { try { localStorage.setItem('opcionesCobro', JSON.stringify({ noImprimir: op.noImprimir, a4: op.a4, email: op.email })); } catch { } };
  const terminar = async () => {
    if (op.email && !op.para.trim()) { pagos.pop(); pintar(); return aviso('Escribe el correo al que se envía el ticket', true); }
    try {
      await comandaAutomatica(c);
      const ticket = await api('POST', `/cuentas/${c.id}/cobrar`, { pagos: pagos.map(p => ({ forma_cobro_id: p.forma_cobro_id, importe: p.importe })) });
      E.cuenta = null;
      E.lineaSel = null;
      cerrarModal();
      await trasCobro(ticket, op);
      await pintarVenta();
      if (opc.despues) { if ($('#modal').classList.contains('oculto')) await opc.despues(); else E.alCerrarModal = opc.despues; }
    } catch (e) { pagos.pop(); pintar(); throw e; }
  };
  pintar();
  $('#modal-caja').onchange = e => {
    const k = e.target.dataset.op;
    if (k) { op[k] = e.target.checked; guardarOp(); if (k === 'email') $('[data-para]').classList.toggle('oculto', !op.email); }
  };
  $('#modal-caja').oninput = e => { if (e.target.matches('[data-para]')) op.para = e.target.value; };
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.m === 'cerrar') { cerrarModal(); return opc.alCancelar?.(); }
    if (b.dataset.m === 'cliente') { cerrarModal(); E.volverCobro = true; return elegirClienteCuenta(); }
    if (b.dataset.quitar !== undefined) { pagos.splice(Number(b.dataset.quitar), 1); return pintar(); }
    if (b.dataset.billete) { entrada = b.dataset.billete; return pintar(); }
    if (b.dataset.ct) {
      const k = b.dataset.ct;
      if (k === 'C') entrada = '';
      else if (k === '⌫') entrada = entrada.slice(0, -1);
      else if (k === ',') { if (!entrada.includes(',')) entrada = (entrada || '0') + ','; }
      else if (entrada.length < 8 && !/,\d\d$/.test(entrada)) entrada += k;
      return pintar();
    }
    if (b.dataset.forma) {
      const f = formas.find(x => x.id === Number(b.dataset.forma));
      const pend = pendiente();
      if (pend <= 0) return terminar();
      const importe = entrada ? cent() : porDefecto();
      if (!(importe > 0)) return aviso('Importe no válido', true);
      if (importe > pend && f.tipo !== 'efectivo') return aviso(`Con ${f.nombre} no se puede cobrar más de lo que falta (${euros(pend)})`, true);
      pagos.push({ forma_cobro_id: f.id, nombre: f.nombre, tipo: f.tipo, importe });
      entrada = '';
      if (pendiente() <= 0) return terminar();
      return pintar();
    }
  });
}

// Qué pasa al terminar de cobrar: ticket en pantalla, A4, sin imprimir y/o por correo.
async function trasCobro(ticket, op = {}) {
  if (op.email && op.para) {
    api('POST', `/tickets/${ticket.id}/email`, { para: op.para.trim() })
      .then(() => aviso(`Ticket enviado a ${op.para.trim()}`)).catch(e => aviso('No se pudo enviar el correo: ' + e.message, true));
  }
  const cambio = ticket.cambio ? ` · Cambio ${euros(ticket.cambio)}` : '';
  if (op.noImprimir) aviso(`Cobrado ${ticket.serie}-${ticket.numero}${cambio}`);
  else if (op.a4) verDocumentoA4(ticket, 'Factura simplificada', `/tickets/${ticket.id}/email`);
  else verTicket(ticket);
  trasOperacion();
}

// ---------- Tickets ----------
function htmlTicket(t, titulo) {
  const e = t.empresa, cl = t.cliente;
  const pagos = t.pagos?.length > 1 ? t.pagos : null;
  return `<div class="ticket">
    <div class="c"><b>${esc(e.nombre)}</b><br>${esc(e.direccion)}${e.localidad ? '<br>' + esc(e.localidad) : ''}${e.nif ? '<br>NIF ' + esc(e.nif) : ''}</div><hr>
    <div class="c">${esc(titulo)}</div>
    <div>${esc(t.serie)}-${t.numero} · ${hora(t.emitido_en)}</div>
    ${t.mesa_nombre ? `<div>${esc(t.zona_nombre)} · ${esc(t.mesa_nombre)}</div>` : ''}
    ${cl ? `<hr><div>Cliente: ${esc(cl.nombre)}</div>${cl.nif ? `<div>NIF: ${esc(cl.nif)}</div>` : ''}${cl.domicilio ? `<div>${esc(cl.domicilio)}</div>` : ''}${cl.localidad || cl.cp ? `<div>${esc([cl.cp, cl.localidad].filter(Boolean).join(' '))}</div>` : ''}` : ''}<hr>
    ${t.lineas.map(l => `<div class="fila"><span>${l.por_peso ? uds(l.unidades) + ' kg' : uds(l.unidades)} ${esc(l.descripcion)}</span><span>${l.invitacion ? 'Invitación' : euros(l.importe)}</span></div>${l.por_peso ? `<div class="alerg-ticket">${uds(l.unidades)} kg x ${euros(l.precio)}/kg</div>` : ''}${l.alergenos ? `<div class="alerg-ticket">Alérgenos: ${esc(l.alergenos)}</div>` : ''}`).join('')}<hr>
    <div class="fila grande"><span>TOTAL</span><span>${euros(t.total)}</span></div>
    ${t.impuestos.map(i => `<div class="fila"><span>Base ${i.iva}%: ${euros(i.base)}</span><span>IVA ${euros(i.cuota)}</span></div>`).join('')}<hr>
    ${pagos ? pagos.map(p => `<div class="fila"><span>${esc(p.nombre)}</span><span>${euros(p.entregado || p.importe)}</span></div>`).join('')
      : `<div class="fila"><span>${esc(t.forma_cobro)}</span><span>${euros(t.entregado)}</span></div>`}
    ${t.cambio ? `<div class="fila"><span>Cambio</span><span>${euros(t.cambio)}</span></div>` : ''}
    ${t.anula_ticket_id ? '<div class="c"><b>TICKET DE ANULACIÓN</b></div>' : ''}
    ${t.factura ? `<div class="c">Incluido en la factura ${esc(t.factura.serie)}-${t.factura.numero}</div>` : ''}
    <div class="c" style="margin-top:8px">Gracias por su visita</div>
  </div>`;
}

function verTicket(t, nav = null) {
  const flechas = nav && nav.ids.length > 1 ? `<span class="nav-ticket">
      <button data-m="anterior" title="Ticket anterior" ${nav.i >= nav.ids.length - 1 ? 'disabled' : ''}>◀</button>
      <small>${nav.i === 0 ? 'Último' : `${nav.i + 1} de ${nav.ids.length}`}</small>
      <button data-m="siguiente" title="Ticket siguiente" ${nav.i <= 0 ? 'disabled' : ''}>▶</button></span>` : '';
  abrirModal(`<h2><span>Ticket ${esc(t.serie)}-${t.numero}</span>${flechas}<button data-m="cerrar">✕</button></h2>
    ${htmlTicket(t, t.anula_ticket_id ? 'ANULACIÓN' : 'FACTURA SIMPLIFICADA')}
    <div class="botones"><button class="primario" data-m="imprimir">Imprimir</button><button data-m="a4">Imprimir A4</button><button data-m="email">Enviar por email</button><button data-m="cerrar">Cerrar</button></div>`);
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (b?.dataset.m === 'cerrar') cerrarModal();
    if (nav && (b?.dataset.m === 'anterior' || b?.dataset.m === 'siguiente')) {
      const i = nav.i + (b.dataset.m === 'anterior' ? 1 : -1);
      if (i < 0 || i >= nav.ids.length) return;
      return verTicket(await api('GET', `/tickets/${nav.ids[i]}`), { ...nav, i });
    }
    if (b?.dataset.m === 'imprimir') window.print();
    if (b?.dataset.m === 'a4') verDocumentoA4(t, 'Factura simplificada', `/tickets/${t.id}/email`);
    if (b?.dataset.m === 'email') return enviarPorEmail(`/tickets/${t.id}/email`, t.cliente?.email);
  });
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
          <button class="primario" id="b-reimprimir">Imprimir</button><button id="b-a4">A4</button><button id="b-email">Email</button>
          ${!t.anula_ticket_id && !t.anulado_por ? '<button class="peligro" id="b-anular">Anular ticket</button>' : ''}
        </div>` : '<div class="vacio">Selecciona un ticket</div>'}
    </section></div>`;
  $('#vista').onclick = e => intentar(async () => {
    const fila = e.target.closest('[data-ticket]');
    if (fila) { E.ticketSel = Number(fila.dataset.ticket); return pintarTickets(); }
    if (e.target.id === 'b-reimprimir') return verTicket(t);
    if (e.target.id === 'b-a4') return verDocumentoA4(t, 'Factura simplificada', `/tickets/${t.id}/email`);
    if (e.target.id === 'b-email') return enviarPorEmail(`/tickets/${t.id}/email`, t.cliente?.email);
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
// Plano de la sala: lienzo de 1000 de ancho; posiciones y tamaños de mesas y objetos en esas unidades.
const SILLA = 16;
function sillasMesa(forma, plazas, w, h) {
  const s = [], c = SILLA, m = 3;
  if (forma === 'redonda') {
    const rx = w / 2 - c / 2, ry = h / 2 - c / 2;
    for (let i = 0; i < plazas; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / plazas; s.push([w / 2 + rx * Math.cos(a), h / 2 + ry * Math.sin(a)]); }
    return s;
  }
  // Rectangular: sillas en los lados largos y, desde 6 plazas, una en cada cabecera. Cuadrada: repartidas en los 4 lados.
  const horizontal = w >= h;
  let lados;
  if (forma === 'cuadrada') { lados = [0, 0, 0, 0]; for (let i = 0; i < plazas; i++) lados[[0, 2, 1, 3][i % 4]]++; }
  else { const cab = plazas >= 6 ? 2 : 0, largo = plazas - cab; lados = horizontal ? [Math.ceil(largo / 2), cab / 2, Math.floor(largo / 2), cab / 2] : [cab / 2, Math.ceil(largo / 2), cab / 2, Math.floor(largo / 2)]; }
  const [arriba, der, abajo, izq] = lados;
  const repartir = (n, ini, fin) => Array.from({ length: n }, (_, i) => ini + (fin - ini) * (i + 1) / (n + 1));
  repartir(arriba, 0, w).forEach(x => s.push([x, c / 2 - m]));
  repartir(abajo, 0, w).forEach(x => s.push([x, h - c / 2 + m]));
  repartir(izq, 0, h).forEach(y => s.push([c / 2 - m, y]));
  repartir(der, 0, h).forEach(y => s.push([w - c / 2 + m, y]));
  return s;
}
function svgMesa(m) {
  const w = m.ancho, h = m.alto, c = SILLA, i = c - 2;
  const sillas = sillasMesa(m.forma, m.plazas, w, h).map(([x, y]) => `<rect class="s" x="${x - c / 2}" y="${y - c / 2}" width="${c}" height="${c}" rx="${c / 3}"/>`).join('');
  const mesa = m.forma === 'redonda'
    ? `<ellipse class="t" cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - i}" ry="${h / 2 - i}"/>`
    : `<rect class="t" x="${i}" y="${i}" width="${w - 2 * i}" height="${h - 2 * i}" rx="8"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" ${m.color_fondo ? `style="--mf:${m.color_fondo}"` : ''}>${sillas}${mesa}</svg>`;
}
const OBJETOS_SALA = {
  separador: { nombre: 'Separador', w: 220, h: 14 }, planta: { nombre: 'Planta', w: 50, h: 50 }, barra: { nombre: 'Barra', w: 300, h: 60 },
  columna: { nombre: 'Columna', w: 40, h: 40 }, puerta: { nombre: 'Puerta', w: 70, h: 70 }, sofa: { nombre: 'Sofá', w: 160, h: 56 },
};
// Color por defecto de cada objeto (se puede cambiar en el diseñador). Los brillos son capas blancas encima.
const COLOR_OBJETO = { separador: '#8a6f55', planta: '#4f8a3c', barra: '#6f4e37', columna: '#9aa3ad', puerta: '#0064fc', sofa: '#7a5c8f' };
function svgObjeto(o) {
  const w = o.ancho, h = o.alto, c = o.color || COLOR_OBJETO[o.tipo];
  const brillo = a => `rgba(255,255,255,${a})`;
  switch (o.tipo) {
    case 'planta': return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="${c}"/>${[0, 72, 144, 216, 288].map(a => `<ellipse cx="50" cy="26" rx="13" ry="24" fill="${brillo(.28)}" transform="rotate(${a} 50 50)"/>`).join('')}<circle cx="50" cy="50" r="10" fill="rgba(0,0,0,.18)"/></svg>`;
    case 'separador': return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><rect width="${w}" height="${h}" rx="${Math.min(w, h) / 2}" fill="${c}"/></svg>`;
    case 'barra': return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><rect width="${w}" height="${h}" rx="10" fill="${c}"/><rect x="5" y="5" width="${w - 10}" height="${h - 10}" rx="7" fill="${brillo(.14)}"/></svg><span class="obj-texto">BARRA</span>`;
    case 'columna': return `<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="4" fill="${c}"/><rect x="6" y="6" width="28" height="28" rx="3" fill="${brillo(.3)}"/></svg>`;
    case 'puerta': return `<svg viewBox="0 0 70 70"><path d="M2 68 L2 2 A66 66 0 0 1 68 68 Z" fill="${c}" fill-opacity=".1" stroke="${c}" stroke-width="2" stroke-dasharray="4 3"/><rect x="0" y="0" width="5" height="70" fill="${c}"/></svg>`;
    case 'sofa': return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><rect width="${w}" height="${h}" rx="14" fill="${c}"/><rect x="8" y="${h * 0.35}" width="${w - 16}" height="${h * 0.55}" rx="9" fill="${brillo(.22)}"/></svg>`;
  }
  return '';
}
const altoLienzo = (mesas, objetos) => Math.max(600, ...mesas.map(m => (m.py ?? 0) + m.alto + 30), ...objetos.map(o => o.py + o.alto + 30));
// Nombre de la mesa con su color y tamaño de letra.
const textoMesa = (m, extra = '') => `<span class="mesa-txt" style="--fl:${(m.letra || 100) / 100};${m.color_texto ? 'color:' + m.color_texto : ''}"><b>${esc(m.nombre)}</b>${extra ? `<small>${extra}</small>` : ''}</span>`;
const caja = (x, H) => `left:${x.px / 10}%;top:${x.py / H * 100}%;width:${x.ancho / 10}%;height:${x.alto / H * 100}%`;
// Mesas creadas desde la tabla (sin posición) se colocan solas en huecos.
function colocar(mesas) {
  let n = 0;
  for (const m of mesas) if (m.px == null) { m.px = 30 + (n % 6) * 160; m.py = 30 + Math.floor(n / 6) * 160; n++; }
  return mesas;
}
function htmlPlano(zona, mesas, objetos, estadoMesa) {
  const H = altoLienzo(mesas, objetos);
  return `<div class="lienzo" style="aspect-ratio:1000/${H};background:${esc(zona.color_fondo || '#ffffff')}">
    ${objetos.map(o => `<div class="obj obj-${o.tipo}" style="${caja(o, H)}">${svgObjeto(o)}</div>`).join('')}
    ${mesas.map(m => { const st = estadoMesa(m); return `<button class="mesa-plano ${st.clase}" data-mesa="${m.id}" style="${caja(m, H)}">${svgMesa(m)}
      ${textoMesa(m, st.texto)}</button>`; }).join('')}
  </div>`;
}

async function pintarMesas() {
  await cargarAbiertas();
  const zonas = E.datos.zonas;
  if (!E.zonaMesas || !zonas.some(z => z.id === E.zonaMesas)) E.zonaMesas = zonas.find(z => z.tipo === 'mesas')?.id ?? zonas[0]?.id;
  const zona = zonas.find(z => z.id === E.zonaMesas);
  const abiertaDe = m => E.abiertas.find(a => a.mesa_id === m.id);
  const traspaso = E.modoMesas === 'traspasar';
  const destino = E.modoMesas === 'destino';
  let cuerpo;
  if (zona?.tipo === 'mesas') {
    const mesas = colocar(E.datos.mesas.filter(m => m.zona_id === zona.id).map(m => ({ ...m })));
    const objetos = (E.datos.zona_objetos ?? []).filter(o => o.zona_id === zona.id);
    cuerpo = `<div class="plano-sala">${htmlPlano(zona, mesas, objetos, m => { const a = abiertaDe(m);
      return { clase: (a ? 'ocupada' : 'libre') + (traspaso && !a ? ' apagada' : ''), texto: a ? euros(a.total) : '' }; })}</div>`;
  } else {
    const cuentas = E.abiertas.filter(a => a.zona_id === zona?.id);
    cuerpo = `<div class="plano"><div class="lista-barra">
      ${traspaso ? '' : '<button class="primario" data-nueva="1"><b>+ Nueva cuenta</b></button>'}
      ${cuentas.map(a => `<button data-abrir="${a.id}"><b>${esc(a.nombre || 'Cuenta ' + a.id)}</b><br>${euros(a.total)}</button>`).join('')}
    </div></div>`;
  }
  $('#vista').innerHTML = `<div class="mesas">
    ${traspaso ? '<div class="banda-asignar">Traspasar: toca la mesa (o la cuenta) de <b>origen</b>. <button data-cancelar-traspaso="1">Cancelar</button></div>' : ''}
    ${destino ? '<div class="banda-asignar">Traspasar la cuenta de barra: toca la <b>mesa de destino</b> (si está ocupada, se juntan). <button data-cancelar-traspaso="1">Cancelar</button></div>' : ''}
    <div class="pestanas">${zonas.map(z => `<button data-zona="${z.id}" class="${z.id === E.zonaMesas ? 'activa' : ''}">${esc(z.nombre)}</button>`).join('')}</div>
    ${cuerpo}</div>`;
  $('#vista').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cancelarTraspaso) { E.modoMesas = null; return pintarMesas(); }
    if (destino && b.dataset.mesa) {
      const mesa = E.datos.mesas.find(m => m.id === Number(b.dataset.mesa));
      if (abiertaDe(mesa) && !confirm(`${mesa.nombre} ya tiene cuenta. ¿Juntar las dos?`)) return;
      const r = await api('POST', `/cuentas/${E.traspasoOrigen}/traspasar`, { mesa_id: mesa.id });
      E.modoMesas = null; E.traspasoOrigen = null;
      aviso(`Traspasado a ${mesa.nombre}`);
      await comandaAutomatica(r.destino);
      return pintarMesas();
    }
    if (destino) return;
    if (b.dataset.zona) { E.zonaMesas = Number(b.dataset.zona); return pintarMesas(); }
    if (traspaso) {
      const id = b.dataset.mesa ? abiertaDe(E.datos.mesas.find(m => m.id === Number(b.dataset.mesa)))?.id : Number(b.dataset.abrir);
      if (!id) return aviso('Esa mesa está libre: elige una mesa ocupada', true);
      E.modoMesas = null;
      await pintarMesas();
      return abrirTraspaso(id);
    }
    if (b.dataset.mesa) {
      const mesa = E.datos.mesas.find(m => m.id === Number(b.dataset.mesa));
      let comensales = 0;
      if (!abiertaDe(mesa)) {
        const r = prompt(`Comensales en ${mesa.nombre}`, String(mesa.plazas || 2));
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
const aCent = v => String(v ?? '').trim() ? Math.round(Number(String(v).replace(',', '.')) * 100) : undefined;
const signo = c => (c > 0 ? '+' : '') + euros(c);
const fechaLocal = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}` : '';
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const diaLargo = d => `${DIAS[new Date(d + 'T12:00').getDay()]} ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

// Bloques del informe de caja, en pantalla (tablas) o en el cierre impreso (filas de ticket).
function bloquesCaja(r, secciones, ticket) {
  const tabla = (titulo, cab, filas, vacio) => ticket
    ? `<hr><div class="c"><b>${titulo}</b></div>${filas.length ? filas.map(f => `<div class="fila"><span>${f[0]}</span><span>${f.slice(1).join(' · ')}</span></div>`).join('') : `<div class="c">${vacio}</div>`}`
    : `<h3>${titulo}</h3><table><thead><tr>${cab.map((c, i) => `<th class="${i ? 'num' : ''}">${c}</th>`).join('')}</tr></thead><tbody>
       ${filas.map(f => `<tr>${f.map((x, i) => `<td class="${i ? 'num' : ''}">${x}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cab.length}" class="vacio">${vacio}</td></tr>`}</tbody></table>`;
  const out = [];
  const tiene = k => secciones.includes(k);
  if (tiene('comparativa') && r.comparativa) {
    const c = r.comparativa;
    out.push(tabla('Comparativa con el año anterior', ['Día', 'Tickets', 'Ventas'], [
      [ticket ? `Hoy ${diaLargo(c.dia).split(' ')[1]}` : `Hoy (${diaLargo(c.dia)})`, r.tickets, euros(r.total)],
      [ticket ? `Año ant. ${diaLargo(c.anterior).split(' ')[1]}` : diaLargo(c.anterior), c.tickets_anterior, euros(c.total_anterior)],
      ['Diferencia', ...(ticket ? [] : ['']), `${signo(c.diferencia)}${c.porcentaje !== null ? ` (${c.porcentaje > 0 ? '+' : ''}${String(c.porcentaje).replace('.', ',')} %)` : ''}`],
    ], ''));
  }
  if (tiene('articulos')) out.push(tabla('10 artículos más vendidos', ['Artículo', 'Uds.', 'Importe'],
    (r.articulos ?? []).map((x, i) => [`${i + 1}. ${esc(x.nombre)}`, uds(x.unidades), euros(x.total)]), 'Sin ventas'));
  if (tiene('familias')) out.push(tabla('Ranking de familias', ['Familia', 'Uds.', 'Importe'],
    (r.por_familia ?? []).map((x, i) => [`${i + 1}. ${esc(x.nombre)}`, uds(x.unidades), euros(x.total)]), 'Sin ventas'));
  if (tiene('zonas')) out.push(tabla('Ventas por zonas', ['Zona', 'Cuentas', 'Importe'],
    (r.zonas ?? []).map(x => [esc(x.nombre), x.cuentas, euros(x.total)]), 'Sin ventas'));
  if (tiene('mesas')) out.push(tabla('Ventas por mesas', ['Mesa', 'Cuentas', 'Importe'],
    (r.mesas ?? []).map(x => [`${esc(x.zona)} · ${esc(x.nombre)}`, x.cuentas, euros(x.total)]), 'Sin ventas en mesas'));
  if (tiene('borrados') && r.borrados) out.push(tabla('Borrados', ['', 'Nº', 'Importe'], [
    ['Cuentas borradas (borrar todo)', r.borrados.cuentas, euros(r.borrados.importe_cuentas)],
    ['Líneas borradas (total)', r.borrados.lineas, euros(r.borrados.importe)],
  ], ''));
  if (tiene('anulaciones') && r.anulaciones) out.push(tabla('Tickets anulados', ['', 'Nº', 'Importe'],
    [['Anulaciones', r.anulaciones.tickets, euros(r.anulaciones.total)]], ''));
  return out.join('');
}

// Cierre listo para imprimir (formato ticket de 80 mm).
function htmlCierre(c) {
  const emp = E.datos.empresa;
  const cab = `<div class="c"><b>${esc(emp.nombre)}</b></div>${emp.nif ? `<div class="c">NIF ${esc(emp.nif)}</div>` : ''}<hr>
    <div class="c"><b>CIERRE DE CAJA Nº ${c.id}${c.ciego ? ' (CIEGO)' : ''}</b></div>
    <div class="fila"><span>Fecha</span><span>${hora(c.cerrado_en)}</span></div>
    ${c.operario ? `<div class="fila"><span>Operario</span><span>${esc(c.operario)}</span></div>` : ''}`;
  if (c.oculto) {
    return `<div class="ticket">${cab}<hr><div class="c"><b>CONTADO</b></div>
      ${c.contado.map(f => `<div class="fila"><span>${esc(f.nombre)}</span><span>${f.contado === null ? '—' : euros(f.contado)}</span></div>`).join('')}
      <hr><div class="c">El cuadre lo ve el encargado</div></div>`;
  }
  return `<div class="ticket">${cab}
    ${c.desde ? `<div class="fila"><span>Primer ticket</span><span>${fechaLocal(c.desde)}</span></div><div class="fila"><span>Último ticket</span><span>${fechaLocal(c.hasta)}</span></div>` : ''}
    <hr><div class="c"><b>VENTAS POR FORMA DE PAGO</b></div>
    ${c.por_forma.map(f => `<div class="fila"><span>${esc(f.nombre)} (${f.tickets})</span><span>${euros(f.total)}</span></div>`).join('')}
    <div class="fila grande"><span>TOTAL</span><span>${euros(c.total)}</span></div>
    <div class="fila"><span>Tickets</span><span>${c.tickets}</span></div>
    <div class="fila"><span>Ticket medio</span><span>${euros(c.ticket_medio)}</span></div>
    <hr><div class="c"><b>CUADRE DE CAJA</b></div>
    <div class="fila"><span>Fondo inicial</span><span>${euros(c.fondo_inicial)}</span></div>
    ${c.cuadre.map(f => `<div class="fila"><span>${esc(f.nombre)} debería</span><span>${euros(f.esperado)}</span></div>
      <div class="fila"><span>${esc(f.nombre)} contado</span><span>${f.contado === null ? '—' : euros(f.contado)}</span></div>
      ${f.diferencia !== null ? `<div class="fila"><b>${f.diferencia === 0 ? 'Cuadra' : f.diferencia > 0 ? 'Sobra' : 'Falta'}</b><b>${signo(f.diferencia)}</b></div>` : ''}`).join('')}
    ${bloquesCaja(c, c.secciones, true)}
  </div>`;
}

function verCierreModal(c, imprimir) {
  abrirModal(`<h2><span>Cierre de caja ${c.id}</span><button data-m="cerrar">✕</button></h2>
    ${htmlCierre(c)}
    <div class="botones"><button class="primario" data-m="imprimir">Imprimir</button><button data-m="cerrar">Cerrar</button></div>`);
  $('#modal-caja').onclick = e => {
    const b = e.target.closest('button');
    if (b?.dataset.m === 'cerrar') cerrarModal();
    if (b?.dataset.m === 'imprimir') window.print();
  };
  if (imprimir) setTimeout(() => window.print(), 300);
}

async function pintarCaja() {
  const r = await api('GET', '/caja');
  const ef = id => r.por_forma?.find(f => f.id === id);
  const izquierda = r.oculto
    ? `<section class="panel"><h3>Cierre ciego</h3><div class="vacio" style="text-align:left;padding:12px">
        Cuenta el dinero del cajón y mira el total del datáfono, y escribe lo que hay en cada forma de pago.<br><br>
        El cuadre (si sobra o falta) solo lo ve el encargado.</div></section>`
    : `<section class="panel scroll">
      <h3>Ventas desde el último cierre</h3>
      <div class="cifras">
        <div class="cifra"><small>Total · ${r.tickets} tickets</small><b>${euros(r.total)}</b></div>
        <div class="cifra"><small>Ticket medio</small><b>${euros(r.ticket_medio)}</b></div>
        ${r.por_forma.map(f => `<div class="cifra"><small>${esc(f.nombre)} · ${f.tickets} tickets</small><b>${euros(f.total)}</b></div>`).join('')}
      </div>
      <div class="bloques-caja">${bloquesCaja(r, r.secciones, false)}</div>
    </section>`;
  $('#vista').innerHTML = `<div class="dos-col caja">
    ${izquierda}
    <section class="panel scroll">
      <h3>Cierre de caja${r.ciego ? ' ciego' : ''}</h3>
      <div class="form">
        ${r.cuentas_abiertas ? `<div class="peligro">Hay ${r.cuentas_abiertas} cuentas abiertas sin cobrar.</div>` : ''}
        <label>Fondo de caja inicial (€)<input id="fondo" inputmode="decimal" value="0"></label>
        <table class="cuadre"><thead><tr><th>Forma de pago</th>${r.oculto ? '' : '<th class="num">Ventas</th><th class="num">Debería haber</th>'}<th class="num">Contado</th>${r.oculto ? '' : '<th class="num">Diferencia</th>'}</tr></thead><tbody>
          ${r.formas_contar.map(f => `<tr data-forma="${f.id}" data-tipo="${f.tipo}"><td><b>${esc(f.nombre)}</b></td>
            ${r.oculto ? '' : `<td class="num">${euros(ef(f.id)?.total ?? 0)}</td><td class="num" data-esperado>${euros(ef(f.id)?.total ?? 0)}</td>`}
            <td class="num"><input data-contado="${f.id}" inputmode="decimal" placeholder="${r.ciego ? 'Obligatorio' : 'Opcional'}"></td>
            ${r.oculto ? '' : '<td class="num" data-dif>—</td>'}</tr>`).join('')}
        </tbody>${r.oculto ? '' : `<tfoot><tr><th>Total</th><th class="num">${euros(r.total)}</th><th></th><th></th><th></th></tr></tfoot>`}</table>
        <button class="primario" id="b-cierre" style="padding:14px">Hacer cierre de caja</button>
      </div>
    </section></div>`;
  const recalcular = () => {
    if (r.oculto) return;
    const fondo = aCent($('#fondo').value) ?? 0;
    for (const tr of document.querySelectorAll('.cuadre tbody tr')) {
      const esperado = (ef(Number(tr.dataset.forma))?.total ?? 0) + (tr.dataset.tipo === 'efectivo' ? fondo : 0);
      tr.querySelector('[data-esperado]').textContent = euros(esperado);
      const c = aCent(tr.querySelector('input').value);
      const td = tr.querySelector('[data-dif]');
      td.textContent = c === undefined || Number.isNaN(c) ? '—' : c === esperado ? 'Cuadra' : signo(c - esperado);
      td.className = 'num ' + (c === undefined || c === esperado ? '' : c > esperado ? 'sobra' : 'falta');
    }
  };
  $('#vista').oninput = recalcular;
  recalcular();
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.id !== 'b-cierre') return;
    const contado = {};
    for (const i of document.querySelectorAll('[data-contado]')) {
      const c = aCent(i.value);
      if (c !== undefined && Number.isNaN(c)) return aviso('Importe no válido', true);
      if (c !== undefined) contado[i.dataset.contado] = c;
    }
    if (!confirm('¿Hacer el cierre de caja? Las ventas pasarán al histórico.')) return;
    const c = await api('POST', '/caja/cierre', { fondo_inicial: aCent($('#fondo').value) ?? 0, contado });
    aviso(`Cierre ${c.id} hecho`);
    await pintarCaja();
    verCierreModal(c, c.imprimir);
  });
}

// Histórico de cierres (Configuración > Informes).
async function pintarCierres() {
  const lista = await api('GET', '/informes/cierres');
  $('#vista').innerHTML = `<div class="informe scroll">
    ${cabeceraConfig('Cierres de caja')}
    <section class="panel"><table><thead><tr><th>Nº</th><th>Fecha</th><th>Operario</th><th class="num">Tickets</th><th class="num">Total</th><th class="num">Cuadre</th></tr></thead><tbody>
      ${lista.map(c => `<tr class="clic" data-cierre="${c.id}"><td><b>${c.id}</b>${c.ciego ? ' <small>ciego</small>' : ''}</td><td>${hora(c.cerrado_en)}</td><td>${esc(c.operario || '—')}</td>
        <td class="num">${c.tickets ?? '—'}</td><td class="num">${c.total === null ? '—' : euros(c.total)}</td>
        <td class="num ${c.descuadre > 0 ? 'sobra' : c.descuadre < 0 ? 'falta' : ''}">${c.descuadre === null ? '—' : c.descuadre === 0 ? 'Cuadra' : signo(c.descuadre)}</td></tr>`).join('')
        || '<tr><td colspan="6" class="vacio">Todavía no hay cierres</td></tr>'}
    </tbody></table></section></div>`;
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.closest('[data-volver]')) return ir('config');
    const f = e.target.closest('[data-cierre]');
    if (f) verCierreModal(await api('GET', `/informes/cierres/${f.dataset.cierre}`));
  });
}

// ---------- Gestión ----------
const GESTION = {
  articulos: { titulo: 'Artículos', campos: [['nombre', 'Nombre'], ['precio', 'Precio (€)', 'euros'], ['iva', 'IVA %', 'num'], ['familia_id', 'Familia', 'familias'], ['orden_plato_id', 'Orden de plato', 'ordenes_plato'], ['orden', 'Orden', 'num'], ['activo', 'Activo', 'bool'], ['imagen', 'Imagen', 'imagen'], ['color_fondo', 'Color de fondo', 'colorop'], ['color_texto', 'Color de letra', 'colorop'], ['alergenos', 'Alérgenos', 'alergenos'], ['codigo_barras', 'Código de barras'], ['controlar_stock', 'Controlar stock', 'bool'], ['stock_minimo', 'Stock mínimo', 'num'], ['coste', 'Coste (€)', 'euros'],
    ['por_peso', 'Se vende por peso (precio por kg)', 'bool'], ['impresoras', 'Impresión de comanda (sin marcar = las de la familia)', 'impresorasart']] },
  proveedores: { titulo: 'Proveedores', campos: [['nombre', 'Nombre'], ['nif', 'NIF'], ['telefono', 'Teléfono'], ['email', 'Email'], ['direccion', 'Dirección'], ['contacto', 'Persona de contacto'], ['observaciones', 'Observaciones']] },
  familias: { titulo: 'Familias', campos: [['nombre', 'Nombre'], ['color', 'Color', 'color'], ['padre_id', 'Subfamilia de', 'familias'], ['departamento_id', 'Departamento', 'departamentos'], ['orden', 'Orden', 'num'], ['imagen', 'Imagen', 'imagen'], ['color_fondo', 'Color de fondo', 'colorop'], ['color_texto', 'Color de letra', 'colorop'],
    ['impresoras', 'Impresoras de comanda de la familia', 'impresorasfam']] },
  departamentos: { titulo: 'Departamentos', campos: [['nombre', 'Nombre']] },
  zonas: { titulo: 'Zonas', campos: [['nombre', 'Nombre'], ['tipo', 'Tipo', 'tipozona'], ['orden', 'Orden', 'num'], ['color_fondo', 'Color de fondo del plano', 'colorop']] },
  mesas: { titulo: 'Mesas', campos: [['nombre', 'Nombre'], ['zona_id', 'Zona', 'zonas'], ['forma', 'Forma', 'formamesa'], ['plazas', 'Comensales (sillas)', 'num']] },
  formas_cobro: { titulo: 'Formas de cobro', campos: [['nombre', 'Nombre'], ['tipo', 'Tipo', 'tipocobro'], ['activa', 'Activa', 'bool'], ['orden', 'Orden', 'num']] },
  operarios: { titulo: 'Operarios', campos: [['nombre', 'Nombre'], ['pin', 'Clave (vacía = entra sin clave)', 'clave'], ['rfid', 'Pulsera RFID', 'rfid'], ['permisos', 'Permisos', 'permisos'], ['orden', 'Orden', 'num']] },
  ordenes_plato: { titulo: 'Órdenes de plato', campos: [['nombre', 'Nombre'], ['orden', 'Orden', 'num']] },
  ivas: { titulo: 'IVAs', campos: [['nombre', 'Nombre'], ['codigo', 'Código'], ['porcentaje', 'IVA %', 'num'], ['recargo', 'Recargo equivalencia %', 'num'], ['orden', 'Orden', 'num']] },
  puestos: { titulo: 'Puestos', campos: [['nombre', 'Nombre'], ['tipo', 'Tipo', 'tipopuesto'], ['impresora_tickets_id', 'Impresora de tickets', 'impresoras'], ['usar_permisos', 'Activar permisos de operarios', 'bool'], ['pedir_operario', 'Pedir operario en cada operación', 'bool'], ['cierre_ciego', 'Cierre ciego', 'bool'], ['imprimir_cierre', 'Imprimir el cierre al terminar', 'bool'], ['cierre_secciones', 'Qué sale en el cierre de caja', 'secciones'], ['orden', 'Orden', 'num'],
    ['serie_tickets', 'Serie de tickets de este puesto (vacía = la de la empresa)'], ['serie_facturas', 'Serie de facturas completas de este puesto'],
    ['smtp_servidor', 'Correo · Servidor SMTP'], ['smtp_puerto', 'Correo · Puerto SMTP', 'num'], ['smtp_cifrado', 'Correo · Cifrado', 'cifrado'], ['smtp_usuario', 'Correo · Usuario'], ['smtp_clave', 'Correo · Contraseña', 'clave'],
    ['email_emisor', 'Correo · Email emisor'], ['email_asunto', 'Correo · Asunto (vacío = automático)'], ['email_encabezado', 'Correo · Texto de encabezado'], ['email_pie', 'Correo · Texto de pie'],
    ['mail_en_cierre', 'Enviar el cierre de caja por correo', 'bool'], ['email_cierre', 'Correo · Destinatarios del cierre (separados por ;)']] },
  impresoras: { titulo: 'Impresoras de cocina y tickets', campos: [['nombre', 'Nombre'], ['ip', 'Dirección IP'], ['puerto', 'Puerto', 'num'], ['uso', 'Uso', 'usoimpresora'], ['envio', 'Envío de comandas', 'envio'], ['imprimir_barra', 'Imprimir también las cuentas de barra', 'boolno'], ['departamento_id', 'Departamento', 'departamentos'], ['activa', 'Activa', 'bool'], ['orden', 'Orden', 'num']] },
  comentarios: { titulo: 'Comentarios de comanda', campos: [['texto', 'Comentario'], ['familia_id', 'Solo familia', 'familias'], ['articulo_id', 'Solo artículo', 'articulos'], ['orden', 'Orden', 'num']] },
  conceptos_pago: { titulo: 'Conceptos de pago', campos: [['nombre', 'Nombre'], ['orden', 'Orden', 'num']] },
  botones: { titulo: 'Botonera', campos: [['texto', 'Texto'], ['accion', 'Acción', 'accion'], ['color', 'Color', 'colorop'], ['orden', 'Orden', 'num'], ['visible', 'Visible', 'bool']] },
};
const GRUPOS = [[-2, 'Ninguno'], [0, 'Entrantes'], [1, 'Primeros'], [2, 'Segundos'], [3, 'Postres']];
const OPCIONES = {
  tipozona: [['mesas', 'Mesas'], ['barra', 'Barra']],
  tipocobro: [['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['pendiente', 'Pendiente de cobro'], ['otro', 'Otro']],
  tipopuesto: [['tpv', 'TPV'], ['pda', 'PDA camarero'], ['kds', 'Pantalla de cocina']],
  envio: [['auto', 'Automático al guardar o salir de la mesa'], ['manual', 'Solo con el botón Enviar comanda']],
  formamesa: [['cuadrada', 'Cuadrada'], ['rectangular', 'Rectangular'], ['redonda', 'Redonda']],
  cifrado: [['tls', 'TLS (STARTTLS, puerto 587)'], ['ssl', 'SSL (puerto 465)'], ['ninguno', 'Ninguno (puerto 25)']],
  usoimpresora: [['cocina', 'Cocina'], ['barra', 'Barra'], ['tickets', 'Tickets'], ['otro', 'Otro']],
};
const REFS = ['familias', 'departamentos', 'zonas', 'impresoras', 'articulos', 'ordenes_plato'];

function valorCelda(tipo, v) {
  if (tipo === 'euros') return euros(v);
  if (tipo === 'bool' || tipo === 'boolno') return v ? 'Sí' : 'No';
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
  if (tipo === 'impresorasart' && !v) return 'Como la familia';
  if (LISTAS[tipo]) return String(v || '').split(',').filter(Boolean).map(p => esc(LISTAS[tipo]()[p] ?? p)).join(', ') || 'Ninguno';
  return esc(v);
}

// Campos de selección múltiple (botones que se encienden y apagan).
const impresorasComanda = () => Object.fromEntries((E.datos.impresoras ?? []).filter(i => i.uso !== 'tickets').map(i => [i.id, i.nombre]));
const LISTAS = { permisos: () => E.datos.permisos, secciones: () => E.datos.secciones_cierre,
  impresorasfam: impresorasComanda, impresorasart: () => ({ ninguna: 'No imprimir', ...impresorasComanda() }) };

function campoForm([k, etiqueta, tipo], fila) {
  const v = fila?.[k];
  if (tipo === 'boolno') return `<label><span>${etiqueta}</span><select name="${k}"><option value="0" ${v !== 1 ? 'selected' : ''}>No</option><option value="1" ${v === 1 ? 'selected' : ''}>Sí</option></select></label>`;
  if (tipo === 'bool') return `<label><span>${etiqueta}</span><select name="${k}"><option value="1" ${v !== 0 ? 'selected' : ''}>Sí</option><option value="0" ${v === 0 ? 'selected' : ''}>No</option></select></label>`;
  if (tipo === 'clave') return `<label>${etiqueta}<input name="${k}" type="password" inputmode="numeric" autocomplete="new-password" value="${esc(v ?? '')}"></label>`;
  if (tipo === 'rfid') return `<label>${etiqueta}<input name="${k}" value="${esc(v ?? '')}" placeholder="Toca aquí y pasa la pulsera por el lector" autocomplete="off" onkeydown="if(event.key==='Enter')event.preventDefault()"></label>`;
  if (LISTAS[tipo]) {
    const sel = new Set(String(v || '').split(',').filter(Boolean));
    return `<div class="campo-alergenos"><span>${etiqueta}</span><input type="hidden" name="${k}" value="${esc(v ?? '')}">
      <div class="rejilla-permisos">${Object.entries(LISTAS[tipo]()).map(([p, t]) => `<button type="button" data-alergeno="${p}" class="${sel.has(p) ? 'activo' : ''}">${esc(t)}</button>`).join('')}</div></div>`;
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

// En la lista solo las columnas cortas (el formulario tiene todas).
const columnasTabla = def => def.campos.filter(([k, et]) => !et.startsWith('Correo') && !/^serie_|^email_|^smtp_|^codigo_barras$|^coste$|^stock_minimo$|^observaciones$|^contacto$|^direccion$/.test(k)).slice(0, 9);

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
        <table><thead><tr>${columnasTabla(def).map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
        ${filas.map(f => `<tr class="clic ${f.id === editar ? 'sel' : ''}" data-editar="${f.id}">${columnasTabla(def).map(([k, , t]) => `<td>${valorCelda(t, f[k])}</td>`).join('')}</tr>`).join('')}
        </tbody></table>
      </section>
      <section class="panel scroll">
        ${fila ? `<h3>${editar === 'nuevo' ? 'Nuevo' : 'Editar'}</h3>
          <form class="form" id="f-gestion">${def.campos.map(c => campoForm(c, fila)).join('')}
            <div class="botones" style="padding:0"><button class="primario" type="submit">Guardar</button>
            ${editar !== 'nuevo' ? '<button type="button" class="peligro" id="b-borrar">Borrar</button>' : ''}
            ${E.tablaGestion === 'puestos' && editar !== 'nuevo' ? '<button type="button" data-probar-correo="1">Probar el correo</button>' : ''}
            ${E.tablaGestion === 'zonas' && editar !== 'nuevo' && fila?.tipo === 'mesas' ? `<button type="button" data-disenar="${fila.id}">Diseñar la sala</button>` : ''}</div>
          </form>` : '<div class="vacio">Selecciona una fila o pulsa Añadir</div>'}
      </section>
    </div></div>`;

  $('#vista').onclick = e => intentar(async () => {
    const b = e.target.closest('[data-volver],[data-editar],#b-borrar,[data-elegir-imagen],[data-quitar-imagen],[data-alergeno],[data-auto-imagenes],[data-probar-correo],[data-disenar]');
    if (!b) return;
    if (b.dataset.disenar) { E.zonaDiseno = Number(b.dataset.disenar); E.volverA = 'gestion'; return ir('diseno'); }
    if (b.dataset.probarCorreo) {
      const para = prompt('¿A qué correo envío la prueba? (guarda antes los cambios)');
      if (!para) return;
      const r = await api('POST', '/correo/prueba', { para });
      return aviso(`Correo de prueba enviado a ${r.para.join(', ')}`);
    }
    if (b.dataset.volver) return ir(E.volverA || 'config');
    if (b.dataset.alergeno) {
      b.classList.toggle('activo');
      const caja = b.closest('.campo-alergenos');
      // "No imprimir" no se combina con impresoras.
      if (caja.querySelector('[data-alergeno="ninguna"]')) {
        if (b.dataset.alergeno === 'ninguna' && b.classList.contains('activo')) caja.querySelectorAll('[data-alergeno].activo').forEach(x => x !== b && x.classList.remove('activo'));
        else if (b.dataset.alergeno !== 'ninguna') caja.querySelector('[data-alergeno="ninguna"]').classList.remove('activo');
      }
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
      else if (['num', 'grupo', 'bool', 'boolno'].includes(tipo)) datos[k] = Number(String(v).replace(',', '.'));
      else if (REFS.includes(tipo)) datos[k] = v === '' ? null : Number(v);
      else datos[k] = v;
    }
    const r = editar === 'nuevo'
      ? await api('POST', `/gestion/${E.tablaGestion}`, datos)
      : await api('PUT', `/gestion/${E.tablaGestion}/${editar}`, datos);
    aviso('Guardado');
    await cargarDatos();
    if (E.tablaGestion === 'zonas' && editar === 'nuevo' && r.tipo === 'mesas') { E.zonaDiseno = r.id; E.volverA = 'gestion'; return ir('diseno'); }
    return pintarGestion(r.id);
  });
}

async function pintarEmpresa() {
  const emp = await api('GET', '/empresa');
  const campos = [['nombre', 'Nombre comercial o razón social'], ['nif', 'NIF'], ['direccion', 'Dirección'], ['localidad', 'CP y localidad'], ['telefono', 'Teléfono'], ['email', 'Email'],
    ['serie_tickets', 'Serie de tickets (si el puesto no tiene la suya)'], ['serie_facturas', 'Serie de facturas completas (si el puesto no tiene la suya)']];
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
  const volver = E.volverA === 'stocks' ? 'Stocks' : E.volverA === 'gestion' ? 'Zonas' : E.seccionConfig || 'Configuración';
  return `<div class="cab-config"><button data-volver="1">← ${esc(volver)}</button><h2>${esc(titulo)}</h2></div>`;
}

const SECCIONES_CONFIG = [
  ['Informes', [
    ['informes', 'Ventas y caja', 'Ventas por forma de cobro y por familia'],
    ['cierres', 'Cierres de caja', 'Cierres hechos, cuadre y reimpresión'],
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
    ['carta_demo', 'Cargar carta de demostración', 'Sustituye familias y artículos por la carta demo'],
  ]],
  ['Local', [
    ['zonas', 'Zonas', 'Barra, comedor, terraza...'],
    ['diseno', 'Diseño de salas', 'Mesas, colores, separadores y plantas'],
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
  ['Módulos activos', null, 'Clientes, stocks, informes, CashDro, scanner, cocina, pulseras, balanza'],
  ['Personalización', [
    ['empresa', 'Datos de empresa', 'Nombre, NIF, dirección y serie'],
    ['aspecto', 'Aspecto', 'Tamaño de zonas y botones, colores'],
    ['escala', 'Tamaño en esta pantalla', 'Tamaño y pantalla completa de este TPV'],
    ['botones', 'Botonera', 'Botones de la pantalla de venta'],
  ]],
];

// Configuración: primero los grupos (Informes, Carta...) y dentro de cada uno sus pantallas.
const ICONOS_SECCION = {
  Informes: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  Carta: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h8"/>',
  Local: '<path d="M3 10l9-6 9 6v10H3z"/><path d="M9 20v-6h6v6"/>',
  'Cobros e impuestos': '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/>',
  'Módulos activos': '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><path d="M17 13v8M13 17h8"/>',
  Personalización: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.5"/><circle cx="12" cy="7.5" r="1.5"/><circle cx="16" cy="10" r="1.5"/><path d="M12 21a3 3 0 0 1 0-6h3"/>',
};
const iconoSeccion = t => `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONOS_SECCION[t] ?? ''}</svg>`;

function pintarConfig() {
  const sec = SECCIONES_CONFIG.find(([t]) => t === E.seccionConfig);
  $('#vista').innerHTML = sec
    ? `<div class="config scroll">
        <div class="cab-config"><button data-secciones="1">← Configuración</button><h2>${iconoSeccion(sec[0])} ${esc(sec[0])}</h2></div>
        <div class="baldosas" style="margin-top:14px">${sec[1].map(([k, t, d]) => { const m = MODULO_DE_PANTALLA[k]; const cerrado = m && !moduloActivo(m);
          return `<button data-ir="${k}" class="${cerrado ? 'bloqueado' : ''}"><b>${cerrado ? '🔒 ' : ''}${t}</b><span>${cerrado ? 'Necesita el módulo ' + esc(E.datos.licencia.modulos_disponibles[m]) : d}</span></button>`; }).join('')}</div>
      </div>`
    : `<div class="config scroll">
        <h2>${ICONO_HERRAMIENTAS} Configuración</h2>
        <div class="secciones-config">${SECCIONES_CONFIG.map(([t, items, desc]) => `<button data-seccion="${esc(t)}">${iconoSeccion(t)}<b>${esc(t)}</b>
          <span>${items ? items.map(i => esc(i[1])).join(' · ') : esc(desc)}</span></button>`).join('')}</div>
      </div>`;
  $('#vista').onclick = e => intentar(async () => {
    const s = e.target.closest('[data-seccion]');
    if (s) {
      if (s.dataset.seccion === 'Módulos activos') return ir('modulos');
      E.seccionConfig = s.dataset.seccion; return pintarConfig();
    }
    if (e.target.closest('[data-secciones]')) { E.seccionConfig = null; return pintarConfig(); }
    const b = e.target.closest('[data-ir]');
    if (!b) return;
    const k = b.dataset.ir;
    if (MODULO_DE_PANTALLA[k] && !moduloActivo(MODULO_DE_PANTALLA[k])) return ir('modulos');
    if (k === 'este_puesto') return elegirPuesto();
    if (k === 'escala') return elegirEscala();
    if (k === 'carta_demo') {
      if (!confirm('Se borrarán TODAS las familias y artículos y se cargará la carta de demostración (23 familias y 140 artículos con imágenes). Los tickets ya hechos no cambian. ¿Seguir?')) return;
      const r = await api('POST', '/carta-demo');
      E.datos = await api('GET', '/inicio');
      E.familia = null;
      return aviso(`Carta cargada: ${r.familias} familias y ${r.articulos} artículos`);
    }
    if (k === 'diseno') { E.volverA = null; return ir('diseno'); }
    if (['abiertas', 'empresa', 'borrados', 'registro', 'aspecto', 'empleados', 'cierres'].includes(k)) return ir(k);
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
      <div class="po-nombres ordenes">${ESCALAS.map(([v, t]) => `<button data-escala="${v}" class="${v === actual ? 'activo' : ''}"><b>${t}</b></button>`).join('')}</div>
      <h3>Pantalla completa al entrar</h3>
      <p class="nota">Se pone al primer toque. Para quitarla, mantén pulsado el logo de arriba 3 segundos.</p>
      <div class="po-nombres ordenes">${[['1', 'Sí'], ['0', 'No']].map(([v, t]) => `<button data-completa="${v}" class="${(pantallaCompletaActiva() ? '1' : '0') === v ? 'activo' : ''}"><b>${t}</b></button>`).join('')}</div></div>`);
    $('#modal-caja').onclick = e => {
      const b = e.target.closest('button');
      if (b?.dataset.m === 'cerrar') return cerrarModal();
      if (b?.dataset.completa) {
        try { localStorage.setItem('pantallaCompleta', b.dataset.completa); } catch {}
        E.sinPantallaCompleta = b.dataset.completa === '0';
        if (E.sinPantallaCompleta && document.fullscreenElement) document.exitFullscreen().catch(() => {});
        return pintar();
      }
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
  pintarMenu();
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
    if (!moduloActivo('pulseras')) return;
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
    const mal = (r.impresoras ?? []).filter(x => !x.ok);
    if (mal.length) aviso(`${r.texto}: no se pudo imprimir en ${mal.map(x => x.impresora).join(', ')}`, true);
    else aviso(`Enviado: ${r.texto}${r.impresoras?.length ? ' · ' + r.impresoras.map(x => x.impresora).join(', ') : ''}`);
  });
}

async function verComanda() {
  const c = E.cuenta;
  const [r, pend] = await Promise.all([api('GET', `/cuentas/${c.id}/comanda`), api('GET', `/cuentas/${c.id}/comanda/pendiente`)]);
  const hayImpresoras = (E.datos.impresoras ?? []).some(i => i.activa && i.uso !== 'tickets');
  const pendDe = id => pend.find(p => p.id === id);
  const bloque = (titulo, grupos, p) => `<div class="ticket comanda-previa"><div class="c"><b>${esc(titulo)}</b><br>${esc(r.cuenta)} · ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${E.operario ? ' · ' + esc(E.operario.nombre) : ''}</div>
      ${grupos.map(g => `<div class="grupo-comanda">— ${esc(g.nombre.toUpperCase())} —</div>${g.lineas.map(l => `<div class="fila"><span>${uds(l.unidades)} x ${esc(l.texto)}</span></div>`).join('')}`).join('')}
      ${p ? `<div class="pendiente-comanda">Sin enviar: ${p.lineas.map(l => `${uds(l.unidades)} ${esc(l.texto)}`).join(', ')}</div>` : r.por_impresora ? '<div class="enviada-comanda">✓ Enviada</div>' : ''}</div>`;
  abrirModal(`<h2><span>Comanda</span><button data-m="cerrar">✕</button></h2>
    <div class="comandas-impresoras">
      ${r.por_impresora.map(i => bloque(i.nombre, i.grupos, pendDe(i.id))).join('')}
      ${r.sin_impresora.length ? bloque(hayImpresoras ? 'Sin impresora asignada' : 'Comanda', r.sin_impresora, null) : ''}
    </div>
    ${hayImpresoras ? '' : '<p class="nota" style="padding:0 16px">No hay impresoras de cocina o barra. Créalas en Configuración > Local > Impresoras y asígnalas a las familias o artículos.</p>'}
    <div class="botones">
      ${hayImpresoras ? `<button class="primario" data-m="enviar" ${pend.length ? '' : 'disabled'}>Enviar comanda</button><button data-m="reenviar">Reenviar a cocina</button>` : ''}
      <button data-m="cerrar">Cerrar</button></div>`);
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (b?.dataset.m === 'cerrar') return cerrarModal();
    if (b?.dataset.m === 'enviar' || b?.dataset.m === 'reenviar') {
      if (b.dataset.m === 'reenviar' && !confirm('¿Volver a imprimir toda la comanda? Saldrá marcada como REENVÍO.')) return;
      const res = await api('POST', `/cuentas/${c.id}/comanda/enviar`, { modo: b.dataset.m });
      avisoComanda(res);
      return verComanda();
    }
  });
}

function avisoComanda(res) {
  const mal = res.enviadas.filter(x => !x.ok), bien = res.enviadas.filter(x => x.ok);
  if (mal.length) aviso(`No se pudo imprimir en ${mal.map(x => `${x.impresora} (${x.error})`).join(', ')}. Queda pendiente.`, true);
  else if (bien.length) aviso(`Comanda enviada a ${bien.map(x => x.impresora).join(', ')}`);
}

// Al guardar la cuenta o salir de ella, lo nuevo sale solo en las impresoras con envío automático.
async function comandaAutomatica(cuenta) {
  if (!cuenta?.id || !cuenta.lineas?.length) return;
  if (!(E.datos.impresoras ?? []).some(i => i.activa && i.uso !== 'tickets' && i.envio !== 'manual')) return;
  try { avisoComanda(await api('POST', `/cuentas/${cuenta.id}/comanda/enviar`, { modo: 'auto' })); }
  catch (e) { aviso('Comanda: ' + e.message, true); }
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
  const marcarLado = () => $('#ajustes').querySelectorAll('[data-lado]').forEach(b => b.classList.toggle('activo', b.dataset.lado === b.closest('.ajuste').querySelector('input').value));
  const control = ([k, [, etiqueta, tipo, min, max, , unidad]]) => tipo === 'lado'
    ? `<div class="ajuste"><span>${esc(etiqueta)}</span><input type="hidden" name="${k}" value="${esc(val[k])}">
        <div class="lado"><button type="button" data-lado="izquierda">Izquierda (zurdos)</button><button type="button" data-lado="derecha">Derecha (diestros)</button></div></div>`
    : tipo === 'color'
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
  marcarLado();
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.closest('[data-volver]')) return ir('config');
    const lado = e.target.closest('[data-lado]');
    if (lado) { lado.closest('.ajuste').querySelector('input').value = lado.dataset.lado; marcarLado(); return leer(); }
    if (e.target.closest('[data-defecto]')) {
      for (const el of $('#ajustes').querySelectorAll('input')) el.value = E.datos.aspecto_campos[el.name][5];
      $('#ajustes').querySelectorAll('.selector-color').forEach(refrescarMuestra);
      marcarLado();
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

// ---------- Módulos con licencia ----------
const moduloActivo = m => !!E.datos?.licencia?.activos?.includes(m);
// Pantallas de configuración que necesitan un módulo.
const MODULO_DE_PANTALLA = { borrados: 'informes', empleados: 'informes' };

function pantallaBloqueada(m, titulo) {
  $('#vista').innerHTML = `<div class="bloqueo"><div>
    <div class="candado">🔒</div><h2>${esc(titulo)}</h2>
    <p>Necesitas el módulo <b>${esc(E.datos.licencia.modulos_disponibles[m])}</b>. Actívalo con tu licencia en Configuración &gt; Módulos activos.</p>
    ${tienePermiso('configuracion') ? '<button class="primario" data-ir-modulos="1">Ver módulos activos</button>' : ''}</div></div>`;
  $('#vista').onclick = e => { if (e.target.closest('[data-ir-modulos]')) intentar(() => ir('modulos')); };
}

function pintarModulos() {
  const l = E.datos.licencia;
  $('#vista').innerHTML = `<div class="config scroll">
    ${cabeceraConfig('Módulos activos')}
    <div class="licencia-cab">
      <div class="cifra"><small>Identificador de esta instalación</small><b class="inst" title="Dáselo a LevaDigital para pedir la licencia">${esc(l.instalacion)}</b></div>
      <div class="cifra"><small>Titular</small><b>${esc(l.titular || '—')}</b></div>
      <div class="cifra"><small>Caduca</small><b>${l.caduca ? esc(l.caduca.split('-').reverse().join('/')) : l.activos.length ? 'Sin caducidad' : '—'}</b></div>
    </div>
    ${l.aviso ? `<div class="aviso-licencia">${esc(l.aviso)}</div>` : ''}
    <div class="modulos">${Object.entries(l.modulos_disponibles).map(([k, t]) => `<div class="modulo ${l.activos.includes(k) ? 'activo' : ''}">
      <b>${esc(t)}</b><span>${l.activos.includes(k) ? '✓ Activo' : '🔒 Sin licencia'}</span></div>`).join('')}</div>
    <h3>Activar licencia</h3>
    <div class="form" style="padding:0;max-width:760px">
      <label>Pega aquí el código de licencia que te ha dado LevaDigital<textarea id="codigo-licencia" rows="4" placeholder="LEVA1...."></textarea></label>
      <div><button class="primario" id="b-activar" style="padding:12px 26px;font-weight:700">Activar</button></div>
    </div></div>`;
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.closest('[data-volver]')) return ir('config');
    if (e.target.id === 'b-activar') {
      E.datos.licencia = await api('POST', '/licencia', { codigo: $('#codigo-licencia').value });
      aviso(`Licencia activada: ${E.datos.licencia.activos.length} módulos`);
      return pintarModulos();
    }
  });
}

// ---------- Documento A4 (factura simplificada o factura completa) ----------
function htmlA4(d, titulo) {
  const e = d.empresa, c = d.cliente;
  const fecha = (d.emitido_en ?? d.fecha) ? hora(d.emitido_en ?? d.fecha) : '';
  return `<div class="documento">
    <div class="doc-cab">
      <div><b class="doc-empresa">${esc(e.nombre)}</b><br>${esc(e.direccion)}${e.localidad ? '<br>' + esc(e.localidad) : ''}${e.nif ? '<br>NIF ' + esc(e.nif) : ''}${e.telefono ? '<br>Tel. ' + esc(e.telefono) : ''}</div>
      <div class="d"><b class="doc-titulo">${esc(titulo.toUpperCase())}</b><br>Nº ${esc(d.serie)}-${d.numero}<br>${fecha}</div>
    </div>
    ${c ? `<div class="doc-cliente"><small>Cliente</small><b>${esc(c.nombre)}</b>${c.nif ? '<br>NIF ' + esc(c.nif) : ''}${c.domicilio ? '<br>' + esc(c.domicilio) : ''}${c.cp || c.localidad ? '<br>' + esc([c.cp, c.localidad, c.provincia].filter(Boolean).join(' ')) : ''}</div>` : ''}
    <table class="doc-lineas"><thead><tr><th>Descripción</th><th class="num">Uds.</th><th class="num">Precio</th><th class="num">IVA</th><th class="num">Importe</th></tr></thead><tbody>
      ${d.lineas.map(l => `<tr><td>${esc(l.descripcion)}${l.invitacion ? ' <i>(invitación)</i>' : ''}</td><td class="num">${uds(l.unidades)}${l.por_peso ? ' kg' : ''}</td><td class="num">${euros(l.invitacion ? 0 : l.precio)}${l.por_peso ? '/kg' : ''}</td><td class="num">${l.iva}%</td><td class="num">${l.invitacion ? 'Invitación' : euros(l.importe)}</td></tr>`).join('')}
    </tbody></table>
    <table class="doc-totales">${d.impuestos.map(i => `<tr><td>Base ${i.iva}%</td><td class="num">${euros(i.base)}</td><td>Cuota IVA</td><td class="num">${euros(i.cuota)}</td></tr>`).join('')}
      <tr class="doc-total"><td colspan="3">TOTAL</td><td class="num">${euros(d.total)}</td></tr></table>
    ${d.pagos?.length ? `<p class="doc-nota">Forma de pago: ${d.pagos.map(p => esc(p.nombre) + ' ' + euros(p.importe)).join(' · ')}</p>` : ''}
    ${d.tickets ? `<p class="doc-nota">Esta factura sustituye a las facturas simplificadas: ${d.tickets.map(t => esc(t.serie + '-' + t.numero)).join(', ')}</p>` : ''}
  </div>`;
}

function verDocumentoA4(d, titulo, rutaEmail) {
  abrirModal(`<h2><span>${esc(titulo)} ${esc(d.serie)}-${d.numero}</span><button data-m="cerrar">✕</button></h2>
    <div class="doc-marco">${htmlA4(d, titulo)}</div>
    <div class="botones"><button class="primario" data-m="imprimir">Imprimir A4</button>${rutaEmail ? '<button data-m="email">Enviar por email</button>' : ''}<button data-m="cerrar">Cerrar</button></div>`);
  $('#modal-caja').classList.add('a4');
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (b?.dataset.m === 'cerrar') { $('#modal-caja').classList.remove('a4'); return cerrarModal(); }
    if (b?.dataset.m === 'imprimir') return window.print();
    if (b?.dataset.m === 'email') return enviarPorEmail(rutaEmail, d.cliente?.email);
  });
}

async function enviarPorEmail(ruta, sugerido = '') {
  const para = prompt('Enviar por email a:', sugerido || '');
  if (!para) return;
  const r = await api('POST', ruta, { para });
  aviso(`Enviado a ${r.para.join(', ')}`);
}

// ---------- Clientes ----------
function elegirClienteCuenta() {
  if (!moduloActivo('clientes')) return aviso('El módulo de clientes no está activo', true);
  E.eligiendoCliente = true;
  E.fichaCliente = null;
  return ir('clientes');
}

const CAMPOS_CLIENTE = [['nombre', 'Nombre o razón social *'], ['apellidos', 'Apellidos'], ['nif', 'NIF / CIF'], ['telefono', 'Teléfono'], ['email', 'Email'],
  ['domicilio', 'Domicilio'], ['cp', 'Código postal'], ['localidad', 'Localidad'], ['provincia', 'Provincia'], ['apodo', 'Apodo (para buscarlo)'], ['observaciones', 'Observaciones']];

function formCliente(c, alGuardar) {
  abrirModal(`<h2><span>${c ? 'Editar cliente' : 'Nuevo cliente'}</span><button data-m="cerrar">✕</button></h2>
    <form class="form form-cliente" autocomplete="off">
      ${CAMPOS_CLIENTE.map(([k, t]) => `<label class="${k === 'nombre' || k === 'domicilio' || k === 'observaciones' ? 'ancho' : ''}">${t}<input name="${k}" value="${esc(c?.[k] ?? '')}" ${k === 'email' ? 'type="email"' : ''} ${k === 'telefono' || k === 'cp' ? 'inputmode="tel"' : ''}></label>`).join('')}
      <small class="ancho tenue">Para hacer una factura completa hacen falta el NIF y el domicilio.</small>
      <div class="botones ancho" style="padding:0"><button type="submit" class="primario">Guardar</button><button type="button" data-m="cerrar">Cancelar</button></div>
    </form>`);
  setTimeout(() => $('#modal-caja [name=nombre]')?.focus(), 30);
  $('#modal-caja').onclick = e => { if (e.target.closest('[data-m="cerrar"]')) cerrarModal(); };
  $('#modal-caja form').onsubmit = ev => {
    ev.preventDefault();
    intentar(async () => {
      const datos = Object.fromEntries(new FormData(ev.target));
      if (!datos.nombre.trim()) return aviso('Escribe el nombre del cliente', true);
      const r = c ? await api('PUT', `/gestion/clientes/${c.id}`, datos) : await api('POST', '/gestion/clientes', datos);
      cerrarModal();
      aviso(c ? 'Cliente guardado' : 'Cliente creado');
      return alGuardar(r);
    });
  };
}

async function asignarCliente(id) {
  E.cuenta = await api('PATCH', `/cuentas/${E.cuenta.id}`, { cliente_id: id });
  E.eligiendoCliente = false;
  aviso(id ? `Cliente asignado: ${E.cuenta.cliente?.nombre ?? ''}` : 'Cliente quitado de la cuenta');
  await ir('venta');
  if (E.volverCobro) { E.volverCobro = false; if (E.cuenta?.lineas.length) abrirCobro(); }
}

const iniciales = c => ((c.nombre?.[0] ?? '') + (c.apellidos?.[0] ?? c.nombre?.split(' ')[1]?.[0] ?? '')).toUpperCase();
const PULSACION_FICHA_MS = 2000;

async function pintarClientes() {
  if (!moduloActivo('clientes')) return pantallaBloqueada('clientes', 'Clientes');
  if (E.fichaCliente) return pintarFicha(E.fichaCliente);
  if (E.cuenta) E.cuenta = await api('GET', `/cuentas/${E.cuenta.id}`).then(c => c.estado === 'abierta' ? c : null).catch(() => null);
  const asignar = !!E.cuenta;
  $('#vista').innerHTML = `<div class="clientes">
    <div class="clientes-barra">
      <input id="q-clientes" type="search" placeholder="Buscar por nombre, NIF, teléfono o apodo" value="${esc(E.qClientes ?? '')}" autocomplete="off">
      <button class="primario nuevo-cliente" id="b-nuevo-cliente">＋ Nuevo cliente</button>
    </div>
    ${asignar ? `<div class="banda-asignar">Toca un cliente para asignarlo a <b>${esc(nombreCuenta(E.cuenta))}</b>. Para ver su ficha, pulsa <b>Ficha</b> o mantén pulsado 2 segundos.
      ${E.cuenta.cliente ? `<button id="b-quitar-cliente">Quitar ${esc(E.cuenta.cliente.nombre)}</button>` : ''}<button id="b-volver-venta">Volver a la venta</button></div>`
      : '<div class="banda-asignar tenue">Toca un cliente (o mantén pulsado 2 segundos) para abrir su ficha. Con una cuenta abierta, al tocarlo se asigna a la cuenta.</div>'}
    <div class="lista-clientes" id="lista-clientes"></div>
  </div>`;
  const pintarLista = async () => {
    const lista = await api('GET', `/clientes?q=${encodeURIComponent(E.qClientes ?? '')}`);
    const actual = E.cuenta?.cliente_id;
    $('#lista-clientes').innerHTML = lista.map(c => `<div class="tarjeta-cliente ${c.id === actual ? 'actual' : ''}" data-cliente="${c.id}">
        <i class="avatar">${esc(iniciales(c))}</i>
        <div class="tc-datos"><b>${esc(c.nombre)} ${esc(c.apellidos ?? '')}</b><small>${[c.nif, c.telefono, c.localidad].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</small></div>
        <button class="tc-ficha" data-ficha="${c.id}">Ficha</button>
      </div>`).join('') || `<div class="vacio">${E.qClientes ? 'Ningún cliente coincide con la búsqueda' : 'Todavía no hay clientes. Crea el primero con «Nuevo cliente».'}</div>`;
  };
  await pintarLista();
  let t;
  $('#q-clientes').oninput = e => { E.qClientes = e.target.value; clearTimeout(t); t = setTimeout(() => intentar(pintarLista), 200); };
  // Pulsación larga (2 s) sobre un cliente: abre la ficha.
  let largo = null, abierto = false;
  const lista = $('#lista-clientes');
  lista.onpointerdown = e => {
    const el = e.target.closest('[data-cliente]');
    if (!el || e.target.closest('[data-ficha]')) return;
    abierto = false;
    el.classList.add('pulsando');
    largo = setTimeout(() => { abierto = true; el.classList.remove('pulsando'); E.fichaCliente = Number(el.dataset.cliente); intentar(() => pintarFicha(E.fichaCliente)); }, PULSACION_FICHA_MS);
  };
  const soltar = () => { clearTimeout(largo); lista.querySelectorAll('.pulsando').forEach(x => x.classList.remove('pulsando')); };
  lista.onpointerup = soltar; lista.onpointerleave = soltar; lista.onpointercancel = soltar;
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.id === 'b-nuevo-cliente') return formCliente(null, async c => { if (E.cuenta && E.eligiendoCliente) return asignarCliente(c.id); E.qClientes = ''; return pintarClientes(); });
    if (e.target.id === 'b-quitar-cliente') return asignarCliente(null);
    if (e.target.id === 'b-volver-venta') { E.eligiendoCliente = false; const v = E.volverCobro; E.volverCobro = false; await ir('venta'); if (v && E.cuenta?.lineas.length) abrirCobro(); return; }
    const f = e.target.closest('[data-ficha]');
    if (f) { E.fichaCliente = Number(f.dataset.ficha); return pintarFicha(E.fichaCliente); }
    const c = e.target.closest('[data-cliente]');
    if (!c || abierto) return;
    if (E.cuenta) return asignarCliente(Number(c.dataset.cliente));
    E.fichaCliente = Number(c.dataset.cliente);
    return pintarFicha(E.fichaCliente);
  });
}

const fechaCorta = s => s ? hora(s).split(',')[0] : '—';

async function pintarFicha(id) {
  const q = new URLSearchParams();
  if (E.fichaDesde) q.set('desde', E.fichaDesde);
  if (E.fichaHasta) q.set('hasta', E.fichaHasta);
  const f = await api('GET', `/clientes/${id}/ficha?${q}`);
  const c = f.cliente, s = f.estadisticas;
  $('#vista').innerHTML = `<div class="informe scroll ficha">
    <div class="cab-config"><button data-volver-lista="1">← Clientes</button>
      <h2><i class="avatar">${esc(iniciales(c))}</i> ${esc(c.nombre)} ${esc(c.apellidos ?? '')}</h2>
      <div class="cab-acciones">${E.cuenta ? '<button class="primario" data-asignar="1">Asignar a la cuenta</button>' : ''}<button data-editar="1">Editar datos</button></div></div>
    <div class="ficha-datos">${[['NIF', c.nif], ['Teléfono', c.telefono], ['Email', c.email], ['Domicilio', [c.domicilio, c.cp, c.localidad, c.provincia].filter(Boolean).join(', ')], ['Observaciones', c.observaciones]]
      .filter(([, v]) => v).map(([k, v]) => `<span><small>${k}</small>${esc(v)}</span>`).join('') || '<span class="tenue">Sin datos fiscales. Edita el cliente para añadir NIF y domicilio.</span>'}</div>
    <div class="periodo">Periodo <input type="date" id="f-desde" value="${esc(E.fichaDesde ?? '')}"> a <input type="date" id="f-hasta" value="${esc(E.fichaHasta ?? '')}">
      <button id="b-periodo">Aplicar</button>${E.fichaDesde || E.fichaHasta ? '<button id="b-todo">Todo</button>' : ''}</div>
    <div class="cifras">
      <div class="cifra"><small>Visitas</small><b>${s.visitas}</b></div>
      <div class="cifra"><small>Total gastado</small><b>${euros(s.gastado)}</b></div>
      <div class="cifra"><small>Ticket medio</small><b>${euros(s.ticket_medio)}</b></div>
      <div class="cifra"><small>Primera visita</small><b>${fechaCorta(s.primera)}</b></div>
      <div class="cifra"><small>Última visita</small><b>${fechaCorta(s.ultima)}</b></div>
    </div>
    <section class="panel factura-caja">
      <div><b>Factura completa</b><br><small>${f.sin_facturar.tickets ? `${f.sin_facturar.tickets} tickets sin facturar en este periodo · ${euros(f.sin_facturar.total)}` : 'No hay tickets sin facturar en este periodo'}</small></div>
      <button class="primario" id="b-factura" ${f.sin_facturar.tickets ? '' : 'disabled'}>Hacer factura completa</button>
    </section>
    <div class="dos-col ficha-col">
      <section class="panel"><h3>Tickets</h3><table><thead><tr><th>Ticket</th><th>Fecha</th><th>Factura</th><th class="num">Total</th></tr></thead><tbody>
        ${f.tickets.map(t => `<tr class="clic ${t.anulado_por ? 'anulado' : ''}" data-ticket="${t.id}"><td>${esc(t.serie)}-${t.numero}${t.anula_ticket_id ? ' (anulación)' : ''}</td><td>${hora(t.emitido_en)}</td><td>${esc(t.factura ?? '')}</td><td class="num">${euros(t.total)}</td></tr>`).join('')
          || '<tr><td colspan="4" class="vacio">Sin tickets</td></tr>'}</tbody></table></section>
      <div>
        <section class="panel"><h3>Lo que más pide</h3><table><tbody>
          ${f.articulos.map(a => `<tr><td>${esc(a.nombre)}</td><td class="num">${uds(a.unidades)}</td><td class="num">${euros(a.total)}</td></tr>`).join('') || '<tr><td class="vacio">—</td></tr>'}</tbody></table></section>
        <section class="panel" style="margin-top:10px"><h3>Facturas completas</h3><table><tbody>
          ${f.facturas.map(x => `<tr class="clic" data-factura="${x.id}"><td><b>${esc(x.serie)}-${x.numero}</b></td><td>${fechaCorta(x.fecha)}</td><td class="num">${euros(x.total)}</td></tr>`).join('') || '<tr><td class="vacio">Sin facturas</td></tr>'}</tbody></table></section>
      </div>
    </div></div>`;
  $('#vista').onclick = e => intentar(async () => {
    if (e.target.closest('[data-volver-lista]')) { E.fichaCliente = null; return pintarClientes(); }
    if (e.target.closest('[data-asignar]')) { E.fichaCliente = null; return asignarCliente(id); }
    if (e.target.closest('[data-editar]')) return formCliente(c, () => pintarFicha(id));
    if (e.target.id === 'b-periodo') { E.fichaDesde = $('#f-desde').value || null; E.fichaHasta = $('#f-hasta').value || null; return pintarFicha(id); }
    if (e.target.id === 'b-todo') { E.fichaDesde = E.fichaHasta = null; return pintarFicha(id); }
    if (e.target.id === 'b-factura') {
      if (!confirm(`Se hará una factura completa a ${c.nombre} con ${f.sin_facturar.tickets} tickets (${euros(f.sin_facturar.total)}). Esos tickets quedarán sustituidos por la factura. ¿Seguir?`)) return;
      const fac = await api('POST', `/clientes/${id}/factura`, { desde: E.fichaDesde, hasta: E.fichaHasta });
      await pintarFicha(id);
      return verDocumentoA4(fac, 'Factura', `/facturas/${fac.id}/email`);
    }
    const t = e.target.closest('[data-ticket]');
    if (t) return verTicket(await api('GET', `/tickets/${t.dataset.ticket}`));
    const x = e.target.closest('[data-factura]');
    if (x) { const fac = await api('GET', `/facturas/${x.dataset.factura}`); return verDocumentoA4(fac, 'Factura', `/facturas/${fac.id}/email`); }
  });
}

// ---------- Stocks ----------
const numES = n => Number(n ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 3 });
const leerNum = s => Number(String(s ?? '').replace(',', '.'));

async function pintarStocks() {
  if (!moduloActivo('stocks')) return pantallaBloqueada('stocks', 'Stocks');
  const tab = E.tabStocks ?? 'existencias';
  if (tab === 'proveedores') { E.volverA = 'stocks'; E.tablaGestion = 'proveedores'; E.tabStocks = 'existencias'; return pintarGestion(); }
  const pestanas = `<div class="pestanas">${[['existencias', 'Existencias'], ['albaranes', 'Albaranes de compra'], ['proveedores', 'Proveedores']]
    .map(([k, t]) => `<button data-tab="${k}" class="${k === tab || (k === 'albaranes' && tab === 'nuevo_albaran') ? 'activa' : ''}">${t}</button>`).join('')}</div>`;
  if (tab === 'nuevo_albaran') return pintarNuevoAlbaran(pestanas);
  if (tab === 'albaranes') {
    const lista = await api('GET', '/stocks/albaranes');
    $('#vista').innerHTML = `<div class="informe scroll">${pestanas}
      <div><button class="primario" id="b-nuevo-albaran">＋ Nuevo albarán de compra</button></div>
      <section class="panel"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Nº albarán</th><th class="num">Líneas</th><th class="num">Total</th></tr></thead><tbody>
        ${lista.map(a => `<tr class="clic" data-albaran="${a.id}"><td>${esc(a.fecha.split('-').reverse().join('/'))}</td><td>${esc(a.proveedor)}</td><td>${esc(a.numero || '—')}</td><td class="num">${a.lineas}</td><td class="num">${euros(a.total)}</td></tr>`).join('')
          || '<tr><td colspan="5" class="vacio">Todavía no hay albaranes. Las compras suman al stock.</td></tr>'}</tbody></table></section></div>`;
  } else {
    const solo = E.stockSolo ?? true;
    const lista = await api('GET', `/stocks${solo ? '?solo=1' : ''}`);
    const q = (E.qStock ?? '').toLowerCase();
    const filas = lista.filter(a => !q || a.nombre.toLowerCase().includes(q) || (a.familia ?? '').toLowerCase().includes(q));
    const bajos = lista.filter(a => a.controlar_stock && a.stock <= a.stock_minimo).length;
    $('#vista').innerHTML = `<div class="informe scroll">${pestanas}
      <div class="clientes-barra"><input id="q-stock" type="search" placeholder="Buscar artículo o familia" value="${esc(E.qStock ?? '')}">
        <label class="chk"><input type="checkbox" id="solo-stock" ${solo ? 'checked' : ''}> Solo artículos con control de stock</label></div>
      ${bajos ? `<div class="aviso-licencia">${bajos} artículos agotados o por debajo del stock mínimo</div>` : ''}
      <section class="panel"><table><thead><tr><th>Artículo</th><th>Familia</th><th class="num">Stock</th><th class="num">Mínimo</th><th class="num">Coste</th><th class="num">Valor</th></tr></thead><tbody>
        ${filas.map(a => `<tr class="clic ${a.controlar_stock && a.stock <= a.stock_minimo ? 'bajo' : ''}" data-art="${a.id}"><td>${esc(a.nombre)}</td><td>${esc(a.familia ?? '')}</td>
          <td class="num"><b>${numES(a.stock)}</b></td><td class="num">${a.controlar_stock ? numES(a.stock_minimo) : '—'}</td><td class="num">${a.coste ? euros(a.coste) : '—'}</td><td class="num">${a.coste && a.stock > 0 ? euros(Math.round(a.coste * a.stock)) : '—'}</td></tr>`).join('')
          || `<tr><td colspan="6" class="vacio">${solo ? 'Ningún artículo controla stock todavía. Se activa solo al meter un albarán, o quita la marca para verlos todos.' : 'Sin artículos'}</td></tr>`}</tbody></table></section></div>`;
    let t;
    $('#q-stock').oninput = e => { E.qStock = e.target.value; clearTimeout(t); t = setTimeout(() => intentar(async () => { await pintarStocks(); const i = $('#q-stock'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 250); };
    $('#solo-stock').onchange = e => { E.stockSolo = e.target.checked; intentar(pintarStocks); };
  }
  $('#vista').onclick = e => intentar(async () => {
    const p = e.target.closest('[data-tab]');
    if (p) { E.tabStocks = p.dataset.tab; return pintarStocks(); }
    if (e.target.id === 'b-nuevo-albaran') { E.tabStocks = 'nuevo_albaran'; E.albaran = null; return pintarStocks(); }
    const a = e.target.closest('[data-albaran]');
    if (a) return verAlbaran(await api('GET', `/stocks/albaranes/${a.dataset.albaran}`));
    const r = e.target.closest('[data-art]');
    if (r) return verStockArticulo(Number(r.dataset.art));
  });
}

async function verStockArticulo(id) {
  const art = E.datos.articulos.find(a => a.id === id) ?? { nombre: 'Artículo' };
  const [lista, movs] = await Promise.all([api('GET', '/stocks'), api('GET', `/stocks/articulo/${id}`)]);
  const actual = lista.find(a => a.id === id)?.stock ?? 0;
  const TIPOS = { compra: 'Compra', venta: 'Venta', ajuste: 'Inventario' };
  abrirModal(`<h2><span>${esc(art.nombre)} · stock ${numES(actual)}</span><button data-m="cerrar">✕</button></h2>
    <div class="form" style="grid-template-columns:1fr 2fr auto;align-items:end">
      <label>Stock contado<input id="nuevo-stock" inputmode="decimal" value="${numES(actual)}"></label>
      <label>Nota<input id="nota-stock" placeholder="Inventario, rotura, consumo propio..."></label>
      <button class="primario" data-m="ajustar" style="padding:10px 16px">Ajustar</button>
    </div>
    <div class="scroll" style="max-height:50vh"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Nota</th><th class="num">Cantidad</th></tr></thead><tbody>
      ${movs.map(m => `<tr><td>${esc(String(m.fecha ?? '').slice(8, 10) + '/' + String(m.fecha ?? '').slice(5, 7) + ' ' + String(m.fecha ?? '').slice(11, 16))}</td><td>${TIPOS[m.tipo] ?? esc(m.tipo)}</td><td>${esc(m.nota ?? '')}</td><td class="num ${m.cantidad < 0 ? 'falta' : 'sobra'}">${m.cantidad > 0 ? '+' : ''}${numES(m.cantidad)}</td></tr>`).join('')
        || '<tr><td colspan="4" class="vacio">Sin movimientos</td></tr>'}</tbody></table></div>`);
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (b?.dataset.m === 'cerrar') return cerrarModal();
    if (b?.dataset.m === 'ajustar') {
      const r = await api('POST', '/stocks/ajuste', { articulo_id: id, stock: leerNum($('#nuevo-stock').value), nota: $('#nota-stock').value });
      aviso(r.diferencia ? `Stock ajustado (${r.diferencia > 0 ? '+' : ''}${numES(r.diferencia)})` : 'El stock ya era ese');
      cerrarModal();
      return pintarStocks();
    }
  });
}

function verAlbaran(a) {
  abrirModal(`<h2><span>Albarán ${esc(a.numero || a.id)} · ${esc(a.proveedor)}</span><button data-m="cerrar">✕</button></h2>
    <div style="padding:0 12px"><small class="tenue">${esc(a.fecha.split('-').reverse().join('/'))}${a.operario ? ' · ' + esc(a.operario) : ''}${a.notas ? ' · ' + esc(a.notas) : ''}</small></div>
    <table><thead><tr><th>Artículo</th><th class="num">Cantidad</th><th class="num">Coste</th><th class="num">Importe</th></tr></thead><tbody>
      ${a.lineas.map(l => `<tr><td>${esc(l.descripcion)}</td><td class="num">${numES(l.cantidad)}</td><td class="num">${euros(l.coste)}</td><td class="num">${euros(Math.round(l.cantidad * l.coste))}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total</b></td><td class="num"><b>${euros(a.total)}</b></td></tr></tbody></table>
    <div class="botones"><button data-m="cerrar">Cerrar</button></div>`);
  $('#modal-caja').onclick = e => { if (e.target.closest('[data-m="cerrar"]')) cerrarModal(); };
}

async function pintarNuevoAlbaran(pestanas) {
  const provs = await api('GET', '/gestion/proveedores');
  const al = E.albaran ??= { proveedor_id: provs[0]?.id ?? '', numero: '', fecha: hoyLocal(), notas: '', lineas: [] };
  const total = al.lineas.reduce((n, l) => n + Math.round(leerNum(l.cantidad) * Math.round(leerNum(l.coste) * 100)), 0);
  const arts = E.datos.articulos.filter(a => a.activo);
  $('#vista').innerHTML = `<div class="informe scroll">${pestanas}
    <h3>Nuevo albarán de compra</h3>
    ${provs.length ? '' : '<div class="aviso-licencia">Primero crea un proveedor en la pestaña Proveedores.</div>'}
    <div class="form albaran-cab" style="padding:0">
      <label>Proveedor<select data-al="proveedor_id">${provs.map(p => `<option value="${p.id}" ${p.id === Number(al.proveedor_id) ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>
      <label>Nº de albarán<input data-al="numero" value="${esc(al.numero)}"></label>
      <label>Fecha<input type="date" data-al="fecha" value="${esc(al.fecha)}"></label>
      <label>Notas<input data-al="notas" value="${esc(al.notas)}"></label>
    </div>
    <section class="panel"><table><thead><tr><th>Artículo</th><th class="num">Cantidad</th><th class="num">Coste unidad (€)</th><th class="num">Importe</th><th></th></tr></thead><tbody>
      ${al.lineas.map((l, i) => { const a = arts.find(x => x.id === l.articulo_id); return `<tr><td>${esc(a?.nombre ?? '')}</td>
        <td class="num"><input class="mini-num" data-l="${i}" data-k="cantidad" inputmode="decimal" value="${esc(l.cantidad)}"></td>
        <td class="num"><input class="mini-num" data-l="${i}" data-k="coste" inputmode="decimal" value="${esc(l.coste)}"></td>
        <td class="num">${euros(Math.round(leerNum(l.cantidad) * Math.round(leerNum(l.coste) * 100)))}</td><td><button data-quitar-l="${i}">✕</button></td></tr>`; }).join('')
        || '<tr><td colspan="5" class="vacio">Añade los artículos del albarán</td></tr>'}
      <tr><td><input id="buscar-art" list="lista-arts" placeholder="Escribe para añadir un artículo..." autocomplete="off" style="width:100%"><datalist id="lista-arts">${arts.map(a => `<option value="${esc(a.nombre)}">`).join('')}</datalist></td>
        <td colspan="2"></td><td class="num"><b>${euros(total)}</b></td><td></td></tr>
    </tbody></table></section>
    <div class="botones" style="padding:0"><button class="primario" id="b-guardar-albaran" ${al.lineas.length && provs.length ? '' : 'disabled'}>Guardar albarán (suma al stock)</button><button id="b-cancelar-albaran">Cancelar</button></div>
  </div>`;
  const v = $('#vista');
  v.oninput = e => {
    if (e.target.dataset.al) al[e.target.dataset.al] = e.target.value;
    if (e.target.dataset.l !== undefined) al.lineas[Number(e.target.dataset.l)][e.target.dataset.k] = e.target.value;
  };
  v.onchange = e => {
    if (e.target.dataset.l !== undefined) return pintarStocks();
    if (e.target.id === 'buscar-art') {
      const a = arts.find(x => x.nombre.toLowerCase() === e.target.value.trim().toLowerCase());
      if (!a) return aviso('Elige un artículo de la lista', true);
      e.target.value = '';
      const ya = al.lineas.find(l => l.articulo_id === a.id);
      if (ya) ya.cantidad = String(leerNum(ya.cantidad) + 1);
      else al.lineas.push({ articulo_id: a.id, cantidad: '1', coste: a.coste ? (a.coste / 100).toFixed(2).replace('.', ',') : '' });
      intentar(async () => { await pintarStocks(); $('#buscar-art')?.focus(); });
    }
  };
  v.onclick = e => intentar(async () => {
    const p = e.target.closest('[data-tab]');
    if (p) { E.tabStocks = p.dataset.tab; return pintarStocks(); }
    if (e.target.dataset.quitarL !== undefined) { al.lineas.splice(Number(e.target.dataset.quitarL), 1); return pintarStocks(); }
    if (e.target.id === 'b-cancelar-albaran') { E.albaran = null; E.tabStocks = 'albaranes'; return pintarStocks(); }
    if (e.target.id === 'b-guardar-albaran') {
      const r = await api('POST', '/stocks/albaranes', { ...al, proveedor_id: Number(al.proveedor_id),
        lineas: al.lineas.map(l => ({ articulo_id: l.articulo_id, cantidad: leerNum(l.cantidad), coste: Math.round(leerNum(l.coste) * 100) })) });
      E.albaran = null; E.tabStocks = 'albaranes';
      E.datos = await api('GET', '/inicio');
      aviso(`Albarán guardado: ${r.lineas.length} artículos suman al stock`);
      return pintarStocks();
    }
  });
}

// ---------- Peso ----------
// Artículo por peso: con balanza el peso vendrá de ella; sin balanza se escribe en pantalla (kg).
function pedirPeso(art) {
  return new Promise(resolve => {
    let txt = '';
    const kg = () => txt ? Number(txt.replace(',', '.')) : 0;
    const pintar = () => {
      abrirModal(`<h2><span>${esc(art.nombre)} · ${euros(art.precio)}/kg</span><button data-m="cerrar">✕</button></h2>
        <div class="peso">
          <div class="cc"><small>Peso</small><b>${txt ? esc(txt) : '0'} kg</b></div>
          <div class="cc"><small>Importe</small><b>${euros(Math.round(kg() * art.precio))}</b></div>
          <p class="tenue">${moduloActivo('balanza') ? 'La lectura de la balanza llega con la fase de periféricos: de momento escribe el peso.' : 'Sin balanza: escribe el peso en kilos (por ejemplo 0,350).'}</p>
          <div class="teclado">${['7', '8', '9', 'C', '4', '5', '6', '⌫', '1', '2', '3', '', '0', ',', '', ''].map(k => k ? `<button data-ct="${k}">${k}</button>` : '<span></span>').join('')}</div>
          <div class="botones" style="padding:0"><button class="primario" data-m="ok" ${kg() > 0 ? '' : 'disabled'}>Añadir</button><button data-m="cerrar">Cancelar</button></div>
        </div>`);
    };
    pintar();
    $('#modal-caja').onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.m === 'cerrar') { cerrarModal(); return resolve(null); }
      if (b.dataset.m === 'ok') { cerrarModal(); return resolve(kg()); }
      const k = b.dataset.ct;
      if (k === 'C') txt = '';
      else if (k === '⌫') txt = txt.slice(0, -1);
      else if (k === ',') { if (!txt.includes(',')) txt = (txt || '0') + ','; }
      else if (k && txt.length < 7 && !/,\d{3}$/.test(txt)) txt += k;
      pintar();
    };
  });
}

// ---------- Invitación ----------
async function invitarLinea(id) {
  const l = E.cuenta?.lineas.find(x => x.id === id);
  if (!l) return aviso('Toca primero la línea que quieres invitar', true);
  if (!tienePermiso('invitar')) return aviso('Tu operario no tiene permiso para invitar', true);
  if (l.invitacion) {
    if (!confirm(`¿Quitar la invitación de ${l.descripcion}? Vuelve a su precio.`)) return;
    E.cuenta = await api('POST', `/lineas/${id}/invitar`, { quitar: true });
    return pintarVenta();
  }
  let unidades = l.unidades;
  if (!l.por_peso && l.unidades > 1) {
    const r = prompt(`¿Cuántas unidades de ${l.descripcion} invitas? (hay ${uds(l.unidades)})`, '1');
    if (r === null) return;
    unidades = Number(r.replace(',', '.'));
  }
  E.cuenta = await api('POST', `/lineas/${id}/invitar`, { unidades });
  E.lineaSel = null;
  aviso(`Invitación: ${l.descripcion}`);
  return pintarVenta();
}

// ---------- Traspasar mesa ----------
// Origen: la cuenta en pantalla (o la mesa que se toque). Destino: otra mesa (si está ocupada se juntan),
// otra cuenta abierta o una cuenta nueva. Se puede pasar todo o solo algunos artículos.
async function abrirTraspaso(origenId) {
  const c = await api('GET', `/cuentas/${origenId}`);
  await cargarAbiertas();
  const sel = new Map();      // línea -> unidades a pasar
  let todo = true, destino = null, zonaId = c.zona_id;
  const nombreDestino = () => !destino ? '' : destino.mesa_id ? (E.datos.mesas.find(m => m.id === destino.mesa_id)?.nombre ?? '')
    : destino.cuenta_id ? nombreCuenta(E.abiertas.find(a => a.id === destino.cuenta_id) ?? {}) : 'Cuenta nueva';
  const pintar = () => {
    const zona = E.datos.zonas.find(z => z.id === zonaId);
    const libresYOcupadas = E.datos.mesas.filter(m => m.zona_id === zonaId);
    const abiertaDe = m => E.abiertas.find(a => a.mesa_id === m.id);
    abrirModal(`<h2><span>Traspasar ${esc(nombreCuenta(c))}</span><button data-m="cerrar">✕</button></h2>
      <div class="traspaso">
        <div>
          <div class="pestanas"><button data-todo="1" class="${todo ? 'activa' : ''}">Toda la cuenta</button><button data-todo="0" class="${todo ? '' : 'activa'}">Elegir artículos</button></div>
          <div class="lineas-traspaso">${c.lineas.map(l => { const n = sel.get(l.id) ?? 0; return `<button data-linea-t="${l.id}" class="${todo || n ? 'marcada' : ''}" ${todo ? 'disabled' : ''}>
            <span>${todo ? uds(l.unidades) : `${uds(n)} / ${uds(l.unidades)}`}</span><span>${esc(l.descripcion)}</span>${!todo && n ? `<i data-menos="${l.id}">−</i>` : ''}</button>`; }).join('')}</div>
          ${todo ? '' : '<small class="tenue">Cada toque pasa una unidad más; con − la devuelves.</small>'}
        </div>
        <div>
          <b>Destino</b>
          <div class="pestanas">${E.datos.zonas.map(z => `<button data-zona-t="${z.id}" class="${z.id === zonaId ? 'activa' : ''}">${esc(z.nombre)}</button>`).join('')}</div>
          <div class="destinos">
            ${zona?.tipo === 'mesas' ? libresYOcupadas.map(m => { const a = abiertaDe(m); const yo = a?.id === c.id;
              return `<button data-mesa-t="${m.id}" class="${a ? 'ocupada' : ''} ${destino?.mesa_id === m.id ? 'elegida' : ''}" ${yo ? 'disabled' : ''}><b>${esc(m.nombre)}</b><small>${yo ? 'Origen' : a ? euros(a.total) : 'Libre'}</small></button>`; }).join('')
              : `<button data-nueva-t="1" class="${destino?.nueva ? 'elegida' : ''}"><b>+ Cuenta nueva</b><small>${esc(zona?.nombre ?? '')}</small></button>
                 ${E.abiertas.filter(a => a.zona_id === zonaId && a.id !== c.id && !a.mesa_id).map(a => `<button data-cuenta-t="${a.id}" class="ocupada ${destino?.cuenta_id === a.id ? 'elegida' : ''}"><b>${esc(a.nombre || 'Cuenta ' + a.id)}</b><small>${euros(a.total)}</small></button>`).join('')}`}
          </div>
        </div>
      </div>
      <div class="botones"><button class="primario" data-m="ok" ${destino && (todo || sel.size) ? '' : 'disabled'}>Traspasar${destino ? ' a ' + esc(nombreDestino()) : ''}</button><button data-m="cerrar">Cancelar</button></div>`);
  };
  pintar();
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button,[data-menos]');
    if (!b) return;
    if (b.dataset.m === 'cerrar') return cerrarModal();
    if (b.dataset.todo) { todo = b.dataset.todo === '1'; return pintar(); }
    if (b.dataset.menos) { const id = Number(b.dataset.menos); const n = (sel.get(id) ?? 0) - 1; n > 0 ? sel.set(id, n) : sel.delete(id); e.stopPropagation(); return pintar(); }
    if (b.dataset.lineaT) {
      const l = c.lineas.find(x => x.id === Number(b.dataset.lineaT));
      const n = sel.get(l.id) ?? 0;
      sel.set(l.id, l.por_peso ? l.unidades : Math.min(l.unidades, n + 1));
      return pintar();
    }
    if (b.dataset.zonaT) { zonaId = Number(b.dataset.zonaT); return pintar(); }
    if (b.dataset.mesaT) { destino = { mesa_id: Number(b.dataset.mesaT) }; return pintar(); }
    if (b.dataset.nuevaT) { destino = { zona_id: zonaId, nueva: true }; return pintar(); }
    if (b.dataset.cuentaT) { destino = { cuenta_id: Number(b.dataset.cuentaT) }; return pintar(); }
    if (b.dataset.m === 'ok') {
      const nombre = nombreDestino();
      const r = await api('POST', `/cuentas/${c.id}/traspasar`, { ...destino, lineas: todo ? undefined : [...sel].map(([id, unidades]) => ({ id, unidades })) });
      cerrarModal();
      E.cuenta = r.destino; E.lineaSel = null;
      aviso(`Traspasado a ${nombre}`);
      comandaAutomatica(r.destino);
      return ir('venta');
    }
  });
}

// ---------- Dividir cuenta ----------
// Entre X personas (un ticket con X pagos) o pasando artículos a tickets nuevos que se cobran uno a uno,
// hasta cobrar el resto de la cuenta principal.
async function abrirDividir(origenId) {
  const c = await api('GET', `/cuentas/${origenId}`);
  if (c.estado !== 'abierta' || !c.lineas.length) { E.cuenta = null; return pintarVenta(); }
  let modo = E.modoDividir ?? 'articulos', personas = 2;
  const sel = new Map();
  const totalSel = () => c.lineas.reduce((n, l) => n + Math.round((sel.get(l.id) ?? 0) * l.precio), 0);
  const pintar = () => {
    abrirModal(`<h2><span>Dividir ${esc(nombreCuenta(c))} · ${euros(c.total)}</span><button data-m="cerrar">✕</button></h2>
      <div class="pestanas" style="padding:0 12px"><button data-modo="articulos" class="${modo === 'articulos' ? 'activa' : ''}">Por artículos</button><button data-modo="personas" class="${modo === 'personas' ? 'activa' : ''}">Entre personas</button></div>
      ${modo === 'personas' ? `<div class="dividir-personas">
          <div class="contador-personas"><button data-p="-1">−</button><b>${personas}</b><button data-p="1">+</button></div>
          <div class="cc"><small>Cada persona paga</small><b>${euros(Math.floor(c.total / personas))}</b></div>
          <p class="tenue">Se cobra en ${personas} pagos (cada uno con su forma de pago) y sale un solo ticket.</p>
        </div>
        <div class="botones"><button class="primario" data-m="personas">Cobrar entre ${personas}</button><button data-m="cerrar">Cancelar</button></div>`
      : `<div class="dividir">
          <div><b>Cuenta principal</b><small class="tenue"> · toca para pasar una unidad</small>
            <div class="lineas-traspaso">${c.lineas.map(l => { const queda = Math.round((l.unidades - (sel.get(l.id) ?? 0)) * 1000) / 1000;
              return queda > 0 ? `<button data-pasar="${l.id}"><span>${uds(queda)}</span><span>${esc(l.descripcion)}</span><span>${l.invitacion ? 'Inv.' : euros(Math.round(queda * l.precio))}</span></button>` : ''; }).join('')}</div>
            <div class="total-div">Queda ${euros(c.total - totalSel())}</div></div>
          <div><b>Ticket nuevo</b><small class="tenue"> · toca para devolver</small>
            <div class="lineas-traspaso">${[...sel].map(([id, n]) => { const l = c.lineas.find(x => x.id === id);
              return `<button data-devolver="${id}" class="marcada"><span>${uds(n)}</span><span>${esc(l.descripcion)}</span><span>${l.invitacion ? 'Inv.' : euros(Math.round(n * l.precio))}</span></button>`; }).join('') || '<div class="vacio">Pasa aquí lo que paga esta persona</div>'}</div>
            <div class="total-div"><b>${euros(totalSel())}</b></div></div>
        </div>
        <div class="botones"><button class="primario" data-m="parte" ${sel.size ? '' : 'disabled'}>Cobrar ticket nuevo · ${euros(totalSel())}</button>
          <button class="cobrar-resto" data-m="resto">Cobrar el resto · ${euros(c.total - totalSel())}</button><button data-m="cerrar">Cerrar</button></div>`}`);
  };
  pintar();
  const volver = async () => { const o = await api('GET', `/cuentas/${origenId}`).catch(() => null);
    E.cuenta = o?.estado === 'abierta' ? o : null; await pintarVenta(); if (E.cuenta?.lineas.length) return abrirDividir(origenId); };
  $('#modal-caja').onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.m === 'cerrar') return cerrarModal();
    if (b.dataset.modo) { modo = E.modoDividir = b.dataset.modo; return pintar(); }
    if (b.dataset.p) { personas = Math.max(2, Math.min(30, personas + Number(b.dataset.p))); return pintar(); }
    if (b.dataset.pasar) { const l = c.lineas.find(x => x.id === Number(b.dataset.pasar)); const n = sel.get(l.id) ?? 0;
      sel.set(l.id, l.por_peso ? l.unidades : Math.min(l.unidades, Math.round((n + Math.min(1, l.unidades - n)) * 1000) / 1000)); return pintar(); }
    if (b.dataset.devolver) { const id = Number(b.dataset.devolver); const l = c.lineas.find(x => x.id === id); const n = Math.round(((sel.get(id) ?? 0) - (l.por_peso ? l.unidades : 1)) * 1000) / 1000;
      n > 0 ? sel.set(id, n) : sel.delete(id); return pintar(); }
    if (b.dataset.m === 'personas') { cerrarModal(); E.cuenta = c; return abrirCobro({ partes: personas }); }
    if (b.dataset.m === 'resto') {
      cerrarModal();
      E.cuenta = c;
      // Lo que esté en el ticket nuevo sin cobrar se queda en la principal.
      return abrirCobro({ despues: null });
    }
    if (b.dataset.m === 'parte') {
      const r = await api('POST', `/cuentas/${origenId}/traspasar`, { nueva: true, nombre: `${c.mesa_nombre || c.nombre || 'Cuenta'} · parte`, lineas: [...sel].map(([id, unidades]) => ({ id, unidades })) });
      cerrarModal();
      E.cuenta = r.destino;
      // Si se cancela el cobro de la parte, sus artículos vuelven a la cuenta principal.
      return abrirCobro({
        alCancelar: async () => { await api('POST', `/cuentas/${r.destino.id}/traspasar`, { cuenta_id: origenId }); await volver(); },
        despues: volver,
      });
    }
  });
}

// ---------- Diseño de salas ----------
const PLANTILLAS_MESA = [
  ['Cuadrada 2', 'cuadrada', 2, 80, 80], ['Cuadrada 4', 'cuadrada', 4, 110, 110], ['Rectangular 6', 'rectangular', 6, 190, 105],
  ['Rectangular 8', 'rectangular', 8, 240, 110], ['Redonda 2', 'redonda', 2, 80, 80], ['Redonda 4', 'redonda', 4, 115, 115], ['Redonda 6', 'redonda', 6, 145, 145],
];
const COLORES_MESA = ['#ffffff', '#f4f6f8', '#e3edff', '#e6efe3', '#f3ead8', '#d9c3a5', '#3c3c3b', '#0b1527'];
const COLORES_LETRA = ['#3c3c3b', '#000000', '#ffffff', '#0064fc', '#0b1527', '#6f4e37', '#2e9d4f', '#c8443a'];
const COLORES_OBJETO = ['#8a6f55', '#6f4e37', '#4f8a3c', '#2a9d8f', '#9aa3ad', '#3c3c3b', '#0064fc', '#7a5c8f', '#c8443a', '#e0b84a'];
// Muestras de color del diseñador (data-c = campo del elemento elegido) y un selector libre.
const muestrasSala = (campo, actual, lista) => `<div class="muestras">${lista.map(c => `<button data-c="${campo}" data-v="${c}" style="background:${c}" class="${actual.toLowerCase() === c ? 'activa' : ''}"></button>`).join('')}
  <label class="otro-color" title="Otro color"><input type="color" data-c-libre="${campo}" value="${esc(actual)}"></label></div>`;
const COLORES_SALA = ['#ffffff', '#f4f6f8', '#f3ead8', '#e8dcc8', '#e6efe3', '#e3edff', '#f6e3e1', '#d9dee5'];

async function pintarDiseno() {
  const zonasMesas = E.datos.zonas.filter(z => z.tipo === 'mesas');
  if (!zonasMesas.length) { $('#vista').innerHTML = `<div class="config">${cabeceraConfig('Diseño de salas')}<div class="vacio">Crea primero una zona de tipo "Mesas" en Zonas.</div></div>`;
    $('#vista').onclick = e => { if (e.target.closest('[data-volver]')) ir(E.volverA || 'config'); }; return; }
  if (!zonasMesas.some(z => z.id === E.zonaDiseno)) E.zonaDiseno = zonasMesas[0].id;
  const p = await api('GET', `/zonas/${E.zonaDiseno}/plano`);
  const D = { zona: p.zona, color: p.zona.color_fondo || '#ffffff', mesas: colocar(p.mesas.map(m => ({ ...m }))), objetos: p.objetos.map(o => ({ ...o })), sel: null, cambios: false };
  E.diseno = D;
  const elegido = () => D.sel ? (D.sel.t === 'm' ? D.mesas : D.objetos)[D.sel.i] : null;
  const siguienteNombre = () => (String(D.mesas.at(-1)?.nombre ?? '').match(/^\D*/)?.[0] ?? '') + (Math.max(0, ...D.mesas.map(m => parseInt(String(m.nombre).replace(/\D/g, '')) || 0)) + 1);
  const pintar = () => {
    const x = elegido();
    const H = altoLienzo(D.mesas, D.objetos);
    $('#vista').innerHTML = `<div class="diseno">
      <div class="diseno-cab">${cabeceraConfig('Diseño de salas')}
        <div class="pestanas">${zonasMesas.map(z => `<button data-zona-d="${z.id}" class="${z.id === D.zona.id ? 'activa' : ''}">${esc(z.nombre)}</button>`).join('')}</div>
        <div class="diseno-guardar"><button class="primario" data-d="guardar" ${D.cambios ? '' : 'disabled'}>Guardar</button><button data-d="deshacer" ${D.cambios ? '' : 'disabled'}>Descartar cambios</button></div>
      </div>
      <div class="diseno-cuerpo">
        <aside class="diseno-panel">
          <h4>Fondo de la sala</h4>
          <div class="muestras">${COLORES_SALA.map(c => `<button data-color="${c}" style="background:${c}" class="${D.color === c ? 'activa' : ''}"></button>`).join('')}<label class="otro-color" title="Otro color"><input type="color" data-color-libre value="${esc(D.color)}"></label></div>
          <h4>Añadir mesa</h4>
          <div class="paleta">${PLANTILLAS_MESA.map(([t, f, n, w, h], i) => `<button data-plantilla="${i}"><span class="mini-mesa">${svgMesa({ forma: f, plazas: n, ancho: w, alto: h })}</span>${t}</button>`).join('')}</div>
          <h4>Añadir objeto</h4>
          <div class="paleta">${Object.entries(OBJETOS_SALA).map(([k, o]) => `<button data-objeto="${k}"><span class="mini-mesa">${svgObjeto({ tipo: k, ancho: o.w, alto: o.h })}</span>${o.nombre}</button>`).join('')}</div>
        </aside>
        <div class="diseno-lienzo">
          <div class="lienzo editable" id="lienzo" style="aspect-ratio:1000/${H};background:${esc(D.color)}">
            ${D.objetos.map((o, i) => `<div class="obj obj-${o.tipo} ${D.sel?.t === 'o' && D.sel.i === i ? 'sel' : ''}" data-el="o${i}" style="${caja(o, H)}">${svgObjeto(o)}${D.sel?.t === 'o' && D.sel.i === i ? '<i class="tirador" data-tirador="1"></i>' : ''}</div>`).join('')}
            ${D.mesas.map((m, i) => `<div class="mesa-plano libre ${D.sel?.t === 'm' && D.sel.i === i ? 'sel' : ''}" data-el="m${i}" style="${caja(m, H)}">${svgMesa(m)}${textoMesa(m)}${D.sel?.t === 'm' && D.sel.i === i ? '<i class="tirador" data-tirador="1"></i>' : ''}</div>`).join('')}
          </div>
          <small class="tenue">Arrastra para mover; el cuadradito azul de la esquina cambia el tamaño.</small>
        </div>
        <aside class="diseno-panel">
          ${x ? (D.sel.t === 'm' ? `<h4>Mesa</h4>
              <label>Nombre<input data-campo="nombre" value="${esc(x.nombre)}"></label>
              <label>Forma<select data-campo="forma">${OPCIONES.formamesa.map(([v, t]) => `<option value="${v}" ${x.forma === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
              <div class="fila-ctrl"><span>Comensales</span><button data-d="plazas-">−</button><b>${x.plazas}</b><button data-d="plazas+">+</button></div>
              <h4>Color de la mesa</h4>${muestrasSala('color_fondo', x.color_fondo || '#ffffff', COLORES_MESA)}
              <h4>Color de la letra</h4>${muestrasSala('color_texto', x.color_texto || '#3c3c3b', COLORES_LETRA)}
              <div class="fila-ctrl"><span>Letra ${x.letra || 100} %</span><button data-d="letra-">−</button><button data-d="letra+">+</button></div>
              <button data-d="a-todas">Aplicar colores y letra a todas las mesas</button>`
            : `<h4>${OBJETOS_SALA[x.tipo].nombre}</h4><h4>Color</h4>${muestrasSala('color', x.color || COLOR_OBJETO[x.tipo], COLORES_OBJETO)}`) + `
              <div class="fila-ctrl"><span>Tamaño</span><button data-d="menor">−</button><button data-d="mayor">+</button></div>
              <button data-d="girar">↻ Girar (horizontal / vertical)</button>
              <button data-d="duplicar">Duplicar</button>
              <button class="peligro" data-d="quitar">Quitar</button>`
            : '<p class="tenue">Toca una mesa u objeto para cambiarlo. Añade mesas y objetos desde la izquierda.</p>'}
          <p class="tenue" style="margin-top:14px">${D.mesas.length} mesas · ${D.mesas.reduce((n, m) => n + m.plazas, 0)} comensales</p>
        </aside>
      </div></div>`;
  };
  const cambio = () => { D.cambios = true; };
  const anadir = (t, el) => { const n = (t === 'm' ? D.mesas : D.objetos); n.push(el); D.sel = { t, i: n.length - 1 }; cambio(); pintar(); };
  pintar();
  const v = $('#vista');
  v.onclick = e => intentar(async () => {
    const b = e.target.closest('button');
    if (e.target.closest('[data-volver]')) {
      if (D.cambios && !confirm('Hay cambios sin guardar. ¿Salir sin guardar?')) return;
      return ir(E.volverA || 'config');
    }
    if (!b) return;
    if (b.dataset.zonaD) {
      if (D.cambios && !confirm('Hay cambios sin guardar. ¿Cambiar de zona sin guardar?')) return;
      E.zonaDiseno = Number(b.dataset.zonaD); return pintarDiseno();
    }
    if (b.dataset.color) { D.color = b.dataset.color; cambio(); return pintar(); }
    if (b.dataset.c && elegido()) { elegido()[b.dataset.c] = b.dataset.v; cambio(); return pintar(); }
    if (b.dataset.plantilla) {
      const [, forma, plazas, ancho, alto] = PLANTILLAS_MESA[Number(b.dataset.plantilla)];
      const k = D.mesas.length % 8;
      return anadir('m', { nombre: siguienteNombre(), forma, plazas, ancho, alto, px: 40 + k * 20, py: 40 + k * 20 });
    }
    // Los objetos nuevos aparecen abajo, donde suele haber sitio libre, para no quedar debajo de una mesa.
    if (b.dataset.objeto) { const o = OBJETOS_SALA[b.dataset.objeto]; const H = altoLienzo(D.mesas, D.objetos); const k = D.objetos.length % 6;
      return anadir('o', { tipo: b.dataset.objeto, ancho: o.w, alto: o.h, px: 380 + k * 30, py: Math.max(0, H - o.h - 40 - k * 20) }); }
    const x = elegido();
    switch (b.dataset.d) {
      case 'guardar': {
        const r = await api('PUT', `/zonas/${D.zona.id}/plano`, { color_fondo: D.color, mesas: D.mesas, objetos: D.objetos });
        await cargarDatos();
        aviso(`Sala guardada: ${r.mesas.length} mesas`);
        return pintarDiseno();
      }
      case 'deshacer': return pintarDiseno();
      case 'plazas-': x.plazas = Math.max(1, x.plazas - 1); break;
      case 'plazas+': x.plazas = Math.min(20, x.plazas + 1); break;
      case 'menor': case 'mayor': {
        const f = b.dataset.d === 'mayor' ? 1.12 : 1 / 1.12;
        x.ancho = Math.max(D.sel.t === 'm' ? 50 : 10, Math.min(600, Math.round(x.ancho * f)));
        x.alto = Math.max(D.sel.t === 'm' ? 50 : 10, Math.min(600, Math.round(x.alto * f)));
        break;
      }
      case 'girar': [x.ancho, x.alto] = [x.alto, x.ancho]; break;
      case 'letra-': x.letra = Math.max(50, (x.letra || 100) - 10); break;
      case 'letra+': x.letra = Math.min(300, (x.letra || 100) + 10); break;
      case 'a-todas': for (const m of D.mesas) Object.assign(m, { color_fondo: x.color_fondo || '', color_texto: x.color_texto || '', letra: x.letra || 100 }); aviso('Aplicado a todas las mesas de la zona'); break;
      case 'duplicar': return anadir(D.sel.t, { ...x, id: undefined, nombre: D.sel.t === 'm' ? siguienteNombre() : undefined, px: Math.min(980, x.px + 25), py: x.py + 25 });
      case 'quitar': (D.sel.t === 'm' ? D.mesas : D.objetos).splice(D.sel.i, 1); D.sel = null; break;
      default: return;
    }
    cambio(); pintar();
  });
  v.onchange = e => {
    const x = elegido();
    if (e.target.dataset.colorLibre !== undefined) { D.color = e.target.value; cambio(); return pintar(); }
    if (x && e.target.dataset.cLibre) { x[e.target.dataset.cLibre] = e.target.value; cambio(); return pintar(); }
    if (x && e.target.dataset.campo) { x[e.target.dataset.campo] = e.target.value; if (e.target.dataset.campo === 'forma' && x.forma === 'redonda') x.alto = x.ancho; cambio(); pintar(); }
  };
  // Arrastrar para mover y el tirador de la esquina para cambiar el tamaño (en unidades del lienzo, con imán de 5).
  v.onpointerdown = e => {
    const el = e.target.closest('[data-el]');
    if (!el || !e.target.closest('#lienzo')) return;
    const t = el.dataset.el[0], i = Number(el.dataset.el.slice(1));
    const x = (t === 'm' ? D.mesas : D.objetos)[i];
    const tirador = !!e.target.closest('[data-tirador]');
    const lienzo = $('#lienzo'), u = lienzo.clientWidth / 1000;
    const H = altoLienzo(D.mesas, D.objetos);
    const ini = { cx: e.clientX, cy: e.clientY, px: x.px, py: x.py, w: x.ancho, h: x.alto };
    let movido = false;
    if (!(D.sel?.t === t && D.sel.i === i)) { D.sel = { t, i }; pintar(); }
    const nodo = () => $(`#lienzo [data-el="${t}${i}"]`);
    const imán = n => Math.round(n / 5) * 5;
    const mover = ev => {
      const dx = (ev.clientX - ini.cx) / u, dy = (ev.clientY - ini.cy) / u;
      if (!movido && Math.abs(dx) + Math.abs(dy) < 3) return;
      movido = true;
      if (tirador) {
        x.ancho = Math.max(t === 'm' ? 50 : 10, imán(ini.w + dx));
        x.alto = x.forma === 'redonda' ? x.ancho : Math.max(t === 'm' ? 50 : 10, imán(ini.h + dy));
      } else {
        x.px = Math.max(0, Math.min(1000 - x.ancho, imán(ini.px + dx)));
        x.py = Math.max(0, imán(ini.py + dy));
      }
      const n = nodo();
      if (n) { n.style.cssText = caja(x, H); if (tirador && t === 'm') n.querySelector('svg').outerHTML = svgMesa(x); }
    };
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); if (movido) { cambio(); pintar(); } };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    e.preventDefault();
  };
}
