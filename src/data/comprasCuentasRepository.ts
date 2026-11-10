import db from '../db';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { ResultSetHeader } from 'mysql2';
import { ValidarPiernasCheque, EmitirChequePropio, EndosarValor, RevertirPiernaCheque } from './chequesRepository';
import { ChequePropioDTO } from '../models/ChequePropio';
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
    cheque?: ChequePropioDTO;   // solo con método CHEQUE_PROPIO (importe = monto)
    idValorAcreditar?: number;  // solo con método CHEQUE: cheque de terceros PENDIENTE a endosar (monto = su importe)
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
                // Ampliado 7-nov-2026 para la Orden de Pago A4: datos de empresa y proveedor. El domicilio sale
                // de UNA sola fila de direcciones_proveedor (subquery con LIMIT 1: un JOIN directo duplicaría
                // el header si el proveedor tiene varias). Se prioriza "resumen" si viene cargado; si no, se
                // arma con calle/número/localidad/provincia. Menor id = la primera que se cargó.
                `SELECT pp.*, p.razonSocial AS proveedor,
                        p.documento AS proveedorDocumento, ci.descripcion AS proveedorCondicionIva,
                        (SELECT COALESCE(NULLIF(TRIM(d.resumen), ''),
                                         NULLIF(TRIM(CONCAT_WS(' ', d.calle, d.numero, CONCAT_WS(', ', d.localidad, d.provincia))), ''))
                         FROM direcciones_proveedor d
                         WHERE d.idProveedor = pp.idProveedor
                         ORDER BY d.id ASC LIMIT 1) AS proveedorDomicilio,
                        e.razonSocial AS empresaRazonSocial, e.cuil AS empresaCuit, e.condicion AS empresaCondicion,
                        e.direccion AS empresaDireccion, e.IIBB AS empresaIibb, e.inicioAct AS empresaInicioAct
                 FROM compras_pagos_proveedor pp
                 LEFT JOIN proveedores p ON p.id = pp.idProveedor
                 LEFT JOIN condiciones_iva ci ON ci.id = p.idCondIva
                 LEFT JOIN empresas e ON e.id = pp.idEmpresa
                 WHERE pp.id = ?`,
                [idPagoProveedor]
            );
            if (!rowsHeader.length) return null;
            const header = rowsHeader[0];

            const [metodos]: any = await connection.query(
                `SELECT m.idMetodo, m.monto, mp.nombre AS metodoPago, mp.tipo AS tipoMetodo,
                        m.idChequeEmitido, ce.tipo AS chequeTipo, ce.numero AS chequeNumero,
                        ce.fechaEmision AS chequeFechaEmision, ce.fechaPago AS chequeFechaPago,
                        ce.estado AS chequeEstado, fb.nombre AS chequeBanco,
                        m.idValorAcreditar, ch.numero AS endosoNumero, ch.banco AS endosoBanco,
                        ch.libradorNombre AS endosoLibrador, ch.fechaCobro AS endosoFechaCobro
                 FROM compras_pagos_proveedor_metodos m
                 LEFT JOIN metodos_pago mp ON mp.id = m.idMetodo
                 LEFT JOIN cheques_emitidos ce ON ce.id = m.idChequeEmitido
                 LEFT JOIN fondos fb ON fb.id = ce.idFondoBanco
                 LEFT JOIN cheques ch ON ch.idValor = m.idValorAcreditar
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
            if (!filtros.idProveedor) throw new AppError(CodigoError.VALIDACION, 'Debe indicar un proveedor.', 400, { modulo: 'ComprasCuentasRepo', metodo: 'ObtenerMovimientosProveedor' });

            const queryRegistros = await ObtenerQueryMovimientosProveedor(filtros, false);
            const queryTotal = await ObtenerQueryMovimientosProveedor(filtros, true);

            // idProveedor se repite 3 veces (una por rama del UNION ALL) - mismo idProveedor, no son
            // filtros distintos. Los filtros del extracto (proceso/fechas) van después, en el mismo orden
            // en que aparecen los ? en la capa externa de la query.
            const params = [filtros.idProveedor, filtros.idProveedor, filtros.idProveedor, ...ArmarFiltroMovimientos(filtros).params];
            const [rows] = await connection.query(queryRegistros, params);
            const resultado = await connection.query(queryTotal, params);

            if (Array.isArray(rows)) (rows as any[]).forEach(ParsearMovimientoProveedor);

            return { total: (resultado[0] as any)[0].total, registros: rows };

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    // Saldos de todos los proveedores para el Excel (files/cuentas-proveedores-excel): mismos filtros que la
    // grilla pero SIN paginado (tamanioPagina null). Reutiliza ObtenerCuentasProveedores para que el saldo y el
    // estado del Excel sean exactamente los de la pantalla.
    async ObtenerCuentasProveedoresParaExcel(filtros: any) {
        const resultado = await this.ObtenerCuentasProveedores({ ...filtros, pagina: 1, tamanioPagina: null });
        return resultado.registros as any[];
    }

    // Extracto completo para "Imprimir Reporte" (espejo de cuentasRepository.ObtenerVentasClienteReporte): mismos
    // filtros que la grilla pero SIN paginado y en orden cronológico ascendente. El saldo de cada fila es el real
    // acumulado, aunque se filtre la vista.
    async ObtenerMovimientosProveedorReporte(filtros: any) {
        const connection = await db.getConnection();

        try {
            if (!filtros.idProveedor) throw new AppError(CodigoError.VALIDACION, 'Debe indicar un proveedor.', 400, { modulo: 'ComprasCuentasRepo', metodo: 'ObtenerMovimientosProveedorReporte' });

            const query = await ObtenerQueryMovimientosProveedor(filtros, false, true);
            const params = [filtros.idProveedor, filtros.idProveedor, filtros.idProveedor, ...ArmarFiltroMovimientos(filtros).params];
            const [rows] = await connection.query(query, params);

            if (Array.isArray(rows)) (rows as any[]).forEach(ParsearMovimientoProveedor);

            return rows;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    async PagarProveedor(data: PagarProveedorDTO, usuario: string): Promise<string> {
        const connection = await db.getConnection();

        try {
            if (!data.metodos?.length) throw new AppError(CodigoError.VALIDACION, 'Debe indicar al menos un método de pago.', 400, { modulo: 'ComprasCuentasRepo', metodo: 'PagarProveedor' });

            const montoTotal = data.metodos.reduce((acc, m) => acc + Number(m.monto), 0);
            if (montoTotal <= 0) throw new AppError(CodigoError.VALIDACION, 'El monto del pago debe ser mayor a cero.', 400, { modulo: 'ComprasCuentasRepo', metodo: 'PagarProveedor' });

            // Cheque propio / endoso: datos completos, cuenta de la empresa, sin duplicados (ver chequesRepository).
            const errorCheque = await ValidarPiernasCheque(connection, data.metodos, data.idEmpresa);
            if (errorCheque) throw new AppError(CodigoError.VALIDACION, errorCheque, 400, { modulo: 'ComprasCuentasRepo', metodo: 'PagarProveedor' });

            await connection.beginTransaction();

            const [rowsProveedor]: any = await connection.query(
                "SELECT inicial FROM proveedores WHERE id = ? FOR UPDATE",
                [data.idProveedor]
            );
            if (!rowsProveedor.length) throw new AppError(CodigoError.NOT_FOUND, 'El proveedor no existe.', 404, { modulo: 'ComprasCuentasRepo', metodo: 'PagarProveedor' });
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
            const ctxCheque = { idEmpresa: data.idEmpresa, idProveedor: data.idProveedor, usuario };
            for (const m of data.metodos) {
                const metodoPago = await GetMetodoPago(connection, m.idMetodo);

                // El egreso del fondo (puente para CHEQUE_PROPIO, Valores a Acreditar para CHEQUE) lo hace el
                // movimiento de más abajo; acá solo se crea/marca el instrumento y se deja el vínculo en la pierna.
                // Un cheque de más valor que la deuda no necesita nada especial: el excedente cae solo en el
                // Paso 3 (saldo a favor del proveedor).
                let idChequeEmitido: number | null = null;
                let idValorAcreditar: number | null = null;
                if (metodoPago.tipo === 'CHEQUE_PROPIO') {
                    idChequeEmitido = await EmitirChequePropio(connection, m, ctxCheque);
                } else if (metodoPago.tipo === 'CHEQUE') {
                    idValorAcreditar = Number(m.idValorAcreditar);
                    await EndosarValor(connection, idValorAcreditar, Number(m.monto), ctxCheque);
                }

                await connection.query(
                    "INSERT INTO compras_pagos_proveedor_metodos (idPagoProveedor, idMetodo, monto, idChequeEmitido, idValorAcreditar) VALUES (?, ?, ?, ?, ?)",
                    [idPagoProveedor, m.idMetodo, m.monto, idChequeEmitido, idValorAcreditar]
                );
                if (MetodoMueveFondo(metodoPago.tipo)) {
                    await InsertMovimientoFondo(connection, {
                        idCaja: data.idCaja, idFondo: metodoPago.idFondo, idEmpresa: data.idEmpresa,
                        tipo: 'EGRESO', origen: 'PAGO_CC_PROVEEDOR', idReferencia: idPagoProveedor,
                        tipoReferencia: 'COMPRA_PAGO_PROVEEDOR',
                        monto: m.monto, descripcion: `Pago a proveedor #${data.idProveedor} (pago #${idPagoProveedor})`,
                        usuario
                    });
                }
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
                    tipoReferencia: 'COMPRA_PAGO_PROVEEDOR',
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
                    tipoReferencia: 'COMPRA',
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
                    tipoReferencia: 'COMPRA_PAGO_PROVEEDOR',
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
    async RevertirPagoProveedor(idPagoProveedor: any, motivo: any, usuario: string): Promise<string> {
        // Motivo obligatorio (7-nov-2026), mismo patrón que la baja de compra. Se valida antes de abrir
        // conexión/transacción para no bloquear filas por un request inválido.
        const motivoLimpio = String(motivo ?? '').trim();
        if (!motivoLimpio) throw new AppError(CodigoError.VALIDACION, 'Indicá el motivo de la anulación.', 400, { modulo: 'ComprasCuentasRepo', metodo: 'RevertirPagoProveedor', idPagoProveedor });

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [rowsPago]: any = await connection.query(
                "SELECT idEmpresa, idCaja, idProveedor, baja FROM compras_pagos_proveedor WHERE id = ? FOR UPDATE",
                [idPagoProveedor]
            );
            if (!rowsPago.length) throw new AppError(CodigoError.NOT_FOUND, 'El pago no existe.', 404, { modulo: 'ComprasCuentasRepo', metodo: 'RevertirPagoProveedor', idPagoProveedor });
            const pago = rowsPago[0];
            if (pago.baja) throw new AppError(CodigoError.VALIDACION, 'El pago ya se encuentra revertido.', 400, { modulo: 'ComprasCuentasRepo', metodo: 'RevertirPagoProveedor', idPagoProveedor });

            // Instrumentos de cheque primero, antes de la baja lógica y de cualquier contra-asiento: un cheque
            // propio ya debitado, o un pago con cheque anterior al circuito nuevo (sin vínculo), frena todo el
            // reverso. Si algo tira, la transacción entera hace rollback.
            const [metodos]: any = await connection.query(
                "SELECT idMetodo, monto, idChequeEmitido, idValorAcreditar FROM compras_pagos_proveedor_metodos WHERE idPagoProveedor = ?",
                [idPagoProveedor]
            );
            for (const m of metodos) {
                const metodoPago = await GetMetodoPago(connection, m.idMetodo);
                await RevertirPiernaCheque(connection, {
                    tipoMetodo: metodoPago.tipo, idChequeEmitido: m.idChequeEmitido, idValorAcreditar: m.idValorAcreditar
                });
            }

            // Baja lógica primero: así el recálculo de impaga de más abajo, que filtra por
            // "pp.baja IS NULL", ya deja afuera este pago sin necesitar una exclusión especial.
            await connection.query(
                "UPDATE compras_pagos_proveedor SET baja = ?, observacionBaja = ?, usuarioBaja = ? WHERE id = ?",
                [moment().format('YYYY-MM-DD HH:mm'), motivoLimpio.substring(0, 300), usuario, idPagoProveedor]
            );

            const idFondoCC = await GetFondoVirtual(connection, 'CC_PROVEEDORES');
            const idFondoSaldoFavor = await GetFondoVirtual(connection, 'SALDO_FAVOR_PROVEEDORES');

            // Contra-asiento por cada método: recupera el fondo real de donde había salido la plata.
            for (const m of metodos) {
                const metodoPago = await GetMetodoPago(connection, m.idMetodo);
                if (MetodoMueveFondo(metodoPago.tipo)) {
                    await InsertMovimientoFondo(connection, {
                        idCaja: pago.idCaja, idFondo: metodoPago.idFondo, idEmpresa: pago.idEmpresa,
                        tipo: 'INGRESO', origen: 'PAGO_CC_PROVEEDOR', idReferencia: idPagoProveedor,
                        tipoReferencia: 'COMPRA_PAGO_PROVEEDOR',
                        monto: m.monto, descripcion: `Reverso de pago a proveedor #${idPagoProveedor}`, usuario
                    });
                }
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
                        tipoReferencia: 'COMPRA_PAGO_PROVEEDOR',
                        monto: d.montoAplicado, descripcion: `Reverso cancelación saldo inicial proveedor ${pago.idProveedor}`, usuario
                    });

                } else if (d.tipoAplicacion === 'SALDO_A_FAVOR') {
                    await InsertMovimientoFondo(connection, {
                        idCaja: pago.idCaja, idFondo: idFondoSaldoFavor, idEmpresa: pago.idEmpresa,
                        tipo: 'EGRESO', origen: 'AJUSTE', idReferencia: idPagoProveedor,
                        tipoReferencia: 'COMPRA_PAGO_PROVEEDOR',
                        monto: d.montoAplicado, descripcion: `Reverso de excedente a saldo a favor proveedor ${pago.idProveedor}`, usuario
                    });

                } else if (d.idCompra) {
                    await InsertMovimientoFondo(connection, {
                        idCaja: pago.idCaja, idFondo: idFondoCC, idEmpresa: pago.idEmpresa,
                        tipo: 'INGRESO', origen: 'PAGO_CC_PROVEEDOR', idReferencia: d.idCompra,
                        tipoReferencia: 'COMPRA',
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
async function ObtenerQueryMovimientosProveedor(filtros: any, esTotal: boolean, esReporte: boolean = false): Promise<string> {
    // Mismo modelo que cuentasRepository.ObtenerQueryVentasCliente: cada rama expone "movimiento" (con
    // signo, lo que realmente mueve el saldo de la CC del proveedor) y la capa intermedia calcula el
    // saldo acumulado en orden cronológico. El acumulado se calcula ANTES del LIMIT, así la página 2
    // continúa el saldo de la 1. Requiere MySQL 8 (window functions).
    //  - movimiento de COMPRA = montoCC + montoSaldoFavor (misma base que el saldo de ObtenerCuentasProveedores).
    //  - Convención contable del proveedor (pedido del cliente, 9-nov-2026): es una cuenta de PASIVO, o sea
    //    "al revés" que la de clientes. Las compras van al HABER (aumentan lo que se le debe) y los pagos al DEBE
    //    (lo reducen). El signo de "movimiento" y el saldo (positivo = se le debe) no cambian: solo las columnas.
    //  - debe/haber de COMPRA son informativos: haber = total de la compra, debe = lo pagado "al contado".
    //  - Compras y pagos ANULADOS se listan (trazabilidad) pero con movimiento 0.
    const ramas = `
            -- ================= SALDO INICIAL =================
            SELECT
                0 AS id,
                'INICIAL' AS proceso,
                '' AS fecha,
                'SALDO INICIAL' AS comprobante,
                CASE WHEN p.inicialHistorico < 0 THEN ABS(p.inicialHistorico) ELSE 0 END AS debe,
                CASE WHEN p.inicialHistorico > 0 THEN p.inicialHistorico ELSE 0 END AS haber,
                p.inicialHistorico AS movimiento,
                'INICIAL' AS estado,
                '' AS referencia,
                '' AS observaciones,
                0 AS montoExcedente,
                0 AS pagado,
                0 AS orden_tipo
            FROM proveedores p
            WHERE p.id = ?

            UNION ALL

            -- ================= COMPRAS =================
            -- Se listan TODAS (también las de baja y las pagadas al contado). Multi-método (24-jun-2026):
            -- montoCC y montoSF mueven el saldo; "contado" (efectivo, transferencia, CHEQUE_PROPIO,
            -- CHEQUE endosado) es pago real en el momento y no lo mueve.
            SELECT
                c.id,
                'COMPRA' AS proceso,
                CONCAT(c.fecha, ' 00:00:00') AS fecha,
                CONCAT(tc.descripcion, ' ', c.nroComprobante) AS comprobante,
                IFNULL(mt.contado, 0) AS debe,
                c.total AS haber,
                CASE WHEN c.baja IS NOT NULL THEN 0 ELSE IFNULL(mt.montoCC, 0) + IFNULL(mt.montoSF, 0) END AS movimiento,
                CASE
                    WHEN c.baja IS NOT NULL THEN 'ANULADA'
                    WHEN IFNULL(mt.montoCC, 0) + IFNULL(mt.montoSF, 0) = 0 THEN 'CONTADO'
                    WHEN IFNULL(pg.pagado, 0) >= IFNULL(mt.montoCC, 0) THEN 'PAGADA'
                    WHEN IFNULL(pg.pagado, 0) > 0 THEN 'PARCIAL'
                    ELSE 'IMPAGA'
                END AS estado,
                '' AS referencia,
                IFNULL(c.observacionBaja, '') AS observaciones,
                0 AS montoExcedente,
                IFNULL(pg.pagado, 0) AS pagado,
                1 AS orden_tipo
            FROM compras c
            LEFT JOIN tipos_comprobantes tc ON tc.id = c.idTipoComprobante
            LEFT JOIN (
                SELECT cmp.idCompra,
                       SUM(CASE WHEN mp.tipo = 'CUENTA_CORRIENTE_PROVEEDOR' THEN cmp.monto ELSE 0 END) AS montoCC,
                       SUM(CASE WHEN mp.tipo = 'SALDO_FAVOR_PROVEEDOR' THEN cmp.monto ELSE 0 END) AS montoSF,
                       SUM(CASE WHEN mp.tipo NOT IN ('CUENTA_CORRIENTE_PROVEEDOR', 'SALDO_FAVOR_PROVEEDOR') THEN cmp.monto ELSE 0 END) AS contado
                FROM compras_metodos_pago cmp
                INNER JOIN metodos_pago mp ON mp.id = cmp.idMetodoPago
                GROUP BY cmp.idCompra
            ) mt ON mt.idCompra = c.id
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
                CONCAT('ORDEN DE PAGO # ', LPAD(pp.id, 8, '0')) AS comprobante,
                pp.total AS debe,
                0 AS haber,
                CASE WHEN pp.baja IS NOT NULL THEN 0 ELSE -pp.total END AS movimiento,
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
                0 AS pagado,
                2 AS orden_tipo
            FROM compras_pagos_proveedor pp
            LEFT JOIN compras_pagos_proveedor_detalle d ON d.idPagoProveedor = pp.id
            LEFT JOIN compras c2 ON c2.id = d.idCompra
            LEFT JOIN tipos_comprobantes tc2 ON tc2.id = c2.idTipoComprobante
            WHERE pp.idProveedor = ?
            GROUP BY pp.id
    `;

    const { where } = ArmarFiltroMovimientos(filtros);

    // El conteo no necesita el acumulado: se evita la window function. Los filtros se aplican igual que en la
    // grilla para que el total del paginador coincida con lo que se lista.
    if (esTotal)
        return `SELECT COUNT(*) AS total FROM ( ${ramas} ) AS subquery WHERE 1 = 1 ${where}`;

    // El reporte va sin paginado y cronológico (como un extracto); la grilla, paginada y la más nueva primero.
    let paginado = "";
    if (!esReporte && filtros.tamanioPagina != null)
        paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);

    const orden = esReporte
        ? "ORDER BY fecha ASC, orden_tipo ASC, id ASC"
        : "ORDER BY fecha DESC, orden_tipo DESC, id DESC";

    // id ASC como desempate: varias compras del mismo día comparten fecha 00:00:00; sin desempate el
    // acumulado podía cambiar entre recargas/páginas. El filtro (WHERE) va en la capa más externa, DESPUÉS
    // del acumulado: así el saldo de cada fila es el real aunque se filtre la vista.
    return `
        SELECT * FROM (
            SELECT m.*,
                   SUM(m.movimiento) OVER (
                       ORDER BY m.fecha ASC, m.orden_tipo ASC, m.id ASC
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                   ) AS saldo
            FROM ( ${ramas} ) m
        ) movimientos
        WHERE 1 = 1 ${where}
        ${orden}
    ` + paginado;
}

// Filtros del extracto (proceso y rango de fechas), parametrizados. "proceso" se valida contra lista blanca.
// Si el rango trae solo la fecha desde (el datepicker de rango deja hasta en null), se toma ese único día.
// Las filas INICIAL no tienen fecha (''), así que un filtro por fechas las excluye (igual que en clientes).
function ArmarFiltroMovimientos(filtros: any): { where: string, params: any[] } {
    let where = "";
    const params: any[] = [];

    if (['INICIAL', 'COMPRA', 'PAGO'].includes(filtros.proceso)) {
        where += " AND proceso = ?";
        params.push(filtros.proceso);
    }

    if (Array.isArray(filtros.fechas) && filtros.fechas[0]) {
        const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
        const hasta = moment.utc(filtros.fechas[1] ?? filtros.fechas[0]).add(1, 'day').format('YYYY-MM-DD');
        where += " AND fecha >= ? AND fecha < ?";
        params.push(desde, hasta);
    }

    return { where, params };
}

// Normaliza una fila del ledger: numéricos y excedente de saldo a favor (ver comentario en el cuerpo).
function ParsearMovimientoProveedor(row: any): void {
    row.debe = parseFloat(row.debe);
    row.haber = parseFloat(row.haber);
    row.saldo = parseFloat(row.saldo);
    row.movimiento = parseFloat(row.movimiento);
    row.pagado = parseFloat(row.pagado);

    // El excedente que un pago generó como saldo a favor se resuelve aquí (no con CASE anidados en SQL): es
    // justo el dato que el usuario no podía ver antes ("le pago una reserva... como se yo que tiene saldo a
    // favor mio por eso?"). El monto exacto del excedente queda disponible en "Ver Detalle" (ObtenerPagoProveedor).
    const montoExcedente = parseFloat(row.montoExcedente);
    if (montoExcedente > 0) {
        row.referencia = row.referencia
            ? `${row.referencia} + EXCEDENTE A FAVOR`
            : 'EXCEDENTE A FAVOR';
    }
    delete row.montoExcedente;
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

// Tipos de método de pago que NO generan movimientos en Fondos (decisión del cliente: pagos con tarjeta a
// proveedores no se ven en Fondos). Quedan registrados en las tablas de pagos, pero sin asiento de fondo.
const TIPOS_METODO_SIN_FONDO = ['TARJETA_PROVEEDOR'];
export function MetodoMueveFondo(tipo: string): boolean {
    return !TIPOS_METODO_SIN_FONDO.includes(tipo);
}

async function GetFondoVirtual(connection, tipo: string): Promise<number> {
    const [rows]: any = await connection.query("SELECT id FROM fondos WHERE tipo = ? AND activo = 1", [tipo]);
    if (!rows.length) throw new Error(`Fondo virtual de tipo '${tipo}' no encontrado.`);
    return rows[0].id;
}

async function InsertMovimientoFondo(connection, movimiento): Promise<void> {
    const consulta = `
        INSERT INTO movimientos_fondos
            (idCaja, idFondo, tipo, origen, idEmpresa, idReferencia, tipoReferencia, monto, descripcion, usuario)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const parametros = [
        movimiento.idCaja,
        movimiento.idFondo,
        movimiento.tipo,
        movimiento.origen,
        movimiento.idEmpresa ?? null,
        movimiento.idReferencia ?? null,
        movimiento.tipoReferencia ?? null,
        movimiento.monto,
        movimiento.descripcion ?? null,
        movimiento.usuario ?? null
    ];
    await connection.query(consulta, parametros);
}
//#endregion

export const ComprasCuentasRepo = new ComprasCuentasRepository();
