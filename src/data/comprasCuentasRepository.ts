import db from '../db';
import { ResultSetHeader } from 'mysql2';
import { SesionServ } from '../services/sesionService';
const moment = require('moment');

// Cuenta Corriente de Proveedores (Compras F2, ver ROADMAP-modulo-compras.md sección 9).
// Espejo de cuentasRepository.ts (Cuenta Corriente de Clientes), con una diferencia deliberada:
// RevertirPagoProveedor usa baja lógica + contra-asientos en movimientos_fondos en vez de DELETE físico.
// cuentasRepository.RevertirEntrega borra registros sin revertir los movimientos de fondos generados en
// EntregaDinero (los fondos quedan descuadrados tras un revert) - eso es deuda técnica ya identificada
// en Clientes, no se replica acá a propósito. Queda pendiente como fix futuro en Clientes (fuera de
// alcance de esta tarea).

class PagoMetodoDTO {
    idMetodo: number = 0;
    monto: number = 0;
}

class PagarProveedorDTO {
    idEmpresa: number = 0;
    idCaja: number = 0;
    idProveedor: number = 0;
    metodos: PagoMetodoDTO[] = [];
    observaciones?: string;
}

class ComprasCuentasRepository {

    //#region OBTENER
    // Paginado con conteo real ({total, registros}), mismo patrón dual-query que
    // cuentasRepository.Obtener (ver ObtenerQueryCuentasProveedores más abajo) - requisito para que
    // el p-table lazy del frontend pagine bien (antes devolvía array plano, sin total).
    async ObtenerCuentasProveedores(filtros: any) {
        const connection = await db.getConnection();

        try {
            const queryRegistros = await ObtenerQueryCuentasProveedores(filtros, false);
            const queryTotal = await ObtenerQueryCuentasProveedores(filtros, true);

            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            if (Array.isArray(rows)) {
                for (const row of rows as any[]) {
                    row.saldoInicial = parseFloat(row.saldoInicial);
                    row.deuda = parseFloat(row.deuda);
                    row.saldoAFavor = parseFloat(row.saldoAFavor);
                    row.saldo = parseFloat(row.saldo);
                    // 'Debemos' (no 'Debe') a propósito: distinto del label de cuentasRepository.ts (Clientes),
                    // donde 'Debe' significa lo inverso (el cliente nos debe a nosotros). Acá saldo > 0 es
                    // deuda nuestra hacia el proveedor - mismo string en ambos módulos generaba ambigüedad
                    // sobre quién le debe a quién.
                    row.estado = row.saldo > 0 ? 'Debemos' : (row.saldo < 0 ? 'A favor' : 'Al día');
                }
            }

            return { total: (resultado[0] as any)[0].total, registros: rows };

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    async ObtenerPagoProveedor(idPagoProveedor: any) {
        const connection = await db.getConnection();

        try {
            const [rowsHeader]: any = await connection.query(
                `SELECT pp.*, p.razonSocial AS proveedor
                 FROM compras_pagos_proveedor pp
                 LEFT JOIN proveedores p ON p.id = pp.idProveedor
                 WHERE pp.id = ?`,
                [idPagoProveedor]
            );
            if (!rowsHeader.length) return null;
            const header = rowsHeader[0];

            const [metodos]: any = await connection.query(
                `SELECT m.idMetodo, m.monto, mp.nombre AS metodoPago
                 FROM compras_pagos_proveedor_metodos m
                 LEFT JOIN metodos_pago mp ON mp.id = m.idMetodo
                 WHERE m.idPagoProveedor = ?`,
                [idPagoProveedor]
            );

            // LEFT JOIN a compras+tipos_comprobantes agregado ahora (24-jun-2026) para que el diálogo
            // "Ver Detalle" del ledger pueda mostrar A QUÉ compra se aplicó cada monto, no solo el id.
            // Antes esta query solo se usaba para el JSON crudo (ningún consumidor de frontend la
            // renderizaba todavía) - era el hueco que reportó el usuario: pagos sin contexto visible.
            const [detalle]: any = await connection.query(
                `SELECT d.idCompra, d.tipoAplicacion, d.montoAplicado,
                        tc.descripcion AS tipoComprobante, c.nroComprobante
                 FROM compras_pagos_proveedor_detalle d
                 LEFT JOIN compras c ON c.id = d.idCompra
                 LEFT JOIN tipos_comprobantes tc ON tc.id = c.idTipoComprobante
                 WHERE d.idPagoProveedor = ?`,
                [idPagoProveedor]
            );

            header.total = parseFloat(header.total);
            header.metodos = metodos.map((m: any) => ({ ...m, monto: parseFloat(m.monto) }));
            header.detalle = detalle.map((d: any) => ({ ...d, montoAplicado: parseFloat(d.montoAplicado) }));

            return header;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    // Ledger unificado de movimientos del proveedor (saldo inicial + compras + pagos), espejo de
    // cuentasRepository.ObtenerVentasCliente (ver ObtenerQueryMovimientosProveedor más abajo).
    // Reemplaza a la vieja ObtenerComprasProveedor (eliminada 24-jun-2026 junto con su ruta y su query
    // builder, ya sin consumidores) como fuente de la pantalla cuenta-proveedor: antes solo se listaban
    // compras y los pagos quedaban invisibles (feedback del usuario, 24-jun-2026: "no se generen recibos
    // de pagos... no puedo saber exactamente cuando le entregue dinero y porque").
    async ObtenerMovimientosProveedor(filtros: any) {
        const connection = await db.getConnection();

        try {
            if (!filtros.idProveedor) throw { status: 400, message: 'Debe indicar un proveedor.' };

            const queryRegistros = await ObtenerQueryMovimientosProveedor(filtros, false);
            const queryTotal = await ObtenerQueryMovimientosProveedor(filtros, true);

            // idProveedor se repite 3 veces (una por rama del UNION ALL) - mismo idProveedor, no son
            // filtros distintos.
            const params = [filtros.idProveedor, filtros.idProveedor, filtros.idProveedor];
            const [rows] = await connection.query(queryRegistros, params);
            const resultado = await connection.query(queryTotal, params);

            if (Array.isArray(rows)) {
                for (const row of rows as any[]) {
                    row.debe = parseFloat(row.debe);
                    row.haber = parseFloat(row.haber);
                    row.saldo = parseFloat(row.saldo);

                    // El excedente que un pago generó como saldo a favor se resuelve aquí (no con CASE
                    // anidados en SQL): es justo el dato que el usuario no podía ver antes ("le pago una
                    // reserva... como se yo que tiene saldo a favor mio por eso?"). El monto exacto del
                    // excedente queda disponible en el diálogo "Ver Detalle" (ObtenerPagoProveedor).
                    const montoExcedente = parseFloat(row.montoExcedente);
                    if (montoExcedente > 0) {
                        row.referencia = row.referencia
                            ? `${row.referencia} + EXCEDENTE A FAVOR`
                            : 'EXCEDENTE A FAVOR';
                    }
                    delete row.montoExcedente;
                }
            }

            return { total: (resultado[0] as any)[0].total, registros: rows };

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    async PagarProveedor(data: PagarProveedorDTO): Promise<string> {
        const connection = await db.getConnection();

        try {
            if (!data.metodos?.length) throw { status: 400, message: 'Debe indicar al menos un método de pago.' };

            const montoTotal = data.metodos.reduce((acc, m) => acc + Number(m.monto), 0);
            if (montoTotal <= 0) throw { status: 400, message: 'El monto del pago debe ser mayor a cero.' };

            await connection.beginTransaction();
            const usuario = SesionServ.LeerSesion().usuario;

            const [rowsProveedor]: any = await connection.query(
                "SELECT inicial FROM proveedores WHERE id = ? FOR UPDATE",
                [data.idProveedor]
            );
            if (!rowsProveedor.length) throw { status: 404, message: 'El proveedor no existe.' };
            const proveedor = rowsProveedor[0];

            // Header del pago. Consolida lo que en Clientes son 2 tablas (recibos + ventas_entrega) en
            // una sola (ver comentario en la migración 20260623120000_create_cc_proveedores.js).
            const [resHeader] = await connection.query<ResultSetHeader>(
                `INSERT INTO compras_pagos_proveedor (idEmpresa, idProveedor, idCaja, fecha, hora, total, observaciones, usuario)
                 VALUES (?, ?, ?, CURRENT_DATE, CURRENT_TIME, ?, ?, ?)`,
                [data.idEmpresa, data.idProveedor, data.idCaja, montoTotal, data.observaciones ?? null, usuario]
            );
            const idPagoProveedor = resHeader.insertId;

            const idFondoCC = await GetFondoVirtual(connection, 'CC_PROVEEDORES');
            const idFondoSaldoFavor = await GetFondoVirtual(connection, 'SALDO_FAVOR_PROVEEDORES');

            // Desglose por método: cada leg es un EGRESO real e independiente del fondo de ese método.
            // A propósito NO se cruza 1 a 1 con el detalle de aplicación FIFO de más abajo: son dos
            // hechos independientes (de dónde salió la plata vs. a qué deuda se aplicó). Cruzarlos
            // obligaría a partir cada leg en fracciones por cada compra - complejidad que ningún reporte
            // de Fondos necesita hoy.
            for (const m of data.metodos) {
                const metodoPago = await GetMetodoPago(connection, m.idMetodo);

                await connection.query(
                    "INSERT INTO compras_pagos_proveedor_metodos (idPagoProveedor, idMetodo, monto) VALUES (?, ?, ?)",
                    [idPagoProveedor, m.idMetodo, m.monto]
                );
                await InsertMovimientoFondo(connection, {
                    idCaja: data.idCaja, idFondo: metodoPago.idFondo, idEmpresa: data.idEmpresa,
                    tipo: 'EGRESO', origen: 'PAGO_CC_PROVEEDOR', idReferencia: idPagoProveedor,
                    monto: m.monto, descripcion: `Pago a proveedor #${data.idProveedor} (pago #${idPagoProveedor})`,
                    usuario
                });
            }

            let montoRestante = montoTotal;

            // Paso 1: cancelar saldo inicial.
            if (Number(proveedor.inicial) > 0 && montoRestante > 0) {
                const aplicado = Math.min(Number(proveedor.inicial), montoRestante);

                await connection.query("UPDATE proveedores SET inicial = inicial - ? WHERE id = ?", [aplicado, data.idProveedor]);
                await connection.query(
                    `INSERT INTO compras_pagos_proveedor_detalle (idPagoProveedor, idCompra, tipoAplicacion, montoAplicado)
                     VALUES (?, NULL, 'SALDO_INICIAL', ?)`,
                    [idPagoProveedor, aplicado]
                );
                await InsertMovimientoFondo(connection, {
                    idCaja: data.idCaja, idFondo: idFondoCC, idEmpresa: data.idEmpresa,
                    tipo: 'EGRESO', origen: 'PAGO_CC_PROVEEDOR', idReferencia: idPagoProveedor,
                    monto: aplicado, descripcion: `Cancelación saldo inicial proveedor ${data.idProveedor}`, usuario
                });
                montoRestante -= aplicado;
            }

            // Paso 2: FIFO sobre compras impagas.
            const comprasImpagas = await ObtenerComprasImpagas(connection, data.idProveedor);

            for (const compra of comprasImpagas) {
                if (montoRestante <= 0) break;

                const deuda = Number(compra.total) - Number(compra.pagado);
                if (deuda <= 0) continue;

                const montoAplicado = Math.min(deuda, montoRestante);

                await connection.query(
                    "INSERT INTO compras_pagos_proveedor_detalle (idPagoProveedor, idCompra, montoAplicado) VALUES (?, ?, ?)",
                    [idPagoProveedor, compra.id, montoAplicado]
                );
                if (montoAplicado === deuda) {
                    await connection.query("UPDATE compras SET impaga = 0 WHERE id = ?", [compra.id]);
                }
                await InsertMovimientoFondo(connection, {
                    idCaja: data.idCaja, idFondo: idFondoCC, idEmpresa: data.idEmpresa,
                    tipo: 'EGRESO', origen: 'PAGO_CC_PROVEEDOR', idReferencia: compra.id,
                    monto: montoAplicado, descripcion: `Cancelación deuda compra #${compra.id}`, usuario
                });
                montoRestante -= montoAplicado;
            }

            // Paso 3: excedente -> saldo a favor del proveedor.
            if (montoRestante > 0) {
                await connection.query(
                    `INSERT INTO compras_pagos_proveedor_detalle (idPagoProveedor, idCompra, tipoAplicacion, montoAplicado)
                     VALUES (?, NULL, 'SALDO_A_FAVOR', ?)`,
                    [idPagoProveedor, montoRestante]
                );
                await InsertMovimientoFondo(connection, {
                    idCaja: data.idCaja, idFondo: idFondoSaldoFavor, idEmpresa: data.idEmpresa,
                    tipo: 'INGRESO', origen: 'AJUSTE', idReferencia: idPagoProveedor,
                    monto: montoRestante, descripcion: `Excedente a saldo a favor proveedor ${data.idProveedor}`, usuario
                });
            }

            await connection.commit();
            return "OK";

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Baja lógica + contra-asientos (NUNCA delete, NUNCA editar el movimiento original) - mejora
    // deliberada sobre el patrón de Clientes (RevertirEntrega borra registros sin revertir fondos,
    // ver comentario al inicio del archivo). Decisión validada con el usuario el 23-jun-2026.
    async RevertirPagoProveedor(idPagoProveedor: any): Promise<string> {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();
            const usuario = SesionServ.LeerSesion().usuario;

            const [rowsPago]: any = await connection.query(
                "SELECT idEmpresa, idCaja, idProveedor, baja FROM compras_pagos_proveedor WHERE id = ? FOR UPDATE",
                [idPagoProveedor]
            );
            if (!rowsPago.length) throw { status: 404, message: 'El pago no existe.' };
            const pago = rowsPago[0];
            if (pago.baja) throw { status: 400, message: 'El pago ya se encuentra revertido.' };

            // Baja lógica primero: así el recálculo de impaga de más abajo, que filtra por
            // "pp.baja IS NULL", ya deja afuera este pago sin necesitar una exclusión especial.
            await connection.query(
                "UPDATE compras_pagos_proveedor SET baja = ? WHERE id = ?",
                [moment().format('YYYY-MM-DD HH:mm'), idPagoProveedor]
            );

            const idFondoCC = await GetFondoVirtual(connection, 'CC_PROVEEDORES');
            const idFondoSaldoFavor = await GetFondoVirtual(connection, 'SALDO_FAVOR_PROVEEDORES');

            // Contra-asiento por cada método: recupera el fondo real de donde había salido la plata.
            const [metodos]: any = await connection.query(
                "SELECT idMetodo, monto FROM compras_pagos_proveedor_metodos WHERE idPagoProveedor = ?",
                [idPagoProveedor]
            );
            for (const m of metodos) {
                const metodoPago = await GetMetodoPago(connection, m.idMetodo);
                await InsertMovimientoFondo(connection, {
                    idCaja: pago.idCaja, idFondo: metodoPago.idFondo, idEmpresa: pago.idEmpresa,
                    tipo: 'INGRESO', origen: 'PAGO_CC_PROVEEDOR', idReferencia: idPagoProveedor,
                    monto: m.monto, descripcion: `Reverso de pago a proveedor #${idPagoProveedor}`, usuario
                });
            }

            // Contra-asiento por cada aplicación: restaura deuda/saldo inicial o anula el saldo a favor
            // generado, según corresponda.
            const [detalles]: any = await connection.query(
                "SELECT idCompra, tipoAplicacion, montoAplicado FROM compras_pagos_proveedor_detalle WHERE idPagoProveedor = ?",
                [idPagoProveedor]
            );
            for (const d of detalles) {
                if (d.tipoAplicacion === 'SALDO_INICIAL') {
                    await connection.query("UPDATE proveedores SET inicial = inicial + ? WHERE id = ?", [d.montoAplicado, pago.idProveedor]);
                    await InsertMovimientoFondo(connection, {
                        idCaja: pago.idCaja, idFondo: idFondoCC, idEmpresa: pago.idEmpresa,
                        tipo: 'INGRESO', origen: 'PAGO_CC_PROVEEDOR', idReferencia: idPagoProveedor,
                        monto: d.montoAplicado, descripcion: `Reverso cancelación saldo inicial proveedor ${pago.idProveedor}`, usuario
                    });

                } else if (d.tipoAplicacion === 'SALDO_A_FAVOR') {
                    await InsertMovimientoFondo(connection, {
                        idCaja: pago.idCaja, idFondo: idFondoSaldoFavor, idEmpresa: pago.idEmpresa,
                        tipo: 'EGRESO', origen: 'AJUSTE', idReferencia: idPagoProveedor,
                        monto: d.montoAplicado, descripcion: `Reverso de excedente a saldo a favor proveedor ${pago.idProveedor}`, usuario
                    });

                } else if (d.idCompra) {
                    await InsertMovimientoFondo(connection, {
                        idCaja: pago.idCaja, idFondo: idFondoCC, idEmpresa: pago.idEmpresa,
                        tipo: 'INGRESO', origen: 'PAGO_CC_PROVEEDOR', idReferencia: d.idCompra,
                        monto: d.montoAplicado, descripcion: `Reverso cancelación deuda compra #${d.idCompra}`, usuario
                    });

                    const [rowsCompra]: any = await connection.query(
                        `SELECT c.total, IFNULL(pg.pagado, 0) AS pagado
                         FROM compras c
                         LEFT JOIN (
                             SELECT dpd.idCompra, SUM(dpd.montoAplicado) AS pagado
                             FROM compras_pagos_proveedor_detalle dpd
                             INNER JOIN compras_pagos_proveedor pp ON pp.id = dpd.idPagoProveedor AND pp.baja IS NULL
                             WHERE dpd.idCompra = ?
                             GROUP BY dpd.idCompra
                         ) pg ON pg.idCompra = c.id
                         WHERE c.id = ?`,
                        [d.idCompra, d.idCompra]
                    );
                    const compraActual = rowsCompra[0];
                    const impaga = Number(compraActual.pagado) < Number(compraActual.total) ? 1 : 0;
                    await connection.query("UPDATE compras SET impaga = ? WHERE id = ?", [impaga, d.idCompra]);
                }
            }

            await connection.commit();
            return "OK";

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion
}

//#region QUERIES PRIVADAS
// Mismo patrón que ObtenerQuery/ObtenerQueryVentasCliente de cuentasRepository.ts: arma el SELECT
// completo y, si esTotal, lo envuelve en COUNT(*) FROM (...) en vez de paginarlo.
async function ObtenerQueryCuentasProveedores(filtros: any, esTotal: boolean): Promise<string> {
    let filtro = "";
    let filtroEmpresa = "";
    let paginado = "";
    let count = "";
    let endCount = "";

    if (filtros.razonSocial)
        filtro += " AND p.razonSocial LIKE '%" + String(filtros.razonSocial).toUpperCase().trim() + "%'";
    if (filtros.idProveedor)
        filtro += " AND p.id = " + filtros.idProveedor;
    if (!filtros.incluirBaja)
        filtro += " AND p.fechaBaja IS NULL";

    // proveedores no tiene idEmpresa (es compartido entre empresas, a diferencia de compras que
    // sí se registra por empresa) - este filtro es opcional y solo acota las compras agregadas
    // en las CTE, no la lista de proveedores en sí.
    if (filtros.idEmpresa)
        filtroEmpresa = " AND c.idEmpresa = " + filtros.idEmpresa;

    if (esTotal) {
        count = "SELECT COUNT(*) AS total FROM ( ";
        endCount = " ) AS subquery";
    } else {
        if (filtros.tamanioPagina != null)
            paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
    }

    return count + `
        WITH
        -- Deuda pendiente real: solo compras todavía impagas, descontando lo ya aplicado (pago
        -- parcial). Una compra paga en su totalidad sale del cálculo porque impaga pasa a 0
        -- (ver comprasRepository.Agregar / PagarProveedor).
        -- IMPORTANTE (multi-método, 24-jun-2026): desde que una compra puede combinar Cuenta
        -- Corriente con otros métodos (ej: 60% efectivo + 40% CC), la deuda real ya NO es
        -- c.total sino solo la porción tageada CUENTA_CORRIENTE_PROVEEDOR en compras_metodos_pago
        -- (cc.montoCC). Antes de esto cada compra usaba un único método, así que total == montoCC
        -- siempre que impaga = 1; ahora puede ser menor.
        compras_pendientes AS (
            SELECT c.idProveedor, SUM(cc.montoCC - IFNULL(pg.pagado, 0)) AS deuda
            FROM compras c
            INNER JOIN (
                SELECT cmp.idCompra, SUM(cmp.monto) AS montoCC
                FROM compras_metodos_pago cmp
                INNER JOIN metodos_pago mp ON mp.id = cmp.idMetodoPago
                WHERE mp.tipo = 'CUENTA_CORRIENTE_PROVEEDOR'
                GROUP BY cmp.idCompra
            ) cc ON cc.idCompra = c.id
            LEFT JOIN (
                SELECT dpd.idCompra, SUM(dpd.montoAplicado) AS pagado
                FROM compras_pagos_proveedor_detalle dpd
                INNER JOIN compras_pagos_proveedor pp ON pp.id = dpd.idPagoProveedor AND pp.baja IS NULL
                WHERE dpd.idCompra IS NOT NULL
                GROUP BY dpd.idCompra
            ) pg ON pg.idCompra = c.id
            WHERE c.impaga = 1 AND c.baja IS NULL ${filtroEmpresa}
            GROUP BY c.idProveedor
        ),
        -- Saldo a favor generado por excedentes de pago (ver PagarProveedor, Paso 3).
        saldo_favor_generado AS (
            SELECT pp.idProveedor, SUM(dpd.montoAplicado) AS total
            FROM compras_pagos_proveedor_detalle dpd
            INNER JOIN compras_pagos_proveedor pp ON pp.id = dpd.idPagoProveedor AND pp.baja IS NULL
            WHERE dpd.tipoAplicacion = 'SALDO_A_FAVOR'
            GROUP BY pp.idProveedor
        ),
        -- Saldo a favor consumido al pagar (parte de) una compra con método "Saldo a Favor
        -- (Proveedor)". Suma cmp.monto (la porción real tageada con ese método), no c.total -
        -- mismo motivo que compras_pendientes arriba.
        saldo_favor_usado AS (
            SELECT c.idProveedor, SUM(cmp.monto) AS total
            FROM compras_metodos_pago cmp
            INNER JOIN compras c ON c.id = cmp.idCompra
            INNER JOIN metodos_pago mp ON mp.id = cmp.idMetodoPago
            WHERE mp.tipo = 'SALDO_FAVOR_PROVEEDOR' AND c.baja IS NULL ${filtroEmpresa}
            GROUP BY c.idProveedor
        ),
        ultimos_movimientos AS (
            SELECT idProveedor, MAX(fecha) AS ultimaCompra FROM compras WHERE baja IS NULL ${filtroEmpresa} GROUP BY idProveedor
        )
        SELECT
            p.id AS idProveedor,
            p.razonSocial AS proveedor,
            p.inicial AS saldoInicial,
            IFNULL(cp.deuda, 0) AS deuda,
            IFNULL(sfg.total, 0) - IFNULL(sfu.total, 0) AS saldoAFavor,
            (p.inicial + IFNULL(cp.deuda, 0) - (IFNULL(sfg.total, 0) - IFNULL(sfu.total, 0))) AS saldo,
            um.ultimaCompra AS ultimoMovimiento
        FROM proveedores p
        LEFT JOIN compras_pendientes cp ON cp.idProveedor = p.id
        LEFT JOIN saldo_favor_generado sfg ON sfg.idProveedor = p.id
        LEFT JOIN saldo_favor_usado sfu ON sfu.idProveedor = p.id
        LEFT JOIN ultimos_movimientos um ON um.idProveedor = p.id
        WHERE 1 = 1 ${filtro}
        ORDER BY proveedor ASC
        ${paginado}
    ` + endCount;
}

// Mismo patrón UNION ALL que cuentasRepository.ObtenerQueryVentasCliente: cada rama devuelve el mismo
// set de columnas (id, proceso, fecha, comprobante, debe, haber, saldo, estado, referencia,
// observaciones, montoExcedente, orden_tipo) para apilarse como filas de un único ledger cronológico.
// Diferencias deliberadas respecto del espejo en Clientes:
// - COMPRAS no filtra por baja (a diferencia de las ventas, que si tienen fechaBaja IS NULL se ocultan
//   del ledger): una compra anulada sigue mostrándose, tageada 'ANULADA' - mismo criterio que ya usaba
//   GetEstadoCompra en el frontend viejo (ver cuenta-proveedor.component.ts previo a este cambio).
//   Ocultarla reduciría trazabilidad, que es justo lo que el usuario pidió mejorar.
// - PAGOS no se oculta nunca al anularse (a diferencia de Clientes, donde RevertirEntrega borra filas
//   físicamente - deuda técnica ya identificada, ver comentario al inicio del archivo). Un pago
//   anulado queda en el ledger tageado 'ANULADO': RevertirPagoProveedor usa baja lógica, nunca DELETE.
// - montoExcedente viaja como columna propia (0 en INICIAL/COMPRAS) en vez de resolverse con CASE
//   anidados dentro de la rama PAGOS: se combina con "referencia" en JS (ver ObtenerMovimientosProveedor).
async function ObtenerQueryMovimientosProveedor(filtros: any, esTotal: boolean): Promise<string> {
    let paginado = "";
    let count = "";
    let endCount = "";

    if (esTotal) {
        count = "SELECT COUNT(*) AS total FROM ( ";
        endCount = " ) AS subquery";
    } else {
        if (filtros.tamanioPagina != null)
            paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
    }

    return count + `
        SELECT * FROM (
            -- ================= SALDO INICIAL =================
            SELECT
                0 AS id,
                'INICIAL' AS proceso,
                '' AS fecha,
                'SALDO INICIAL' AS comprobante,
                CASE WHEN p.inicialHistorico > 0 THEN p.inicialHistorico ELSE 0 END AS debe,
                CASE WHEN p.inicialHistorico < 0 THEN ABS(p.inicialHistorico) ELSE 0 END AS haber,
                p.inicialHistorico AS saldo,
                'INICIAL' AS estado,
                '' AS referencia,
                '' AS observaciones,
                0 AS montoExcedente,
                0 AS orden_tipo
            FROM proveedores p
            WHERE p.id = ?

            UNION ALL

            -- ================= COMPRAS (DEBE) =================
            -- debe = montoCC (porción CC de la compra), no c.total: una compra puede combinar
            -- CC con otros métodos de pago (multi-método, 24-jun-2026).
            SELECT
                c.id,
                'COMPRA' AS proceso,
                CONCAT(c.fecha, ' 00:00:00') AS fecha,
                CONCAT(tc.descripcion, ' ', c.nroComprobante) AS comprobante,
                IFNULL(cc.montoCC, 0) AS debe,
                0 AS haber,
                IFNULL(cc.montoCC, 0) AS saldo,
                CASE
                    WHEN c.baja IS NOT NULL THEN 'ANULADA'
                    WHEN IFNULL(pg.pagado, 0) >= IFNULL(cc.montoCC, 0) THEN 'PAGADA'
                    WHEN IFNULL(pg.pagado, 0) > 0 THEN 'PARCIAL'
                    ELSE 'IMPAGA'
                END AS estado,
                '' AS referencia,
                '' AS observaciones,
                0 AS montoExcedente,
                1 AS orden_tipo
            FROM compras c
            LEFT JOIN tipos_comprobantes tc ON tc.id = c.idTipoComprobante
            LEFT JOIN (
                SELECT cmp.idCompra, SUM(cmp.monto) AS montoCC
                FROM compras_metodos_pago cmp
                INNER JOIN metodos_pago mp ON mp.id = cmp.idMetodoPago
                WHERE mp.tipo = 'CUENTA_CORRIENTE_PROVEEDOR'
                GROUP BY cmp.idCompra
            ) cc ON cc.idCompra = c.id
            LEFT JOIN (
                SELECT dpd.idCompra, SUM(dpd.montoAplicado) AS pagado
                FROM compras_pagos_proveedor_detalle dpd
                INNER JOIN compras_pagos_proveedor pp ON pp.id = dpd.idPagoProveedor AND pp.baja IS NULL
                WHERE dpd.idCompra IS NOT NULL
                GROUP BY dpd.idCompra
            ) pg ON pg.idCompra = c.id
            WHERE c.idProveedor = ?

            UNION ALL

            -- ================= PAGOS (HABER) =================
            -- referencia resume a qué se aplicó el pago (la compra puntual, "VARIAS COMPRAS (n)" o
            -- "SALDO INICIAL"); montoExcedente viaja aparte y se combina en JS con "+ EXCEDENTE A FAVOR".
            SELECT
                pp.id,
                'PAGO' AS proceso,
                CONCAT(DATE(pp.fecha), ' ', TIME_FORMAT(pp.hora, '%H:%i:%s')) AS fecha,
                CONCAT('PAGO # ', LPAD(pp.id, 8, '0')) AS comprobante,
                0 AS debe,
                pp.total AS haber,
                -pp.total AS saldo,
                CASE WHEN pp.baja IS NOT NULL THEN 'ANULADO' ELSE '' END AS estado,
                CASE
                    WHEN COUNT(DISTINCT d.idCompra) = 1 THEN
                        MAX(CONCAT(tc2.descripcion, ' ', c2.nroComprobante))
                    WHEN COUNT(DISTINCT d.idCompra) > 1 THEN
                        CONCAT('VARIAS COMPRAS (', COUNT(DISTINCT d.idCompra), ')')
                    WHEN SUM(CASE WHEN d.tipoAplicacion = 'SALDO_INICIAL' THEN 1 ELSE 0 END) > 0 THEN
                        'SALDO INICIAL'
                    ELSE ''
                END AS referencia,
                pp.observaciones AS observaciones,
                SUM(CASE WHEN d.tipoAplicacion = 'SALDO_A_FAVOR' THEN d.montoAplicado ELSE 0 END) AS montoExcedente,
                2 AS orden_tipo
            FROM compras_pagos_proveedor pp
            LEFT JOIN compras_pagos_proveedor_detalle d ON d.idPagoProveedor = pp.id
            LEFT JOIN compras c2 ON c2.id = d.idCompra
            LEFT JOIN tipos_comprobantes tc2 ON tc2.id = c2.idTipoComprobante
            WHERE pp.idProveedor = ?
            GROUP BY pp.id

        ) movimientos
        ORDER BY fecha DESC, orden_tipo DESC
    ` + paginado + endCount;
}

// Devuelve "total" = la porción de cada compra pagada con Cuenta Corriente (Proveedor), NO
// compra.total. PagarProveedor (Paso 2, FIFO) usa este campo como la deuda real a cancelar -
// se mantiene el nombre "total" (en vez de renombrar a montoCC) para no tocar ese consumidor,
// pero conceptualmente es montoCC desde el multi-método (24-jun-2026).
async function ObtenerComprasImpagas(connection, idProveedor: number) {
    const consulta = `
        SELECT c.id, cc.montoCC AS total, IFNULL(pg.pagado, 0) AS pagado
        FROM compras c
        INNER JOIN (
            SELECT cmp.idCompra, SUM(cmp.monto) AS montoCC
            FROM compras_metodos_pago cmp
            INNER JOIN metodos_pago mp ON mp.id = cmp.idMetodoPago
            WHERE mp.tipo = 'CUENTA_CORRIENTE_PROVEEDOR'
            GROUP BY cmp.idCompra
        ) cc ON cc.idCompra = c.id
        LEFT JOIN (
            SELECT dpd.idCompra, SUM(dpd.montoAplicado) AS pagado
            FROM compras_pagos_proveedor_detalle dpd
            INNER JOIN compras_pagos_proveedor pp ON pp.id = dpd.idPagoProveedor AND pp.baja IS NULL
            WHERE dpd.idCompra IS NOT NULL
            GROUP BY dpd.idCompra
        ) pg ON pg.idCompra = c.id
        WHERE c.impaga = 1
        AND c.baja IS NULL
        AND c.idProveedor = ?
        ORDER BY c.fecha ASC, c.id ASC
    `;
    const [rows] = await connection.query(consulta, [idProveedor]);
    return rows as any[];
}

// Saldo a favor disponible de UN proveedor (generado por excedentes de pago menos lo ya
// consumido pagando compras con método "Saldo a Favor (Proveedor)"). Recibe la connection de
// quien llama (no abre su propia conexión) para poder usarse dentro de la transacción de
// comprasRepository.Agregar al validar el cap server-side (decisión del cliente, 24-jun-2026).
export async function ObtenerSaldoAFavorProveedor(connection, idProveedor: number): Promise<number> {
    const consulta = `
        SELECT
            IFNULL((
                SELECT SUM(dpd.montoAplicado)
                FROM compras_pagos_proveedor_detalle dpd
                INNER JOIN compras_pagos_proveedor pp ON pp.id = dpd.idPagoProveedor AND pp.baja IS NULL
                WHERE dpd.tipoAplicacion = 'SALDO_A_FAVOR' AND pp.idProveedor = ?
            ), 0)
            -
            IFNULL((
                SELECT SUM(cmp.monto)
                FROM compras_metodos_pago cmp
                INNER JOIN compras c ON c.id = cmp.idCompra
                INNER JOIN metodos_pago mp ON mp.id = cmp.idMetodoPago
                WHERE mp.tipo = 'SALDO_FAVOR_PROVEEDOR' AND c.baja IS NULL AND c.idProveedor = ?
            ), 0)
        AS saldoAFavor
    `;
    const [rows]: any = await connection.query(consulta, [idProveedor, idProveedor]);
    return parseFloat(rows[0].saldoAFavor);
}

async function GetMetodoPago(connection, idMetodoPago: number): Promise<{ idFondo: number; tipo: string }> {
    const [rows] = await connection.query(
        'SELECT idFondo, tipo FROM metodos_pago WHERE id = ?',
        [idMetodoPago]
    );
    if (!rows.length) throw new Error(`Método de pago ${idMetodoPago} no encontrado.`);
    return rows[0];
}

async function GetFondoVirtual(connection, tipo: string): Promise<number> {
    const [rows]: any = await connection.query("SELECT id FROM fondos WHERE tipo = ? AND activo = 1", [tipo]);
    if (!rows.length) throw new Error(`Fondo virtual de tipo '${tipo}' no encontrado.`);
    return rows[0].id;
}

async function InsertMovimientoFondo(connection, movimiento): Promise<void> {
    const consulta = `
        INSERT INTO movimientos_fondos
            (idCaja, idFondo, tipo, origen, idEmpresa, idReferencia, monto, descripcion, usuario)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const parametros = [
        movimiento.idCaja,
        movimiento.idFondo,
        movimiento.tipo,
        movimiento.origen,
        movimiento.idEmpresa ?? null,
        movimiento.idReferencia ?? null,
        movimiento.monto,
        movimiento.descripcion ?? null,
        movimiento.usuario ?? null
    ];
    await connection.query(consulta, parametros);
}
//#endregion

export const ComprasCuentasRepo = new ComprasCuentasRepository();
