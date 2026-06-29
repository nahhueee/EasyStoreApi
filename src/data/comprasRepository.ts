import db from '../db';
import { Compra, DetalleCompra, CompraIva, CompraPercepcionIibb, PagoCompra } from '../models/Compra';
import { ResultSetHeader } from 'mysql2';
import { SesionServ } from '../services/sesionService';
import { ObtenerSaldoAFavorProveedor } from './comprasCuentasRepository';
const moment = require('moment');

// Tipo de comprobante "Cotización" (tipos_comprobantes.id = 99, reutilizado de Ventas).
// Una compra registrada como Cotización es informativa: no impacta fondos ni (a futuro) cuenta corriente.

class ComprasRepository {

    //#region OBTENER
    async Obtener(filtros: any) {
        const connection = await db.getConnection();

        try {
            let queryRegistros = ObtenerQuery(filtros, false);
            let queryTotal = ObtenerQuery(filtros, true);

            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            if (Array.isArray(rows)) {
                for (const row of rows) ParsearTotalesCompra(row);
            }

            return { total: resultado[0][0].total, registros: rows };

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    async ObtenerUna(idCompra: any) {
        const connection = await db.getConnection();

        try {
            const query = ObtenerQuery({ idCompra, incluirBaja: true }, false); // Una compra debe poder verse por id sin importar su estado de baja.
            const [rows] = await connection.query(query);

            if (!Array.isArray(rows) || rows.length === 0) return null;

            const compra: any = rows[0];
            ParsearTotalesCompra(compra);
            compra.detalle = await ObtenerDetalleCompra(connection, compra.id);
            compra.iva = await ObtenerIvaCompra(connection, compra.id);
            compra.percepcionesIibb = await ObtenerPercepcionesIibb(connection, compra.id);
            compra.pagos = await ObtenerPagosCompra(connection, compra.id);

            return compra;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    async SelectorMetodosPago(idEmpresa: any) {
        const connection = await db.getConnection();

        try {
            // Compras admite todos los métodos de pago de la empresa salvo Débito/Crédito/Saldo a favor/Cuenta Corriente
            // (esos son mecanismos de cobro a clientes, no de pago a proveedores en F1).
            // RIESGO conocido: esto deja pasar CHEQUE, que en F1 generaría egreso inmediato como si fuera efectivo
            // (no hay todavía lógica de cheque propio diferido, eso es Fase 3). No se resuelve ahora, queda anotado.
            const query = `
                SELECT mp.id, mp.tipo,
                    CASE
                        WHEN mp.tipo = 'TRANSFERENCIA' THEN CONCAT(f.nombre, ' - Transferencia')
                        ELSE mp.nombre
                    END AS descripcion
                FROM metodos_pago mp
                INNER JOIN fondos f ON f.id = mp.idFondo
                WHERE mp.idEmpresa = ? AND mp.tipo NOT IN ('DEBITO', 'CREDITO', 'SALDO_FAVOR', 'CUENTA_CORRIENTE')
            `;
            const [rows] = await connection.query(query, [idEmpresa]);
            return rows;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    async Agregar(compra: Compra): Promise<string> {
        const connection = await db.getConnection();

        try {
            // Multi-método (decisión 24-jun-2026, mismo patrón que Ventas/Entrega de Dinero): la compra se
            // cubre con N pagos en vez de un único idMetodoPago. Toda la validación de negocio corre ANTES
            // de abrir la transacción porque comprasRoute.ts descarta el mensaje real de cualquier excepción
            // lanzada dentro del catch (responde siempre "Error al intentar agregar la compra.") - un error
            // de validación tiene que volver como string, no como throw.
            if (!compra.pagos || compra.pagos.length === 0) {
                return "Debe ingresar al menos un método de pago.";
            }

            const totales = CalcularTotales(compra);

            const pagosResueltos: { idMetodo: number; tipo: string; idFondo: number; monto: number }[] = [];
            for (const pago of compra.pagos) {
                if (!pago.idMetodo || !pago.monto || Number(pago.monto) <= 0) {
                    return "Cada pago debe tener un método y un monto mayor a cero.";
                }
                const metodoPago = await GetMetodoPago(connection, pago.idMetodo);
                pagosResueltos.push({ idMetodo: pago.idMetodo, tipo: metodoPago.tipo, idFondo: metodoPago.idFondo, monto: Number(pago.monto) });
            }

            // A diferencia de Ventas (que autocompleta el remanente en Cuenta Corriente), en Compras un
            // remanente sin cubrir bloquea el guardado: la suma de los pagos tiene que cubrir el total
            // exacto (decisión del cliente, 24-jun-2026).
            const sumaPagos = pagosResueltos.reduce((acc, p) => acc + p.monto, 0);
            if (Math.abs(sumaPagos - totales.total) > 0.01) {
                return "La suma de los pagos no coincide con el total de la compra.";
            }

            // Cap server-side: no se puede pagar con más saldo a favor del que el proveedor tiene
            // disponible (más estricto que el patrón existente de Ventas/Entrega, decisión del cliente,
            // 24-jun-2026). ObtenerSaldoAFavorProveedor recibe esta misma connection (sin transacción
            // todavía) para poder hacer SELECT antes del beginTransaction.
            const sumaSaldoFavor = pagosResueltos.filter(p => p.tipo === 'SALDO_FAVOR_PROVEEDOR').reduce((acc, p) => acc + p.monto, 0);
            if (sumaSaldoFavor > 0) {
                const saldoDisponible = await ObtenerSaldoAFavorProveedor(connection, compra.idProveedor!);
                if (sumaSaldoFavor > saldoDisponible + 0.01) {
                    return "El proveedor no tiene suficiente saldo a favor disponible.";
                }
            }

            await connection.beginTransaction();

            const usuario = SesionServ.LeerSesion().usuario;

            // Cuenta Corriente (Proveedor) marca la compra como impaga (es deuda, no egreso real) - mismo
            // criterio que ventas.impaga. Con multi-método basta con que UNO de los pagos sea CC para que
            // la compra genere deuda (parcial o total - el monto exacto se calcula sobre
            // compras_metodos_pago, no sobre c.total, ver comprasCuentasRepository).
            const esCuentaCorriente = pagosResueltos.some(p => p.tipo === 'CUENTA_CORRIENTE_PROVEEDOR');

            const consulta = `
                INSERT INTO compras
                    (idEmpresa, idProveedor, idCaja, fecha, idTipoComprobante, nroComprobante,
                     totalNeto, totalIva, totalIibb, tasaMunicipal, percepcionIva, retencionGanancia, total, estado, usuario, impaga)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const parametros = [
                compra.idEmpresa, compra.idProveedor, compra.idCaja,
                moment(compra.fecha).format('YYYY-MM-DD'), compra.idTipoComprobante, compra.nroComprobante ?? null,
                totales.totalNeto, totales.totalIva, totales.totalIibb, totales.tasaMunicipal,
                totales.percepcionIva, totales.retencionGanancia, totales.total,
                compra.estado ?? 'Aprobada', usuario, esCuentaCorriente ? 1 : 0
            ];

            const [resultado] = await connection.query<ResultSetHeader>(consulta, parametros);
            compra.id = resultado.insertId;

            if (compra.detalle) {
                for (const linea of compra.detalle) {
                    await InsertDetalleCompra(connection, compra.id, linea);
                }
            }

            if (compra.iva) {
                for (const linea of compra.iva) {
                    await InsertCompraIva(connection, compra.id, linea);
                }
            }

            if (compra.percepcionesIibb) {
                for (const linea of compra.percepcionesIibb) {
                    await InsertCompraPercepcionIibb(connection, compra.id, linea);
                }
            }

            // Un movimiento de Fondos por cada pago (no uno solo por el total): cada método puede pegarle
            // a un fondo distinto. Cuenta Corriente (Proveedor) es la excepción simétrica a "Saldo a
            // Favor" en ventasRepository: no sale plata real (es deuda que se acumula), así que el
            // movimiento es INGRESO en vez de EGRESO. Saldo a Favor (Proveedor) SÍ es EGRESO: consumirlo
            // reduce el crédito disponible igual que si fuera plata real (ver ObtenerSaldoAFavorProveedor /
            // saldo_favor_usado en comprasCuentasRepository).
            for (const pago of pagosResueltos) {
                await connection.query(
                    "INSERT INTO compras_metodos_pago (idCompra, idMetodoPago, monto) VALUES (?, ?, ?)",
                    [compra.id, pago.idMetodo, pago.monto]
                );

                await InsertMovimientoFondo(connection, {
                    idCaja: compra.idCaja,
                    idFondo: pago.idFondo,
                    idEmpresa: compra.idEmpresa,
                    tipo: pago.tipo === 'CUENTA_CORRIENTE_PROVEEDOR' ? 'INGRESO' : 'EGRESO',
                    origen: 'PAGO_PROVEEDOR',
                    idReferencia: compra.id,
                    monto: pago.monto,
                    descripcion: `Compra #${compra.id}`,
                    usuario
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

    async Eliminar(compra: any): Promise<string> {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const usuario = SesionServ.LeerSesion().usuario;

            // No confiamos en lo que venga del front: traemos el estado real de la compra con FOR UPDATE
            // (bloquea la fila dentro de la transacción) para decidir si hay que revertir el egreso en Fondos
            // y para evitar un doble reverso si el endpoint se llama dos veces (no hay otro guard más arriba).
            const [rows]: any = await connection.query(
                "SELECT idCaja, idEmpresa, idTipoComprobante, baja FROM compras WHERE id = ? FOR UPDATE",
                [compra.id]
            );
            const compraActual = rows[0];

            if (!compraActual) throw { status: 404, message: 'La compra no existe.' };
            if (compraActual.baja) throw { status: 400, message: 'La compra ya se encuentra dada de baja.' };

            // Si es una compra en Cuenta Corriente con pagos ya aplicados (total o parcial), no se puede dar
            // de baja directamente: el saldo del proveedor quedaría inconsistente (la deuda desaparece pero
            // los pagos que la cancelaron siguen registrados). Hay que revertir esos pagos primero
            // (comprasCuentasRepository.RevertirPagoProveedor).
            const [pagosAplicados]: any = await connection.query(
                "SELECT 1 FROM compras_pagos_proveedor_detalle WHERE idCompra = ? LIMIT 1",
                [compra.id]
            );
            if (pagosAplicados.length) {
                throw { status: 400, message: 'La compra tiene pagos aplicados. Revertí los pagos antes de darla de baja.' };
            }

            // Reverso por cada método con el que se pagó la compra (multi-método, 24-jun-2026): un
            // contra-asiento por fila de compras_metodos_pago, cada uno contra el fondo real de ese
            // método. El movimiento original NUNCA se borra ni se modifica (ledger append-only, mismo
            // criterio que el resto del módulo de Fondos, ver fondosRepository.CrearTransferencia).
            // Cuenta Corriente (Proveedor) se revierte en la dirección opuesta (EGRESO) porque el ingreso
            // original era deuda, no plata real; Saldo a Favor (Proveedor) se revierte como INGRESO
            // porque el egreso original consumía saldo a favor disponible.
            const [pagos]: any = await connection.query(
                "SELECT idMetodoPago, monto FROM compras_metodos_pago WHERE idCompra = ?",
                [compra.id]
            );
            for (const pago of pagos) {
                const metodoPago = await GetMetodoPago(connection, pago.idMetodoPago);
                const esCuentaCorriente = metodoPago.tipo === 'CUENTA_CORRIENTE_PROVEEDOR';

                await InsertMovimientoFondo(connection, {
                    idCaja: compraActual.idCaja,
                    idFondo: metodoPago.idFondo,
                    idEmpresa: compraActual.idEmpresa,
                    tipo: esCuentaCorriente ? 'EGRESO' : 'INGRESO',
                    origen: 'PAGO_PROVEEDOR', // mismo origen que el movimiento original (ver Agregar); la dirección la marca "tipo", no "origen" (igual criterio que NOTA_CREDITO en ventasRepository).
                    idReferencia: compra.id,
                    monto: Number(pago.monto),
                    descripcion: `Reverso por baja de compra #${compra.id}`,
                    usuario
                });
            }

            await connection.query("UPDATE compras SET baja = ? WHERE id = ?", [moment().format('YYYY-MM-DD HH:mm'), compra.id]);

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

//#region TOTALES
function CalcularTotales(compra: Compra) {
    // importe = precio unitario; el aporte de cada línea al total es importe * cantidad.
    const totalNeto = (compra.detalle ?? []).reduce((acc, l) => acc + Number(l.importe ?? 0) * Number(l.cantidad ?? 1), 0);
    const totalIva = (compra.iva ?? []).reduce((acc, l) => acc + Number(l.importe ?? 0), 0);
    const totalIibb = (compra.percepcionesIibb ?? []).reduce((acc, l) => acc + Number(l.importe ?? 0), 0);
    const tasaMunicipal = Number(compra.tasaMunicipal ?? 0);
    const percepcionIva = Number(compra.percepcionIva ?? 0);
    const retencionGanancia = Number(compra.retencionGanancia ?? 0);
    const total = totalNeto + totalIva + totalIibb + tasaMunicipal + percepcionIva + retencionGanancia;

    return { totalNeto, totalIva, totalIibb, tasaMunicipal, percepcionIva, retencionGanancia, total };
}
//#endregion

//#region QUERIES PRIVADAS
function ObtenerQuery(filtros: any, esTotal: boolean): string {
    let filtro: string = "";
    let paginado: string = "";
    let count: string = "";
    let endCount: string = "";

    if (filtros.idCompra && filtros.idCompra != 0)
        filtro += " AND c.id = " + filtros.idCompra;

    if (filtros.idEmpresa && filtros.idEmpresa != 0)
        filtro += " AND c.idEmpresa = " + filtros.idEmpresa;

    if (filtros.idProveedor && filtros.idProveedor != 0)
        filtro += " AND c.idProveedor = " + filtros.idProveedor;

    if (filtros.idTipoComprobante && filtros.idTipoComprobante != 0)
        filtro += " AND c.idTipoComprobante = " + filtros.idTipoComprobante;

    if (filtros.estado)
        filtro += " AND c.estado = '" + filtros.estado + "'";

    if (filtros.fechas?.length === 2) {
        const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
        const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

        filtro += ` AND c.fecha >= '${desde}' AND c.fecha < '${hasta}'`;
    }

    if (!filtros.incluirBaja)
        filtro += " AND c.baja IS NULL";

    if (esTotal) {
        count = "SELECT COUNT(*) AS total FROM ( ";
        endCount = " ) as subquery";
    } else {
        if (filtros.tamanioPagina != null)
            paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
    }

    return count +
        " SELECT c.*, p.razonSocial AS proveedor, ci.descripcion AS condicionIvaProveedor, tc.descripcion AS tipoComprobante, " +
        " mpResumen.metodoPago " +
        " FROM compras c " +
        " LEFT JOIN proveedores p ON p.id = c.idProveedor " +
        " LEFT JOIN condiciones_iva ci ON ci.id = p.idCondIva " +
        " LEFT JOIN tipos_comprobantes tc ON tc.id = c.idTipoComprobante " +
        // Resumen de métodos en un solo string (ej: "Efectivo + Cuenta Corriente (Proveedor)") - permite
        // que listado-compras siga mostrando un único campo compra.metodoPago sin cambios, ahora que una
        // compra puede combinar N filas en compras_metodos_pago (multi-método, 24-jun-2026).
        " LEFT JOIN ( " +
        "   SELECT cmp.idCompra, " +
        "     GROUP_CONCAT(CASE WHEN mp.tipo = 'TRANSFERENCIA' THEN CONCAT(f.nombre, ' - Transferencia') ELSE mp.nombre END ORDER BY cmp.id SEPARATOR ' + ') AS metodoPago " +
        "   FROM compras_metodos_pago cmp " +
        "   INNER JOIN metodos_pago mp ON mp.id = cmp.idMetodoPago " +
        "   INNER JOIN fondos f ON f.id = mp.idFondo " +
        "   GROUP BY cmp.idCompra " +
        " ) mpResumen ON mpResumen.idCompra = c.id " +
        " WHERE 1 = 1 " +
        filtro +
        " ORDER BY c.fecha DESC, c.id DESC " +
        paginado +
        endCount;
}

// mysql2 devuelve las columnas DECIMAL como string salvo que se configure decimalNumbers en el pool
// (ver db.ts). El detalle/iva/percepciones ya se parsean explícitamente al construirse (ver
// ObtenerDetalleCompra, ObtenerIvaCompra, ObtenerPercepcionesIibb); esta función hace lo mismo para
// los totales que vienen directo de la fila de "compras" (afecta tanto al listado como al detalle).
function ParsearTotalesCompra(compra: any): void {
    compra.totalNeto = parseFloat(compra.totalNeto);
    compra.totalIva = parseFloat(compra.totalIva);
    compra.totalIibb = parseFloat(compra.totalIibb);
    compra.tasaMunicipal = parseFloat(compra.tasaMunicipal);
    compra.percepcionIva = parseFloat(compra.percepcionIva);
    compra.retencionGanancia = parseFloat(compra.retencionGanancia);
    compra.total = parseFloat(compra.total);
}

async function ObtenerDetalleCompra(connection, idCompra: number): Promise<DetalleCompra[]> {
    const consulta = "SELECT * FROM detalle_compras WHERE idCompra = ?";
    const [rows] = await connection.query(consulta, [idCompra]);
    const detalle: DetalleCompra[] = [];

    if (Array.isArray(rows)) {
        for (const row of rows) {
            const linea = new DetalleCompra();
            linea.id = row['id'];
            linea.idCompra = row['idCompra'];
            linea.cantidad = parseFloat(row['cantidad']);
            linea.concepto = row['concepto'];
            linea.importe = parseFloat(row['importe']);
            detalle.push(linea);
        }
    }

    return detalle;
}

async function ObtenerIvaCompra(connection, idCompra: number): Promise<CompraIva[]> {
    const consulta = `
        SELECT ci.*, ai.descripcion AS alicuota
        FROM compras_iva ci
        LEFT JOIN alicuotas_iva ai ON ai.id = ci.idAlicuota
        WHERE ci.idCompra = ?
    `;
    const [rows] = await connection.query(consulta, [idCompra]);
    const iva: CompraIva[] = [];

    if (Array.isArray(rows)) {
        for (const row of rows) {
            const linea = new CompraIva();
            linea.id = row['id'];
            linea.idCompra = row['idCompra'];
            linea.idAlicuota = row['idAlicuota'];
            linea.alicuota = row['alicuota'];
            linea.importe = parseFloat(row['importe']);
            iva.push(linea);
        }
    }

    return iva;
}

async function ObtenerPercepcionesIibb(connection, idCompra: number): Promise<CompraPercepcionIibb[]> {
    const consulta = "SELECT * FROM compras_percepciones_iibb WHERE idCompra = ?";
    const [rows] = await connection.query(consulta, [idCompra]);
    const percepciones: CompraPercepcionIibb[] = [];

    if (Array.isArray(rows)) {
        for (const row of rows) {
            const linea = new CompraPercepcionIibb();
            linea.id = row['id'];
            linea.idCompra = row['idCompra'];
            linea.provincia = row['provincia'];
            linea.importe = parseFloat(row['importe']);
            percepciones.push(linea);
        }
    }

    return percepciones;
}

// Desglose de pagos de la compra (multi-método, 24-jun-2026), para trazabilidad/auditoría en el
// detalle (ObtenerUna). El listado usa el resumen GROUP_CONCAT de ObtenerQuery; esto es la versión
// desagregada, fila por fila, con el mismo criterio de descripción (transferencia -> "Fondo - Transferencia").
async function ObtenerPagosCompra(connection, idCompra: number): Promise<PagoCompra[]> {
    const consulta = `
        SELECT cmp.idMetodoPago,
            CASE WHEN mp.tipo = 'TRANSFERENCIA' THEN CONCAT(f.nombre, ' - Transferencia') ELSE mp.nombre END AS metodo,
            cmp.monto
        FROM compras_metodos_pago cmp
        INNER JOIN metodos_pago mp ON mp.id = cmp.idMetodoPago
        INNER JOIN fondos f ON f.id = mp.idFondo
        WHERE cmp.idCompra = ?
        ORDER BY cmp.id ASC
    `;
    const [rows] = await connection.query(consulta, [idCompra]);
    const pagos: PagoCompra[] = [];

    if (Array.isArray(rows)) {
        for (const row of rows as any[]) {
            const pago = new PagoCompra();
            pago.idMetodo = row['idMetodoPago'];
            pago.metodo = row['metodo'];
            pago.monto = parseFloat(row['monto']);
            pagos.push(pago);
        }
    }

    return pagos;
}

async function InsertDetalleCompra(connection, idCompra: number | undefined, linea: DetalleCompra): Promise<void> {
    const consulta = "INSERT INTO detalle_compras (idCompra, cantidad, concepto, importe) VALUES (?, ?, ?, ?)";
    await connection.query(consulta, [idCompra, linea.cantidad, linea.concepto, linea.importe]);
}

async function InsertCompraIva(connection, idCompra: number | undefined, linea: CompraIva): Promise<void> {
    const consulta = "INSERT INTO compras_iva (idCompra, idAlicuota, importe) VALUES (?, ?, ?)";
    await connection.query(consulta, [idCompra, linea.idAlicuota, linea.importe]);
}

async function InsertCompraPercepcionIibb(connection, idCompra: number | undefined, linea: CompraPercepcionIibb): Promise<void> {
    const consulta = "INSERT INTO compras_percepciones_iibb (idCompra, provincia, importe) VALUES (?, ?, ?)";
    await connection.query(consulta, [idCompra, linea.provincia, linea.importe]);
}

async function GetMetodoPago(connection, idMetodoPago: number): Promise<{ idFondo: number; tipo: string }> {
    const [rows] = await connection.query(
        'SELECT idFondo, tipo FROM metodos_pago WHERE id = ?',
        [idMetodoPago]
    );
    if (!rows.length) throw new Error(`Método de pago ${idMetodoPago} no encontrado.`);
    return rows[0];
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

export const ComprasRepo = new ComprasRepository();
