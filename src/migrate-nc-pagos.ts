/**
 * MIGRACIÓN: ventas_pagos para NCs históricas
 *
 * Problema: NCs creadas antes del fix no tienen entradas en ventas_pagos,
 * por lo que no aparecen en el reporte acumulado (no restan).
 *
 * Este script calcula los montos proporcionales (igual que RegistrarMovimientoNotaCredito)
 * e inserta los registros faltantes.
 *
 * Ejecución: npx ts-node src/migrate-nc-pagos.ts
 *
 * Es seguro ejecutar múltiples veces: el WHERE NOT EXISTS evita duplicados.
 */

import db from './db';

async function migrarPagosNC() {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Obtener todas las NCs sin entradas en ventas_pagos
        const [ncs]: any = await connection.query(`
            SELECT
                nc.id,
                nc.total,
                nc.nroRelacionado,
                nc.estado,
                nc.fecha
            FROM ventas nc
            WHERE nc.idProceso = 3
              AND nc.fechaBaja IS NULL
              AND nc.estado IN ('Finalizada', 'Facturada')
              AND NOT EXISTS (
                  SELECT 1 FROM ventas_pagos vp WHERE vp.idVenta = nc.id
              )
            ORDER BY nc.id
        `);

        if (ncs.length === 0) {
            console.log('✅ No hay NCs sin migrar. Nada que hacer.');
            await connection.rollback();
            return;
        }

        console.log(`📋 NCs a migrar: ${ncs.length}`);

        let insertados = 0;
        let errores = 0;

        for (const nc of ncs) {
            try {
                // 2. Obtener la venta original por nroRelacionado
                const [ventasOrig]: any = await connection.query(`
                    SELECT v.id, v.total
                    FROM ventas v
                    WHERE v.nroProceso = ?
                      AND v.idProceso IN (1, 2, 4)
                      AND v.fechaBaja IS NULL
                    LIMIT 1
                `, [nc.nroRelacionado]);

                if (!ventasOrig.length) {
                    console.warn(`⚠️  NC #${nc.id}: no se encontró la venta original (nroRelacionado=${nc.nroRelacionado}). Saltando.`);
                    errores++;
                    continue;
                }

                const ventaOrig = ventasOrig[0];

                // 3. Obtener los pagos de la venta original
                const [pagosOrig]: any = await connection.query(`
                    SELECT idMetodo, monto
                    FROM ventas_pagos
                    WHERE idVenta = ?
                    ORDER BY id
                `, [ventaOrig.id]);

                if (!pagosOrig.length) {
                    console.warn(`⚠️  NC #${nc.id}: la venta original #${ventaOrig.id} no tiene pagos. Saltando.`);
                    errores++;
                    continue;
                }

                // 4. Calcular montos proporcionales (misma lógica que RegistrarMovimientoNotaCredito)
                const totalOriginal = pagosOrig.reduce((acc: number, p: any) => acc + Number(p.monto), 0);

                if (totalOriginal === 0) {
                    console.warn(`⚠️  NC #${nc.id}: totalOriginal = 0, no se puede calcular proporción. Saltando.`);
                    errores++;
                    continue;
                }

                let acumulado = 0;

                for (let i = 0; i < pagosOrig.length; i++) {
                    const pago = pagosOrig[i];
                    const proporcion = Number(pago.monto) / totalOriginal;

                    // El último pago toma el resto para evitar diferencias de centavos
                    const montoMovimiento = i === pagosOrig.length - 1
                        ? Number(nc.total) - acumulado
                        : Number((Number(nc.total) * proporcion).toFixed(2));

                    acumulado += montoMovimiento;

                    await connection.query(`
                        INSERT INTO ventas_pagos (idVenta, idMetodo, idRecibo, monto)
                        VALUES (?, ?, NULL, ?)
                    `, [nc.id, pago.idMetodo, montoMovimiento]);
                }

                console.log(`✅ NC #${nc.id} (${nc.fecha}) — total: $${nc.total} — ${pagosOrig.length} pago(s) insertado(s)`);
                insertados++;

            } catch (err) {
                console.error(`❌ Error procesando NC #${nc.id}:`, err);
                errores++;
            }
        }

        if (errores > 0) {
            console.log(`\n⚠️  Hubo ${errores} error(es). Haciendo rollback por seguridad.`);
            await connection.rollback();
        } else {
            await connection.commit();
            console.log(`\n✅ Migración completada: ${insertados} NC(s) migrada(s).`);
        }

    } catch (error) {
        await connection.rollback();
        console.error('❌ Error general en la migración:', error);
        throw error;
    } finally {
        connection.release();
        process.exit(0);
    }
}

migrarPagosNC();
