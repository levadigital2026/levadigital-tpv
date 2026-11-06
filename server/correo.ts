// Envío de correos (tickets, facturas y cierres) con el servidor SMTP configurado en el puesto. Sin dependencias.
import { connect as conectarTcp, type Socket } from 'node:net';
import { connect as conectarTls, type TLSSocket } from 'node:tls';
import type { DB } from './db.ts';
import { ErrorTPV, contexto, verCierre } from './ventas.ts';

type Row = Record<string, any>;
export type ConfigCorreo = { servidor: string; puerto: number; cifrado: 'ninguno' | 'tls' | 'ssl'; usuario: string; clave: string; emisor: string };
export type Mensaje = { para: string[]; asunto: string; html: string };

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function listaEmails(s: string) {
  const l = String(s ?? '').split(/[;,\s]+/).map(x => x.trim()).filter(Boolean);
  const malo = l.find(x => !EMAIL.test(x));
  if (malo) throw new ErrorTPV(`Dirección de correo no válida: ${malo}`);
  return l;
}

// Conversación SMTP mínima: EHLO, STARTTLS, AUTH LOGIN, MAIL, RCPT, DATA, QUIT.
export function enviarCorreo(cfg: ConfigCorreo, m: Mensaje): Promise<void> {
  return new Promise((resolve, reject) => {
    let sock: Socket | TLSSocket;
    let buf = '';
    let espera: ((r: { codigo: number; texto: string }) => void) | null = null;
    const fin = (e?: Error) => { clearTimeout(t); try { sock.destroy(); } catch {} ; e ? reject(e) : resolve(); };
    const t = setTimeout(() => fin(new ErrorTPV('El servidor de correo no responde')), 20000);
    const alLeer = (d: Buffer) => {
      buf += d.toString('utf8');
      // Una respuesta termina en una línea "NNN texto" (las de en medio son "NNN-texto").
      const lineas = buf.split('\r\n');
      for (let i = 0; i < lineas.length - 1; i++) {
        if (/^\d{3} /.test(lineas[i])) {
          const texto = lineas.slice(0, i + 1).join('\n');
          buf = lineas.slice(i + 1).join('\r\n');
          const cb = espera; espera = null;
          cb?.({ codigo: Number(lineas[i].slice(0, 3)), texto });
          return;
        }
      }
    };
    const leer = () => new Promise<{ codigo: number; texto: string }>(r => { espera = r; if (buf) alLeer(Buffer.alloc(0)); });
    const enviar = async (linea: string, ok: number[]) => {
      sock.write(linea + '\r\n');
      const r = await leer();
      if (!ok.includes(r.codigo)) throw new ErrorTPV(`El servidor de correo dice: ${r.texto.split('\n').pop()}`);
      return r;
    };
    const engancha = (s: Socket | TLSSocket) => { s.on('data', alLeer); s.on('error', e => fin(new ErrorTPV(`No se pudo conectar con el servidor de correo: ${e.message}`))); };
    const conversar = async () => {
      try {
        let r = await leer();
        if (r.codigo !== 220) throw new ErrorTPV('El servidor de correo no acepta la conexión');
        r = await enviar('EHLO tpv.levadigital', [250]);
        if (cfg.cifrado === 'tls') {
          await enviar('STARTTLS', [220]);
          sock.removeAllListeners('data');
          sock = conectarTls({ socket: sock as Socket, servername: cfg.servidor });
          engancha(sock);
          await new Promise<void>((ok, ko) => { (sock as TLSSocket).once('secureConnect', ok); sock.once('error', ko); });
          r = await enviar('EHLO tpv.levadigital', [250]);
        }
        if (cfg.usuario) {
          await enviar('AUTH LOGIN', [334]);
          await enviar(Buffer.from(cfg.usuario).toString('base64'), [334]);
          await enviar(Buffer.from(cfg.clave).toString('base64'), [235]);
        }
        await enviar(`MAIL FROM:<${cfg.emisor}>`, [250]);
        for (const p of m.para) await enviar(`RCPT TO:<${p}>`, [250, 251]);
        await enviar('DATA', [354]);
        await enviar(componer(cfg.emisor, m).replace(/\r\n\./g, '\r\n..') + '\r\n.', [250]);
        sock.write('QUIT\r\n');
        fin();
      } catch (e: any) { fin(e instanceof ErrorTPV ? e : new ErrorTPV(String(e?.message ?? e))); }
    };
    sock = cfg.cifrado === 'ssl'
      ? conectarTls({ host: cfg.servidor, port: cfg.puerto, servername: cfg.servidor })
      : conectarTcp({ host: cfg.servidor, port: cfg.puerto });
    engancha(sock);
    conversar();
  });
}

const cab = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
function componer(de: string, m: Mensaje) {
  const cuerpo = Buffer.from(m.html).toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return [`From: ${de}`, `To: ${m.para.join(', ')}`, `Subject: ${cab(m.asunto)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@tpv.levadigital>`, 'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', cuerpo].join('\r\n');
}

// Configuración de correo del puesto que hace la petición (o del primero que la tenga).
export function configPuesto(db: DB) {
  const p = (contexto.puesto ? db.prepare("SELECT * FROM puestos WHERE id = ? AND smtp_servidor <> ''").get(contexto.puesto) : undefined) as Row | undefined
    ?? db.prepare("SELECT * FROM puestos WHERE smtp_servidor <> '' ORDER BY orden, id LIMIT 1").get() as Row | undefined;
  if (!p) throw new ErrorTPV('Falta configurar el correo en Configuración > Local > Puestos (servidor SMTP)');
  if (!p.email_emisor) throw new ErrorTPV('Falta el email emisor en la configuración de correo del puesto');
  return { puesto: p, cfg: { servidor: p.smtp_servidor, puerto: p.smtp_puerto || 587, cifrado: p.smtp_cifrado || 'tls', usuario: p.smtp_usuario, clave: p.smtp_clave, emisor: p.email_emisor } as ConfigCorreo };
}

// ---- Contenido de los correos ----
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const eur = (c: number) => (c / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const fecha = (iso: string) => new Date(iso.includes('T') ? iso : iso.replace(' ', 'T')).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
const parrafos = (s: string) => s ? `<p>${esc(s).replace(/\n/g, '<br>')}</p>` : '';

// Documento (ticket o factura) en formato A4 para el correo.
export function htmlDocumento(d: Row, titulo: string) {
  const e = d.empresa, c = d.cliente;
  return `<div style="font-family:Arial,sans-serif;max-width:720px;color:#222">
    <table style="width:100%"><tr><td><b style="font-size:18px">${esc(e.nombre)}</b><br>${esc(e.direccion)}${e.localidad ? '<br>' + esc(e.localidad) : ''}${e.nif ? '<br>NIF ' + esc(e.nif) : ''}</td>
      <td style="text-align:right"><b style="font-size:18px">${esc(titulo)}</b><br>Nº ${esc(d.serie)}-${d.numero}<br>${fecha(d.emitido_en ?? d.fecha)}</td></tr></table>
    ${c ? `<div style="margin:14px 0;padding:10px;border:1px solid #ccc"><b>Cliente:</b> ${esc(c.nombre)}<br>${c.nif ? 'NIF ' + esc(c.nif) + '<br>' : ''}${esc(c.domicilio)} ${esc(c.localidad)}</div>` : ''}
    <table style="width:100%;border-collapse:collapse;margin-top:10px">
      <tr style="background:#0b1527;color:#fff"><th style="text-align:left;padding:6px">Descripción</th><th style="padding:6px">Uds.</th><th style="text-align:right;padding:6px">Precio</th><th style="padding:6px">IVA</th><th style="text-align:right;padding:6px">Importe</th></tr>
      ${d.lineas.map((l: Row) => `<tr style="border-bottom:1px solid #eee"><td style="padding:6px">${esc(l.descripcion)}</td><td style="text-align:center">${l.unidades}</td><td style="text-align:right">${eur(l.precio)}</td><td style="text-align:center">${l.iva}%</td><td style="text-align:right;padding:6px">${eur(l.importe)}</td></tr>`).join('')}
    </table>
    <table style="margin:12px 0 0 auto">${d.impuestos.map((i: Row) => `<tr><td>Base ${i.iva}%</td><td style="text-align:right;padding-left:20px">${eur(i.base)}</td><td style="padding-left:20px">IVA</td><td style="text-align:right;padding-left:10px">${eur(i.cuota)}</td></tr>`).join('')}
      <tr><td colspan="3"><b style="font-size:18px">TOTAL</b></td><td style="text-align:right"><b style="font-size:18px">${eur(d.total)}</b></td></tr></table>
    ${d.tickets ? `<p style="font-size:12px;color:#666">Esta factura sustituye a las facturas simplificadas: ${d.tickets.map((t: Row) => esc(t.serie + '-' + t.numero)).join(', ')}</p>` : ''}
  </div>`;
}

export async function enviarDocumento(db: DB, d: Row, titulo: string, para?: string) {
  const { puesto, cfg } = configPuesto(db);
  const destinos = listaEmails(para || d.cliente?.email || '');
  if (!destinos.length) throw new ErrorTPV('Escribe a qué correo se envía');
  const asunto = (puesto.email_asunto || `${titulo} ${d.serie}-${d.numero} · ${d.empresa.nombre}`).replace('{numero}', `${d.serie}-${d.numero}`);
  await enviarCorreo(cfg, { para: destinos, asunto, html: parrafos(puesto.email_encabezado) + htmlDocumento(d, titulo) + parrafos(puesto.email_pie) });
  return { enviado: true, para: destinos };
}

export async function enviarPrueba(db: DB, para?: string) {
  const { cfg, puesto } = configPuesto(db);
  const destinos = listaEmails(para || puesto.email_cierre || cfg.emisor);
  await enviarCorreo(cfg, { para: destinos, asunto: 'Prueba de correo del TPV LevaDigital', html: '<p>Si te llega este correo, el envío desde el TPV funciona.</p>' });
  return { enviado: true, para: destinos };
}

// Resumen del cierre de caja por correo (si el puesto lo tiene activado).
export async function enviarCierre(db: DB, cierreId: number) {
  const c = verCierre(db, cierreId, true) as Row;
  const p = contexto.puesto ? db.prepare('SELECT * FROM puestos WHERE id = ?').get(contexto.puesto) as Row | undefined : undefined;
  if (!p?.mail_en_cierre || !p.email_cierre || !p.smtp_servidor) return false;
  const e = db.prepare('SELECT nombre FROM empresa WHERE id = 1').get() as Row;
  const filas = (l: [string, string][]) => l.map(([a, b]) => `<tr><td style="padding:3px 12px 3px 0">${esc(a)}</td><td style="text-align:right">${esc(b)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif"><h2>Cierre de caja nº ${c.id} · ${esc(e.nombre)}</h2>
    <table>${filas([['Total', eur(c.total)], ['Tickets', String(c.tickets)], ['Ticket medio', eur(c.ticket_medio)], ...c.por_forma.map((f: Row) => [f.nombre, eur(f.total)] as [string, string])])}</table>
    <h3>Cuadre</h3><table>${filas(c.cuadre.map((f: Row) => [`${f.nombre}: debería ${eur(f.esperado)}, contado ${f.contado === null ? '—' : eur(f.contado)}`, f.diferencia === null ? '' : f.diferencia === 0 ? 'Cuadra' : eur(f.diferencia)] as [string, string]))}</table>
    <h3>10 artículos más vendidos</h3><table>${filas(c.articulos.map((a: Row) => [a.nombre, `${a.unidades} · ${eur(a.total)}`] as [string, string]))}</table>
    <p>Borrados: ${c.borrados.cuentas} cuentas y ${c.borrados.lineas} líneas (${eur(c.borrados.importe)}). Anulaciones: ${c.anulaciones.tickets} (${eur(c.anulaciones.total)}).</p></div>`;
  await enviarCorreo({ servidor: p.smtp_servidor, puerto: p.smtp_puerto || 587, cifrado: p.smtp_cifrado || 'tls', usuario: p.smtp_usuario, clave: p.smtp_clave, emisor: p.email_emisor },
    { para: listaEmails(p.email_cierre), asunto: `Cierre de caja ${c.id} · ${e.nombre}`, html });
  return true;
}
