/**
 * Script de INVESTIGACION (solo lectura) - NO emite comprobantes, NO modifica nada.
 *
 * Objetivo: verificar contra ARCA (WSFEv1 -> FECompConsultar via afip.ts) si la
 * Nota de Credito A PtoVenta 12 Nro 4 (segun dato del cliente) existe realmente,
 * y si su CbtesAsoc apunta efectivamente a la Factura A PtoVenta 12 Nro 56
 * (idVenta 1195), que en el sistema no tiene ninguna NC registrada ni en
 * `ventas` ni en `ventas_factura`.
 *
 * Requiere: certificados de PRODUCCION de SUCEDE en src/certs/30714907626/{cert,key}
 *
 * Uso: node scripts/verificacion-nc-a-venta-1195.js
 */

const fs = require('fs');
const path = require('path');
const { Afip } = require('afip.ts');

const ROOT = path.resolve(__dirname, '..');
const CUIT_SUCEDE = 30714907626;
const PTO_VENTA = 12;

const NC_A_TICKET = 4;      // dato del cliente
const NC_A_TIPO = 3;        // TipoComprobante.NC_A

const FACTURA_ESPERADA = { tipo: 1, ptoVenta: 12, numero: 56 }; // Factura A / idVenta 1195

function formatearFechaArca(fchYYYYMMDD) {
    if (!fchYYYYMMDD) return '';
    return `${fchYYYYMMDD.slice(6, 8)}/${fchYYYYMMDD.slice(4, 6)}/${fchYYYYMMDD.slice(0, 4)}`;
}

async function obtenerAfipProduccion() {
    const certFolder = path.resolve(ROOT, 'src/certs', String(CUIT_SUCEDE));
    const certPath = path.join(certFolder, 'cert');
    const keyPath = path.join(certFolder, 'key');

    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        throw new Error(`No se encontraron los certificados de produccion en ${certFolder}`);
    }

    const cert = fs.readFileSync(certPath, 'utf8').trim();
    const key = fs.readFileSync(keyPath, 'utf8').trim();

    const ticketPath = path.resolve(ROOT, 'tokens-investigacion', String(CUIT_SUCEDE));
    fs.mkdirSync(ticketPath, { recursive: true });

    return new Afip({
        key,
        cert,
        cuit: CUIT_SUCEDE,
        production: true,
        ticketPath,
    });
}

async function main() {
    console.log('Instanciando AFIP (produccion, solo consulta) para SUCEDE SRL...');
    const afip = await obtenerAfipProduccion();

    const status = await afip.electronicBillingService.getServerStatus();
    console.log('Estado servidores ARCA:', status?.FEDummyResult);

    console.log(`\nConsultando NOTA DE CREDITO A PtoVenta ${PTO_VENTA} Nro ${NC_A_TICKET}...`);
    let info = null;
    try {
        info = await afip.electronicBillingService.getVoucherInfo(NC_A_TICKET, PTO_VENTA, NC_A_TIPO);
    } catch (e) {
        console.log(`ERROR en la consulta: ${e.message}`);
        process.exit(1);
    }

    if (!info) {
        console.log('NO EXISTE en ARCA - ese numero nunca fue autorizado. El cliente esta equivocado o el numero de ticket no es ese.');
        return;
    }

    const r = info.ResultGet;
    console.log('\n--- Datos del comprobante segun ARCA ---');
    console.log('Resultado:', r.Resultado, r.Resultado === 'R' ? '(RECHAZADO - no genera obligacion fiscal)' : '(APROBADO)');
    console.log('CAE:', r.CodAutorizacion);
    console.log('Fecha:', formatearFechaArca(r.CbteFch));
    console.log('Doc receptor:', r.DocTipo, r.DocNro);
    console.log('Importe total:', r.ImpTotal);

    const asoc = r.CbtesAsoc?.CbteAsoc;
    if (!asoc) {
        console.log('\nEste comprobante NO tiene CbtesAsoc cargado en ARCA (no deberia pasar en una NC A, pero por las dudas se reporta).');
        return;
    }

    const lista = Array.isArray(asoc) ? asoc : [asoc];
    console.log('\n--- Comprobante(s) asociado(s) (CbtesAsoc) ---');
    let matchEncontrado = false;
    for (const a of lista) {
        const tipo = Number(a.Tipo), ptoVta = Number(a.PtoVta), nro = Number(a.Nro);
        const esMatch = tipo === FACTURA_ESPERADA.tipo && ptoVta === FACTURA_ESPERADA.ptoVenta && nro === FACTURA_ESPERADA.numero;
        console.log(`  Tipo=${tipo} PtoVta=${ptoVta} Nro=${nro}` + (esMatch ? '   <-- COINCIDE con Factura A PtoVenta 12 Nro 56 (idVenta 1195)' : ''));
        if (esMatch) matchEncontrado = true;
    }

    console.log('\n=== CONCLUSION ===');
    if (matchEncontrado) {
        console.log('La NC A Nro 4 SI existe en ARCA y SI esta asociada a la Factura A PtoVenta 12 Nro 56 (idVenta 1195).');
        console.log('El cliente tiene razon: la NC fue emitida realmente en ARCA, pero nunca quedo registrada en el sistema (ni en `ventas` ni en `ventas_factura`).');
    } else {
        console.log('La NC A Nro 4 existe en ARCA, pero su(s) comprobante(s) asociado(s) NO coincide(n) con la Factura A PtoVenta 12 Nro 56.');
        console.log('Esa NC cancela otra factura distinta - el cliente esta confundiendo el numero de ticket, o la NC de la venta 1195 tiene otro numero.');
    }
}

main().catch(e => { console.error(e); process.exit(1); });
