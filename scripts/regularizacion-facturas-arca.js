/**
 * Regularizacion de facturas reales en ARCA que nunca quedaron registradas en el sistema.
 * SOLO LECTURA contra ARCA y contra la base: NO emite nada y NO modifica la base.
 * Lo unico que escribe es un archivo .sql (dry run: termina con ROLLBACK por defecto).
 *
 * Que hace:
 *   1) Compara el ultimo autorizado en ARCA contra el ultimo ticket local del talonario.
 *   2) Consulta cada numero pedido (FECompConsultar) y trae CAE, vto, fecha, receptor, neto, IVA.
 *   3) Cruza el documento del receptor contra `clientes` (aborta si no hay match exacto).
 *   4) Detecta numeros ya cargados (no los duplica) y NC del mismo tipo de talonario pendientes.
 *   5) Genera el SQL de ventas + ventas_factura + ventas_servicios (mismo patron que
 *      'Correccion regularizacion correlatividad ARCA - sep-2026.sql').
 *
 * Uso (desde EasyStoreApi):
 *   node scripts/regularizacion-facturas-arca.js --desde 98 --hasta 101
 *   node scripts/regularizacion-facturas-arca.js --numeros 98,99,100,101 --tipo 1 --pto 12 --cuit 30714907626 --empresa 1
 *   node scripts/regularizacion-facturas-arca.js --tipo 3 --numeros 24 --solo-consulta     (NC A: solo mira, no genera SQL)
 * Tipos: 1/6/11 facturas A/B/C | 3/8/13 notas de credito A/B/C (leen CbtesAsoc de ARCA y cuelgan la NC de su factura en la base).
 *
 * Defaults: SUCEDE SRL (CUIT 30714907626), pto 12, tipo 1 (Factura A), idEmpresa 1.
 * Requiere certificados de PRODUCCION en src/certs/<cuit>/{cert,key} y config.pc.json con acceso a la base.
 * Para empresa 5 (CUIT 20426453682) pasar --cuit y --empresa y revisar el pto de venta.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { Afip } = require('afip.ts');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, '..');

// ---- args ----------------------------------------------------------------
function arg(nombre, def) {
    const i = process.argv.indexOf('--' + nombre);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const CUIT = Number(arg('cuit', '30714907626'));
const PTO = Number(arg('pto', '12'));
const TIPO = Number(arg('tipo', '1'));           // 1 Factura A | 6 Factura B | 11 Factura C
const ID_EMPRESA = Number(arg('empresa', '1'));
const USUARIO_ALTA = arg('usuario', 'regularizacion-arca-oct2026');
let numeros = [];
if (arg('numeros')) numeros = arg('numeros').split(',').map(Number);
else if (arg('desde') && arg('hasta')) for (let n = Number(arg('desde')); n <= Number(arg('hasta')); n++) numeros.push(n);
if (!numeros.length || numeros.some(n => !Number.isInteger(n))) {
    console.error('Indicar --numeros 98,99 o --desde 98 --hasta 101'); process.exit(1);
}
const TIPOS = { 1: 'FACTURA A', 6: 'FACTURA B', 11: 'FACTURA C', 3: 'NOTA DE CREDITO A', 8: 'NOTA DE CREDITO B', 13: 'NOTA DE CREDITO C' };
const ES_NC = [3, 8, 13].includes(TIPO);
const SOLO_CONSULTA = process.argv.includes('--solo-consulta'); // imprime y no genera el SQL
const NC_DE = { 1: 3, 6: 8, 11: 13 };            // tipo de NC del mismo talonario
if (!TIPOS[TIPO]) { console.error('Tipo no soportado (1, 6, 11, 3, 8, 13)'); process.exit(1); }

// ---- helpers --------------------------------------------------------------
const fechaIso = (s) => s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
const horaHHMM = (fchProceso) => (fchProceso && String(fchProceso).length >= 12) ? `${String(fchProceso).slice(8, 10)}:${String(fchProceso).slice(10, 12)}` : '00:00';
const money = (n) => Number(n).toFixed(2);
const sqlStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
const ticketFmt = (n) => `${String(PTO).padStart(4, '0')}-${String(n).padStart(8, '0')}`;

async function obtenerAfipProduccion() {
    const certFolder = path.resolve(ROOT, 'src/certs', String(CUIT));
    const certPath = path.join(certFolder, 'cert');
    const keyPath = path.join(certFolder, 'key');
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) throw new Error(`No hay certificados de produccion en ${certFolder}`);
    const ticketPath = path.resolve(ROOT, 'tokens-investigacion', String(CUIT)); // TA propio, no pisa el de la app
    fs.mkdirSync(ticketPath, { recursive: true });
    return new Afip({
        key: fs.readFileSync(keyPath, 'utf8').trim(), cert: fs.readFileSync(certPath, 'utf8').trim(),
        cuit: CUIT, production: true, ticketPath,
    });
}

async function main() {
    console.log(`Talonario: CUIT ${CUIT} | pto ${PTO} | ${TIPOS[TIPO]} | idEmpresa ${ID_EMPRESA} | numeros ${numeros.join(', ')}`);
    const afip = await obtenerAfipProduccion();
    const cfgFile = arg('config', 'config.pc.json');
    const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, cfgFile), 'utf8'));
    console.log(`Base consultada: ${config.db.host}/${config.db.database} (${cfgFile})`);
    if (config.db.database !== 'dbchazagolf') console.log('*** OJO: esa base NO es produccion. "ultimo local", "ya cargado" y los cruces son contra ESA base, no contra produccion. El SQL generado resuelve cliente y factura original al correr, no usa ids de esta base. ***');
    const conn = await mysql.createConnection({ host: config.db.host, user: config.db.user, password: config.db.password, database: config.db.database });
    const problemas = [];

    // 1) Estado del talonario: ARCA vs base (NO filtra fechaBaja: el numero fiscal queda consumido igual)
    const ultimoArca = (await afip.electronicBillingService.getLastVoucher(PTO, TIPO)).CbteNro;
    const [[{ maxLocal }]] = await conn.query(
        `SELECT IFNULL(MAX(vf.ticket), 0) AS maxLocal FROM ventas_factura vf JOIN ventas v ON v.id = vf.idVenta
         WHERE vf.ptoVenta = ? AND vf.tipoFactura = ? AND v.idEmpresa = ?`, [PTO, TIPO, ID_EMPRESA]);
    const [locales] = await conn.query(
        `SELECT vf.ticket FROM ventas_factura vf JOIN ventas v ON v.id = vf.idVenta
         WHERE vf.ptoVenta = ? AND vf.tipoFactura = ? AND v.idEmpresa = ? AND vf.ticket > ?`, [PTO, TIPO, ID_EMPRESA, Math.min(...numeros) - 1]);
    const yaCargados = new Set(locales.map(r => Number(r.ticket)));
    console.log(`Ultimo autorizado en ARCA: ${ultimoArca} | ultimo local: ${maxLocal}`);
    const faltantes = [];
    // Desde el menor numero pedido (no desde maxLocal+1): un hueco interno no lo ve el MAX (ej. NC 24 faltante con la 25 ya cargada)
    for (let n = Math.min(maxLocal + 1, ...numeros); n <= ultimoArca; n++) if (!yaCargados.has(n)) faltantes.push(n);
    const sinPedir = faltantes.filter(n => !numeros.includes(n));
    if (sinPedir.length) problemas.push(`Hay numeros faltantes en la base que NO pediste: ${sinPedir.join(', ')}. La correlatividad seguiria rota despues de correr el SQL.`);
    const noFaltan = numeros.filter(n => n > ultimoArca);
    if (noFaltan.length) problemas.push(`Numeros mayores al ultimo autorizado en ARCA (no existen): ${noFaltan.join(', ')}`);

    // 2) Consultar cada comprobante
    const filas = [];
    for (const n of numeros) {
        if (yaCargados.has(n)) { console.log(`#${n}: YA esta cargado en la base, se omite.`); continue; }
        process.stdout.write(`#${n}: consultando ARCA... `);
        const info = await afip.electronicBillingService.getVoucherInfo(n, PTO, TIPO);
        if (!info) { problemas.push(`#${n}: NO existe en ARCA`); console.log('NO EXISTE'); continue; }
        const r = info.ResultGet;
        console.log(`CAE ${r.CodAutorizacion} | ${r.Resultado} | doc ${r.DocNro} | total ${r.ImpTotal}`);
        if (r.Resultado !== 'A') { problemas.push(`#${n}: resultado ARCA = ${r.Resultado} (no aprobado), no se carga`); continue; }
        if (Math.abs(Number(r.ImpNeto) + Number(r.ImpIVA) - Number(r.ImpTotal)) > 0.01) {
            problemas.push(`#${n}: neto ${r.ImpNeto} + IVA ${r.ImpIVA} != total ${r.ImpTotal} (hay tributos/exentos; revisar a mano)`);
        }
        if (ES_NC) {
            const asocRaw = r.CbtesAsoc?.CbteAsoc;
            const asoc = Array.isArray(asocRaw) ? asocRaw[0] : asocRaw;
            if (!asoc) { problemas.push(`#${n}: la NC no trae CbtesAsoc en ARCA, no se puede colgar de una factura`); continue; }
            console.log(`      cancela tipo ${asoc.Tipo} pto ${asoc.PtoVta} nro ${asoc.Nro}`);
            const [orig] = await conn.query(
                `SELECT v.id, v.nroProceso, v.idCliente, v.idLista, v.total, vf.condReceptor
                 FROM ventas_factura vf JOIN ventas v ON v.id = vf.idVenta
                 WHERE vf.tipoFactura = ? AND vf.ptoVenta = ? AND vf.ticket = ? AND v.idEmpresa = ?`,
                [Number(asoc.Tipo), Number(asoc.PtoVta), Number(asoc.Nro), ID_EMPRESA]);
            if (orig.length !== 1) console.log(`      (aviso) la factura asociada no esta en ESTA base (${orig.length} filas): el SQL la busca al correr en produccion; se debe correr DESPUES de regularizar la factura.`);
            filas.push({ n, r, asoc: { tipo: Number(asoc.Tipo), pto: Number(asoc.PtoVta), nro: Number(asoc.Nro) }, orig: orig.length === 1 ? orig[0] : null });
            continue;
        }
        const [clientes] = await conn.query('SELECT id, nombre, razonSocial, idCondIva FROM clientes WHERE documento = ?', [r.DocNro]);
        if (clientes.length === 0) { problemas.push(`#${n}: no hay cliente con documento ${r.DocNro}`); continue; }
        if (clientes.length > 1) problemas.push(`#${n}: ${clientes.length} clientes con documento ${r.DocNro} (ids ${clientes.map(c => c.id).join(', ')}); se usa el menor id, VERIFICAR`);
        const cli = clientes.sort((a, b) => a.id - b.id)[0];
        filas.push({ n, r, cli });
    }

    // 3) NC del mismo talonario emitidas en ARCA y no registradas (solo aviso: si existen, tambien rompen su correlatividad)
    const tipoNC = NC_DE[TIPO];
    if (!ES_NC) try {
        const ncArca = (await afip.electronicBillingService.getLastVoucher(PTO, tipoNC)).CbteNro;
        const [[{ maxNC }]] = await conn.query(
            `SELECT IFNULL(MAX(vf.ticket), 0) AS maxNC FROM ventas_factura vf JOIN ventas v ON v.id = vf.idVenta
             WHERE vf.ptoVenta = ? AND vf.tipoFactura = ? AND v.idEmpresa = ?`, [PTO, tipoNC, ID_EMPRESA]);
        console.log(`NC tipo ${tipoNC}: ultimo en ARCA ${ncArca} | ultimo local ${maxNC}`);
        if (ncArca > maxNC) problemas.push(`Hay NC tipo ${tipoNC} en ARCA no registradas (${maxNC + 1}..${ncArca}). Revisar con verificacion-nc-a-venta-1195.js antes de dar por cerrada la correlatividad.`);
    } catch (e) { console.log('No se pudo consultar NC del talonario:', e.message); }

    if (ES_NC) {
        // Sobre-anulacion: suma de NC (ya cargadas en la base + las de esta corrida) contra el total de cada factura
        const porFactura = {};
        for (const f of filas.filter(x => x.orig)) (porFactura[f.orig.id] = porFactura[f.orig.id] || { orig: f.orig, nuevas: [] }).nuevas.push(f);
        for (const g of Object.values(porFactura)) {
            const [[{ yaNC }]] = await conn.query(
                `SELECT IFNULL(SUM(total), 0) AS yaNC FROM ventas WHERE idProceso = 3 AND tipoRelacionado = 'FACTURA' AND nroRelacionado = ? AND idEmpresa = ? AND fechaBaja IS NULL`,
                [g.orig.nroProceso, ID_EMPRESA]);
            const total = Number(yaNC) + g.nuevas.reduce((a, f) => a + Number(f.r.ImpTotal), 0);
            if (total > Number(g.orig.total) + 0.01) problemas.push(`SOBRE-ANULACION: la factura (venta ${g.orig.id}, total ${g.orig.total}) quedaria con NC por ${total} (ya cargadas ${yaNC} + estas ${g.nuevas.map(f => '#' + f.n).join(', ')}). Hablarlo con el contador antes de cargar.`);
        }
    }

    await conn.end();

    // 4) Resultado
    if (problemas.length) {
        console.log('\n=== PROBLEMAS / AVISOS ===');
        problemas.forEach(p => console.log(' - ' + p));
    }
    if (!filas.length) { console.log('\nNada para generar.'); return; }
    if (SOLO_CONSULTA) { console.log('\n--solo-consulta: no se genera SQL.'); return; }
    const bloqueantes = problemas.filter(p => /NO existe|no hay cliente|no aprobado|mayores al ultimo/.test(p));
    if (bloqueantes.length) { console.error('\nHay problemas bloqueantes: NO se genera el SQL.'); process.exit(2); }

    const lineas = [];
    const L = (s = '') => lineas.push(s);
    const nombreArchivo = `Correccion regularizacion correlatividad ARCA ${TIPOS[TIPO].toLowerCase()} ${PTO}-${numeros[0]} a ${numeros[numeros.length - 1]} - oct-2026.sql`;
    const idProceso = ES_NC ? 3 : 1;
    L(`-- Regularizacion ARCA (${TIPOS[TIPO]} pto ${PTO}, nros ${filas.map(f => f.n).join(', ')}) - oct-2026`);
    L('-- Generado por scripts/regularizacion-facturas-arca.js a partir de FECompConsultar (ARCA produccion).');
    L('-- Comprobantes REALES (con CAE) cuyo guardado fallo en el sistema. NO pasa por Facturar()/ARCA.');
    L('-- No genera ventas_pagos ni movimientos_fondos ni toca stock. Dry run: termina en ROLLBACK.');
    L('-- Revisar el SELECT de verificacion; recien ahi cambiar ROLLBACK por COMMIT.');
    L('');
    L('START TRANSACTION;');
    L('');
    L('-- 0) Guarda: ninguno de estos tickets debe existir ya (debe devolver 0 filas).');
    L(`SELECT vf.idVenta, vf.ticket FROM ventas_factura vf JOIN ventas v ON v.id = vf.idVenta`);
    L(`WHERE vf.tipoFactura = ${TIPO} AND vf.ptoVenta = ${PTO} AND v.idEmpresa = ${ID_EMPRESA} AND vf.ticket IN (${filas.map(f => f.n).join(', ')});`);
    L('');
    L('-- Servicio generico de linea (se reutiliza el de la tanda anterior; se crea solo si no existe).');
    L(`INSERT INTO servicios (codigo, descripcion, sugerido, topeDescuento)`);
    L(`SELECT 'AJUSTE-ARCA', 'Regularizacion comprobante ARCA', 0.00, 0.00 FROM DUAL`);
    L(`WHERE NOT EXISTS (SELECT 1 FROM servicios WHERE codigo = 'AJUSTE-ARCA');`);
    L(`SET @idServicioArca = (SELECT id FROM servicios WHERE codigo = 'AJUSTE-ARCA' ORDER BY id LIMIT 1);`);
    L(`SET @nroFactura = (SELECT IFNULL(MAX(nroProceso), 0) FROM ventas WHERE idProceso = ${idProceso});`);
    L('');
    filas.forEach((f, i) => {
        const r = f.r;
        const fecha = fechaIso(r.CbteFch);
        const condRec = r.CondicionIVAReceptorId != null ? Number(r.CondicionIVAReceptorId) : null;
        const obs = `Regularizacion ARCA oct-2026: ${TIPOS[TIPO]} ${ticketFmt(f.n)} emitida en ARCA (CAE ${r.CodAutorizacion}, ${fecha}) pero no registrada en el sistema (fallo el guardado tras la autorizacion).${ES_NC ? ` Cancela ${ticketFmt(f.asoc.nro)}.` : ''} Verificada contra ARCA.`;
        const hora = horaHHMM(r.FchProceso);
        const COLS = '(idCaja, idProceso, nroProceso, idPunto, fecha, hora, idCliente, idLista, idEmpresa, idTComprobante, idTDescuento, descuento, codPromocion, redondeo, total, nroRelacionado, tipoRelacionado, estado, impaga, ajusteTransf, regularizacionArca, observacion, usuarioAlta)';
        L(`-- ${TIPOS[TIPO]} ${ticketFmt(f.n)} | ${ES_NC ? `cancela tipo ${f.asoc.tipo} ${ticketFmt(f.asoc.nro)}` : `${f.cli.razonSocial || f.cli.nombre}, doc ${r.DocNro}`} | $${money(r.ImpTotal)} | ARCA ${r.FchProceso}`);
        L('SET @nroFactura = @nroFactura + 1;');
        if (ES_NC) {
            // Cliente, lista y nroProceso se toman de la factura original al correr el SQL (no de la base donde corrio el script)
            L(`INSERT INTO ventas ${COLS}`);
            L('SELECT');
            L(`  1, 3, @nroFactura, ${PTO}, '${fecha}', '${hora}', v.idCliente, v.idLista, v.idEmpresa, ${TIPO}, NULL, NULL, NULL, 0.00, ${money(r.ImpTotal)},`);
            L(`  v.nroProceso, 'FACTURA', 'Facturada', 0, 0, 1, ${sqlStr(obs)}, ${sqlStr(USUARIO_ALTA)}`);
            L('FROM ventas v JOIN ventas_factura vf ON vf.idVenta = v.id');
            L(`WHERE vf.tipoFactura = ${f.asoc.tipo} AND vf.ptoVenta = ${f.asoc.pto} AND vf.ticket = ${f.asoc.nro} AND v.idEmpresa = ${ID_EMPRESA};`);
            // No usa ROW_COUNT()/LAST_INSERT_ID() (dependen del cliente SQL): busca la fila recien insertada por su nroProceso unico. NULL = no se inserto -> el insert siguiente falla a proposito.
            L(`SET @idVenta${i} = (SELECT MAX(id) FROM ventas WHERE idProceso = 3 AND idEmpresa = ${ID_EMPRESA} AND nroProceso = @nroFactura AND usuarioAlta = ${sqlStr(USUARIO_ALTA)});`);
        } else {
            L(`INSERT INTO ventas ${COLS}`);
            L('VALUES (');
            L(`  1, 1, @nroFactura, ${PTO}, '${fecha}', '${hora}', (SELECT id FROM clientes WHERE documento = ${r.DocNro} ORDER BY id LIMIT 1), NULL, ${ID_EMPRESA}, ${TIPO}, NULL, NULL, NULL, 0.00, ${money(r.ImpTotal)},`);
            L(`  0, '', 'Facturada', 0, 0, 1, ${sqlStr(obs)}, ${sqlStr(USUARIO_ALTA)}`);
            L(');');
            L(`SET @idVenta${i} = LAST_INSERT_ID();`);
        }
        L('INSERT INTO ventas_factura (idVenta, cae, caeVto, ticket, tipoFactura, neto, iva, dni, tipoDni, ptoVenta, condReceptor, tipoRelacionado, ticketRelacionado, ptoVentaRelacionado)');
        L('VALUES (');
        L(`  @idVenta${i}, ${sqlStr(r.CodAutorizacion)}, '${fechaIso(r.FchVto)}', ${f.n}, ${TIPO}, ${money(r.ImpNeto)}, ${money(r.ImpIVA)},`);
        const condFallback = ES_NC ? `(SELECT condReceptor FROM ventas_factura WHERE tipoFactura = ${f.asoc.tipo} AND ptoVenta = ${f.asoc.pto} AND ticket = ${f.asoc.nro} LIMIT 1)` : `(SELECT idCondIva FROM clientes WHERE documento = ${r.DocNro} ORDER BY id LIMIT 1)`;
        const rel = ES_NC ? `${f.asoc.tipo}, ${f.asoc.nro}, ${f.asoc.pto}` : 'NULL, NULL, NULL';
        L(`  ${r.DocNro}, ${r.DocTipo}, ${PTO}, ${condRec != null ? condRec : condFallback}, ${rel}`);
        L(');');
        L('INSERT INTO ventas_servicios (idVenta, idServicio, cantidad, precio, total, importeDescuento)');
        L(`VALUES (@idVenta${i}, @idServicioArca, 1, ${money(r.ImpTotal)}, ${money(r.ImpTotal)}, 0.00);`);
        L('');
    });
    L('-- ==== Verificacion antes de confirmar ====');
    L('SELECT v.id, v.nroProceso, v.fecha, v.hora, v.estado, v.total, v.regularizacionArca, v.idCliente,');
    L('       v.nroRelacionado, v.tipoRelacionado, vf.tipoFactura, vf.ptoVenta, vf.ticket, vf.cae, vf.caeVto, vf.neto, vf.iva, vf.condReceptor,');
    L('       vf.tipoRelacionado AS fiscalTipoRel, vf.ptoVentaRelacionado, vf.ticketRelacionado');
    L('FROM ventas v JOIN ventas_factura vf ON vf.idVenta = v.id');
    L(`WHERE v.usuarioAlta = ${sqlStr(USUARIO_ALTA)} AND vf.tipoFactura = ${TIPO} AND vf.ticket IN (${filas.map(f => f.n).join(', ')})`);
    L('ORDER BY vf.ticket;');
    L(`-- Deben ser ${filas.length} filas, tickets ${filas.map(f => f.n).join(', ')}, con CAE y neto+iva=total.`);
    L('');
    const minN = Math.min(...filas.map(f => f.n));
    L(`-- Chequeo de cierre: no debe quedar ningun hueco entre ${minN} y ${ultimoArca} (esperado: ${ultimoArca - minN + 1} filas, sin faltantes).`);
    L(`SELECT COUNT(DISTINCT vf.ticket) AS cargados, ${ultimoArca - minN + 1} AS esperados FROM ventas_factura vf JOIN ventas v ON v.id = vf.idVenta WHERE vf.tipoFactura = ${TIPO} AND vf.ptoVenta = ${PTO} AND v.idEmpresa = ${ID_EMPRESA} AND vf.ticket BETWEEN ${minN} AND ${ultimoArca};`);
    L('');
    L('-- COMMIT;');
    L('ROLLBACK;  -- dry run: reemplazar por COMMIT recien despues de revisar las dos consultas de arriba');
    const out = path.join(OUT_DIR, nombreArchivo);
    fs.writeFileSync(out, lineas.join('\n') + '\n', 'utf8');
    console.log(`\nSQL generado: ${out}`);
    console.log(`Filas: ${filas.length} | ultimo ARCA: ${ultimoArca}`);
}

main().catch(e => { console.error(e); process.exit(1); });
