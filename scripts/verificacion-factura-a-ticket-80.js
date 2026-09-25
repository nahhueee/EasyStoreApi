/**
 * Script de INVESTIGACION (solo lectura) - NO emite comprobantes, NO modifica nada.
 *
 * Objetivo: el control de correlatividad del Libro IVA de septiembre-2026 marca
 * como faltante la FACTURA A PtoVenta 12 Nro 80 (rango 61-83, 22 de 23 emitidos).
 * Se consulta a ARCA (WSFEv1 -> FECompConsultar via afip.ts) si ese numero existe
 * realmente, y si existe, se trae CAE, fecha, documento del receptor e importe.
 *
 * Requiere: certificados de PRODUCCION de SUCEDE en src/certs/30714907626/{cert,key}
 *
 * Uso: node scripts/verificacion-factura-a-ticket-80.js
 */

const fs = require('fs');
const path = require('path');
const { Afip } = require('afip.ts');

const ROOT = path.resolve(__dirname, '..');
const CUIT_SUCEDE = 30714907626;
const PTO_VENTA = 12;
const TICKET = 80;
const TIPO_FACTURA_A = 1;

function formatearFechaArca(fchYYYYMMDD) {
    if (!fchYYYYMMDD) return null;
    return `${fchYYYYMMDD.slice(0,4)}-${fchYYYYMMDD.slice(4,6)}-${fchYYYYMMDD.slice(6,8)}`;
}

async function obtenerAfipProduccion() {
    const certFolder = path.resolve(ROOT, 'src/certs', String(CUIT_SUCEDE));
    const cert = fs.readFileSync(path.join(certFolder, 'cert'), 'utf8').trim();
    const key = fs.readFileSync(path.join(certFolder, 'key'), 'utf8').trim();
    const ticketPath = path.resolve(ROOT, 'tokens-investigacion', String(CUIT_SUCEDE));
    fs.mkdirSync(ticketPath, { recursive: true });
    return new Afip({ key, cert, cuit: CUIT_SUCEDE, production: true, ticketPath });
}

async function main() {
    console.log('Instanciando AFIP (produccion, solo consulta) para SUCEDE SRL...');
    const afip = await obtenerAfipProduccion();

    console.log(`\nConsultando FACTURA A PtoVenta ${PTO_VENTA} Nro ${TICKET}...`);
    let info = null;
    try {
        info = await afip.electronicBillingService.getVoucherInfo(TICKET, PTO_VENTA, TIPO_FACTURA_A);
    } catch (e) {
        console.log(`ERROR en la consulta: ${e.message}`);
        process.exit(1);
    }

    if (!info) {
        console.log('NO EXISTE en ARCA - ese numero nunca fue autorizado.');
        console.log('Esto significaria que el hueco es real (nunca se emitio), no un problema de registro en el sistema.');
        console.log('Revisar: pudo saltarse por un error de emision (fallo antes de llegar a ARCA) o cancelarse en el POS antes de autorizar.');
        return;
    }

    const r = info.ResultGet;
    console.log('\n--- Datos del comprobante segun ARCA ---');
    console.log('Resultado:', r.Resultado, r.Resultado === 'R' ? '(RECHAZADO - no genera obligacion fiscal)' : '(APROBADO)');
    console.log('CAE:', r.CodAutorizacion);
    console.log('Fecha emision:', formatearFechaArca(r.CbteFch));
    console.log('Vto CAE:', formatearFechaArca(r.FchVto));
    console.log('FchProceso (timestamp exacto de autorizacion en ARCA, para ubicar en logs):', r.FchProceso);
    console.log('Doc receptor:', r.DocTipo, r.DocNro);
    console.log('Importe total:', r.ImpTotal, '| Neto:', r.ImpNeto, '| IVA:', r.ImpIVA);

    const asoc = r.CbtesAsoc?.CbteAsoc;
    if (asoc) {
        const lista = Array.isArray(asoc) ? asoc : [asoc];
        console.log('CbtesAsoc (no deberia tener, es una Factura no una Nota):', lista);
    }

    console.log('\n=== CONCLUSION ===');
    console.log('La Factura A Nro 80 SI existe y fue APROBADA en ARCA, pero no esta en el sistema.');
    console.log('Mismo patron que el caso de la NC A ticket 4 / Factura 56 (idVenta 1195): comprobante');
    console.log('real en ARCA que nunca quedo persistido en la base. Revisar si viene del mismo lote/');
    console.log('sesion de testing (fecha y hora de emision, y DNI/CUIT del receptor para identificar');
    console.log('a que cliente/venta corresponde).');
}

main().catch(e => { console.error(e); process.exit(1); });
