import db from '../db';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
const moment = require('moment');

class StockRepository {

    //#region OBTENER
    async Obtener(filtros: any) {
        const connection = await db.getConnection();

        try {
            const queryRegistros = ObtenerQuery(filtros, false);
            const queryTotal = ObtenerQuery(filtros, true);

            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            return { total: resultado[0][0].total, registros: rows };

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    // Ajusta la cantidad de un talle puntual a un valor absoluto (no un delta): evita drift si
    // dos ajustes se disparan casi en simultáneo, mismo criterio de "set a valor conocido" que
    // ActualizarInventario usa con deltas pero acá aplica sobre un valor ya leído con FOR UPDATE
    // dentro de la misma transacción.
    async AjustarStock(data: { idProducto: number; talle: string; cantidadNueva: number; motivo: string }, usuario: string): Promise<number> {
        if (!data.motivo || !data.motivo.trim()) {
            throw new AppError(CodigoError.VALIDACION, 'Debe indicar un motivo para el ajuste.', 400);
        }
        if (data.cantidadNueva == null || Number(data.cantidadNueva) < 0) {
            throw new AppError(CodigoError.VALIDACION, 'La cantidad nueva debe ser un número válido mayor o igual a cero.', 400);
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // FOR UPDATE: bloquea la fila para que dos ajustes concurrentes sobre el mismo
            // producto+talle no lean la misma cantidadAnterior (mismo criterio que
            // comprasRepository.Eliminar sobre la fila de compras).
            const [rows]: any = await connection.query(
                `SELECT tp.cantidad, t.id AS idTalle
                 FROM talles_producto tp
                 LEFT JOIN talles t ON t.descripcion = tp.talle AND t.idLineaTalle = tp.idLineaTalle
                 WHERE tp.idProducto = ? AND tp.talle = ?
                 FOR UPDATE`,
                [data.idProducto, data.talle]
            );

            if (!rows.length) {
                throw new AppError(CodigoError.NOT_FOUND, 'No se encontró el talle indicado para este producto.', 404);
            }

            const cantidadAnterior = Number(rows[0].cantidad);
            const cantidadNueva = Number(data.cantidadNueva);
            const diferencia = cantidadNueva - cantidadAnterior;

            if (diferencia === 0) {
                throw new AppError(CodigoError.VALIDACION, 'La cantidad nueva es igual a la actual, no hay ajuste que registrar.', 400);
            }

            const [insertResult]: any = await connection.query(
                `INSERT INTO stock_movimientos
                    (idProducto, talle, idTalle, cantidadAnterior, cantidadNueva, diferencia, motivo, usuario)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [data.idProducto, data.talle, rows[0].idTalle ?? null, cantidadAnterior, cantidadNueva, diferencia, data.motivo.trim(), usuario]
            );

            await connection.query(
                'UPDATE talles_producto SET cantidad = ? WHERE idProducto = ? AND talle = ?',
                [cantidadNueva, data.idProducto, data.talle]
            );

            await connection.commit();
            return insertResult.insertId;

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Revierte un ajuste con contra-asiento: vuelve talles_producto a cantidadAnterior (no resta
    // el delta) y marca baja lógica. Solo se permite revertir el ÚLTIMO ajuste vigente de ese
    // producto+talle (mismo espíritu que "no se puede eliminar una compra con pagos aplicados
    // encima"): revertir uno intermedio dejaría cantidadAnterior/cantidadNueva de los movimientos
    // más nuevos desincronizados del valor real. Si más adelante hace falta revertir fuera de
    // orden, hay que decidir si se recalculan en cascada los movimientos posteriores o se bloquea
    // distinto - queda anotado, no se resuelve acá.
    async RevertirAjuste(idMovimiento: number, motivoBaja: string, usuario: string): Promise<void> {
        if (!motivoBaja || !motivoBaja.trim()) {
            throw new AppError(CodigoError.VALIDACION, 'Debe indicar un motivo para revertir el ajuste.', 400);
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [rows]: any = await connection.query(
                'SELECT * FROM stock_movimientos WHERE id = ? FOR UPDATE',
                [idMovimiento]
            );
            const movimiento = rows[0];

            if (!movimiento) {
                throw new AppError(CodigoError.NOT_FOUND, 'El ajuste no existe.', 404);
            }
            if (movimiento.baja) {
                throw new AppError(CodigoError.VALIDACION, 'El ajuste ya se encuentra revertido.', 400);
            }

            const [ultimoRows]: any = await connection.query(
                `SELECT id FROM stock_movimientos
                 WHERE idProducto = ? AND talle = ? AND baja IS NULL
                 ORDER BY id DESC LIMIT 1
                 FOR UPDATE`,
                [movimiento.idProducto, movimiento.talle]
            );

            if (!ultimoRows.length || ultimoRows[0].id !== movimiento.id) {
                throw new AppError(CodigoError.VALIDACION, 'Solo se puede revertir el último ajuste vigente de este talle.', 400);
            }

            await connection.query(
                'UPDATE talles_producto SET cantidad = ? WHERE idProducto = ? AND talle = ?',
                [movimiento.cantidadAnterior, movimiento.idProducto, movimiento.talle]
            );

            await connection.query(
                `UPDATE stock_movimientos SET baja = ?, motivoBaja = ?, usuarioBaja = ? WHERE id = ?`,
                [moment().format('YYYY-MM-DD HH:mm:ss'), motivoBaja.trim(), usuario, idMovimiento]
            );

            await connection.commit();

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion
}

function ObtenerQuery(filtros: any, esTotal: boolean): string {
    let filtro: string = "";
    let paginado: string = "";
    let count: string = "";
    let endCount: string = "";

    if (filtros.idProducto && filtros.idProducto != 0)
        filtro += " AND sm.idProducto = " + filtros.idProducto;

    if (filtros.usuario)
        filtro += " AND sm.usuario = '" + filtros.usuario + "'";

    if (filtros.fechas?.length === 2) {
        const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
        const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

        filtro += ` AND sm.alta >= '${desde}' AND sm.alta < '${hasta}'`;
    }

    if (esTotal) {
        count = "SELECT COUNT(*) AS total FROM ( ";
        endCount = " ) as subquery";
    } else {
        if (filtros.tamanioPagina != null)
            paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
    }

    return count +
        // c.descripcion/c.hexa: mismo JOIN a colores que usa productosRepository (p.idColor -> colores.id) -
        // sin esto el historial no puede distinguir productos con el mismo código/nombre en distintos colores.
        " SELECT sm.*, p.nombre AS producto, p.codigo AS codigoProducto, c.descripcion AS colorProducto, c.hexa AS hexaProducto " +
        " FROM stock_movimientos sm " +
        " LEFT JOIN productos p ON p.id = sm.idProducto " +
        " LEFT JOIN colores c ON c.id = p.idColor " +
        " WHERE 1 = 1 " +
        filtro +
        " ORDER BY sm.id DESC " +
        paginado +
        endCount;
}

export const StockRepo = new StockRepository();
