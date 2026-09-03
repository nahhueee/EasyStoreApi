/**
 * Script de INVESTIGACION (solo lectura) - NO emite comprobantes, NO modifica nada.
 *
 * Objetivo: para cada numero de comprobante "faltante" detectado por el control de
 * correlatividad del Libro IVA (huecos en la numeracion de SUCEDE SRL), consulta a
 * ARCA (WSFEv1 -> FECompConsultar via afip.ts) si ese comprobante existe realmente,
 * y si existe, trae CAE, fecha, documento del receptor e importe. Cruza el documento
 * contra la tabla `clientes` de la base para intentar resolver la razon social.
 *
 * Ademas, para las Notas de Credito B ya conocidas en el rango afectado, consulta
 * su CbtesAsoc para detectar si alguna ya esta formalmente asociada a alguno de los
 * numeros de Factura A/B faltantes (o sea, si ya fue "cancelada" aunque el sistema
 * nunca la haya visto).
 *
 * Requiere: certificados de PRODUCCION de SUCEDE en src/certs/30714907626/{cert,key}
 * y config.pc.json con acceso de lectura a la base.
 *
 * Uso: node scripts/investigacion-libro-iva-faltantes.js
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const ExcelJS = require('exceljs');
const { Afip } = require('afip.ts');

const ROOT = path.resolve(__dirname, '..');
const CUIT_SUCEDE = 30714907626;
const PTO_VENTA = 12;

// Huecos detectados por el control de correlatividad (ticketAnterior/ticketSiguiente
// exclusivos -> se expanden a los numeros intermedios faltantes).
const HUECOS = [
    { tipoFactura: 1, descripcion: 'FACTURA A', rangos: [[36, 40], [40, 44], [44, 57]] },
    { tipoFactura: 6, descripcion: 'FACTURA B', rangos: [
        [261, 263], [267, 269], [271, 274], [283, 286], [286, 289], [290, 293],
        [308, 311], [331, 335], [337, 339], [340, 344], [346, 354], [355, 359], [362, 365],
    ] },
    { tipoFactura: 8, descripcion: 'NOTA DE CREDITO B', rangos: [[4, 8], [8, 10]] },
];

function expandirRango(desde, hasta) {
    const nums = [];
    for (let i = desde + 1; i < hasta; i++) nums.push(i);
    return nums;
}

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

    // Ticket propio para no interferir con el token TA que usa la app en produccion.
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

    const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'config.pc.json'), 'utf8'));
    const conn = await mysql.createConnection({
        host: config.db.host, user: config.db.user, password: config.db.password, database: config.db.database,
    });

    // --- 1) Consultar cada comprobante faltante ---
    const filas = [];
    for (const grupo of HUECOS) {
        const numeros = grupo.rangos.flatMap(([d, h]) => expandirRango(d, h));
        for (const numero of numeros) {
            process.stdout.write(`Consultando ${grupo.descripcion} Nro ${numero}... `);
            let info = null;
            try {
                info = await afip.electronicBillingService.getVoucherInfo(numero, PTO_VENTA, grupo.tipoFactura);
            } catch (e) {
                console.log(`ERROR: ${e.message}`);
                filas.push({
                    tipoFactura: grupo.descripcion, ptoVenta: PTO_VENTA, numero,
                    existe: 'ERROR CONSULTA', cae: '', fecha: '', docTipo: '', docNro: '',
                    razonSocial: '', importe: '', resultado: '', observacion: e.message,
                });
                continue;
            }

            if (!info) {
                console.log('NO EXISTE en ARCA');
                filas.push({
                    tipoFactura: grupo.descripcion, ptoVenta: PTO_VENTA, numero,
                    existe: 'NO', cae: '', fecha: '', docTipo: '', docNro: '',
                    razonSocial: '', importe: '', resultado: '', observacion: 'Numero nunca autorizado por ARCA',
                });
                continue;
            }

            const r = info.ResultGet;
            console.log(`EXISTE - CAE ${r.CodAutorizacion} - Resultado ${r.Resultado}`);

            let razonSocial = '';
            if (r.DocNro) {
                const [clientes] = await conn.query(
                    'SELECT nombre, razonSocial FROM clientes WHERE documento = ? LIMIT 1',
                    [r.DocNro]
                );
                if (clientes.length > 0) {
                    razonSocial = clientes[0].razonSocial || clientes[0].nombre || '';
                }
            }

            filas.push({
                tipoFactura: grupo.descripcion, ptoVenta: PTO_VENTA, numero,
                existe: 'SI', cae: String(r.CodAutorizacion || ''), fecha: formatearFechaArca(r.CbteFch),
                docTipo: r.DocTipo, docNro: r.DocNro,
                razonSocial: razonSocial || '(no encontrado en clientes por documento)',
                importe: r.ImpTotal, resultado: r.Resultado,
                observacion: r.Resultado === 'R' ? 'Comprobante RECHAZADO por ARCA (no genera obligacion fiscal)' : '',
            });
        }
    }

    // --- 2) Cruzar contra NC B ya conocidas en el sistema, buscando CbtesAsoc ---
    console.log('\nBuscando Notas de Credito B propias del sistema para revisar CbtesAsoc...');
    const [ncConocidas] = await conn.query(
        `SELECT vf.ticket FROM ventas_factura vf INNER JOIN ventas v ON v.id = vf.idVenta
         WHERE v.idEmpresa = 1 AND vf.tipoFactura = 8 AND vf.ptoVenta = ? ORDER BY vf.ticket`,
        [PTO_VENTA]
    );
    const asociaciones = [];
    for (const nc of ncConocidas) {
        const info = await afip.electronicBillingService.getVoucherInfo(nc.ticket, PTO_VENTA, 8);
        const asoc = info?.ResultGet?.CbtesAsoc;
        if (asoc) {
            const lista = Array.isArray(asoc) ? asoc : [asoc];
            for (const a of lista) {
                asociaciones.push({ ncNumero: nc.ticket, tipoAsociado: a.Tipo, ptoVentaAsociado: a.PtoVta, nroAsociado: a.Nro });
            }
        }
    }
    console.log(`NC B revisadas: ${ncConocidas.length}. Asociaciones encontradas: ${asociaciones.length}`);

    for (const fila of filas) {
        if (fila.tipoFactura === 'NOTA DE CREDITO B') continue;
        const tipoArca = fila.tipoFactura === 'FACTURA A' ? 1 : 6;
        const match = asociaciones.find(a => a.tipoAsociado === tipoArca && a.ptoVentaAsociado === PTO_VENTA && a.nroAsociado === fila.numero);
        if (match) {
            fila.observacion = `YA CANCELADA por NC B Nro ${match.ncNumero}` + (fila.observacion ? ' | ' + fila.observacion : '');
        }
    }

    await conn.end();

    // --- 3) Excel para entregar al contador ---
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Comprobantes faltantes');
    sheet.columns = [
        { header: 'Tipo', key: 'tipoFactura', width: 20 },
        { header: 'Pto Vta', key: 'ptoVenta', width: 10 },
        { header: 'Numero', key: 'numero', width: 10 },
        { header: 'Existe en ARCA', key: 'existe', width: 15 },
        { header: 'CAE', key: 'cae', width: 18 },
        { header: 'Fecha', key: 'fecha', width: 12 },
        { header: 'Tipo Doc', key: 'docTipo', width: 10 },
        { header: 'Nro Doc', key: 'docNro', width: 15 },
        { header: 'Razon Social / Nombre', key: 'razonSocial', width: 35 },
        { header: 'Importe Total', key: 'importe', width: 15 },
        { header: 'Resultado ARCA', key: 'resultado', width: 15 },
        { header: 'Observacion', key: 'observacion', width: 45 },
    ];
    sheet.getColumn('cae').numFmt = '@';
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
    sheet.autoFilter = { from: 'A1', to: 'L1' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    filas.forEach(f => sheet.addRow(f));

    const outPath = path.resolve(ROOT, 'Investigacion_Comprobantes_Faltantes_SUCEDE.xlsx');
    await workbook.xlsx.writeFile(outPath);
    console.log(`\nListo. Excel generado en: ${outPath}`);
    console.log(`Total consultados: ${filas.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
