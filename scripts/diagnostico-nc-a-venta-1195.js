/**
 * Diagnostico (solo lectura) para preparar el alta manual de la NC A PtoVenta 12
 * Nro 4 (idVenta 1195 / Factura A PtoVenta 12 Nro 56) - confirmada contra ARCA en
 * verificacion-nc-a-venta-1195.js. NO modifica nada.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.resolve(__dirname, '..');

async function main() {
    const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'config.pc.json'), 'utf8'));
    const conn = await mysql.createConnection({
        host: config.db.host, user: config.db.user, password: config.db.password, database: config.db.database,
    });

    console.log('--- Cabecera venta 1195 ---');
    const [venta] = await conn.query(
        `SELECT v.id, v.idCaja, v.idProceso, v.nroProceso, v.idPunto, v.fecha, v.hora,
                v.idCliente, v.idLista, v.idEmpresa, v.idTComprobante, v.idTDescuento,
                v.descuento, v.codPromocion, v.redondeo, v.total, v.estado, v.impaga,
                v.ajusteTransf, v.observacion, v.fechaBaja, pv.descripcion AS proceso
         FROM ventas v
         LEFT JOIN procesos_venta pv ON pv.id = v.idProceso
         WHERE v.id = 1195`
    );
    console.log(venta);

    console.log('\n--- ventas_factura de 1195 ---');
    const [vf] = await conn.query('SELECT * FROM ventas_factura WHERE idVenta = 1195');
    console.log(vf);

    console.log('\n--- Cliente ---');
    if (venta[0]) {
        const [cli] = await conn.query('SELECT id, nombre, razonSocial, documento, idCategoria FROM clientes WHERE id = ?', [venta[0].idCliente]);
        console.log(cli);
    }

    console.log('\n--- ventas_productos de 1195 ---');
    const [vp] = await conn.query('SELECT * FROM ventas_productos WHERE idVenta = 1195');
    console.log(vp);

    console.log('\n--- ventas_servicios de 1195 ---');
    const [vs] = await conn.query('SELECT * FROM ventas_servicios WHERE idVenta = 1195');
    console.log(vs);

    console.log('\n--- ventas_pagos de 1195 ---');
    const [vpg] = await conn.query('SELECT * FROM ventas_pagos WHERE idVenta = 1195');
    console.log(vpg);

    console.log('\n--- Empresas con PtoVenta 12 / CUIT SUCEDE (para confirmar idEmpresa) ---');
    const [emp] = await conn.query("SELECT * FROM empresas WHERE cuit = '30714907626' OR nombre LIKE '%SUCEDE%'");
    console.log(emp);

    console.log('\n--- Metodo de pago tipo SALDO_FAVOR (por si aplica) ---');
    const [mp] = await conn.query("SELECT id, nombre, tipo FROM metodos_pago WHERE tipo = 'SALDO_FAVOR'");
    console.log(mp);

    console.log('\n--- Ultimo idVenta / nroProceso usados en NOTA_CREDITO (idProceso=3) para saber el proximo nroProceso ---');
    const [ult] = await conn.query('SELECT MAX(id) AS maxId, MAX(nroProceso) AS maxNroProceso FROM ventas WHERE idProceso = 3');
    console.log(ult);

    await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
