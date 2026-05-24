import moment from 'moment';
import db from '../db';
import { MovimientoFondo } from '../models/MovimientoFondo';

interface FiltrosFondos {
    fechaDesde?: string;
    fechaHasta?: string;
    usuario?: string;
    idCaja?: number;
    idFondo?: number;
}

interface ResumenFondos {
    saldoTotal: number;
    ingresosDia: number;
    egresosDia: number;
    netoDia: number;
    cuentaCorrienteClientes: number;
    saldoFavorClientes: number;
}

class FondosRepository{
    async SelectorCajas(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM cajas');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerCajas(){
        const connection = await db.getConnection();
        
        try {
            const result: any = await connection.query(`
            SELECT
                c.id        AS idCaja,
                c.nombre    AS cajaNombre,
                f.id        AS idFondo,
                f.nombre    AS fondoNombre,
                f.tipo      AS fondoTipo,
                f.icono     AS icono,
                COALESCE(SUM(
                CASE WHEN mf.tipo = 'INGRESO' THEN mf.monto ELSE -mf.monto END
                ), 0) AS saldo
            FROM cajas c
            JOIN caja_fondos cf ON cf.idCaja = c.id AND cf.activo = 1 AND cf.id <> 4 AND cf.id <> 5
            JOIN fondos f       ON f.id = cf.idFondo AND f.activo = 1
            LEFT JOIN movimientos_fondos mf ON mf.idCaja = c.id AND mf.idFondo = f.id
            WHERE c.activa = 1
            GROUP BY c.id, c.nombre, f.id, f.nombre, f.tipo
            ORDER BY c.nombre, f.nombre
            `);

            const rows = result[0];
            const cajasMap = new Map<number, any>();
            rows.forEach((row: any) => {
            if (!cajasMap.has(row.idCaja)) {
                cajasMap.set(row.idCaja, {
                    id:     row.idCaja,
                    nombre: row.cajaNombre,
                    fondos: []
                    });
                }
                cajasMap.get(row.idCaja).fondos.push({
                    idFondo: row.idFondo,
                    nombre:  row.fondoNombre,
                    tipo:    row.fondoTipo,
                    saldo:   parseFloat(row.saldo),
                    icono:   row.icono
                });
            });

            return Array.from(cajasMap.values());

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

   async ObtenerSeccionResumen(filtros: FiltrosFondos): Promise<ResumenFondos> {

        const connection = await db.getConnection();

        try {

            //#region WHERE SALDO TOTAL
            const whereSaldo: string[] = [];
            const paramsSaldo: any[] = [];

            if (filtros.idCaja) {
                whereSaldo.push('idCaja = ?');
                paramsSaldo.push(filtros.idCaja);
            }

            if (filtros.usuario) {
                whereSaldo.push('usuario = ?');
                paramsSaldo.push(filtros.usuario);
            }

            const whereSaldoFinal = whereSaldo.length
                ? `WHERE ${whereSaldo.join(' AND ')}`
                : '';
            //#endregion

            //#region WHERE PERIODO
            const { where, params } =
                this.construirWhere(filtros);
            //#endregion

            //#region QUERY SALDO TOTAL
            const querySaldo = `
                SELECT
                    COALESCE(SUM(
                        CASE
                            WHEN tipo = 'INGRESO' THEN monto
                            WHEN tipo = 'EGRESO' THEN -monto
                            ELSE 0
                        END
                    ),0) as saldoTotal

                FROM movimientos_fondos
                ${whereSaldoFinal}
            `;
            //#endregion

            //#region QUERY PERIODO
            const queryPeriodo = `
                SELECT
                    COALESCE(SUM(
                        CASE WHEN tipo = 'INGRESO'
                        THEN monto ELSE 0 END
                    ),0) as ingresosDia,

                    COALESCE(SUM(
                        CASE WHEN tipo = 'EGRESO'
                        THEN monto ELSE 0 END
                    ),0) as egresosDia

                FROM movimientos_fondos
                ${where}
            `;
            //#endregion


            const [saldoRows]: any =
                await connection.query(
                    querySaldo,
                    paramsSaldo
                );

            const [periodoRows]: any =
                await connection.query(
                    queryPeriodo,
                    params
                );

            const saldoData = saldoRows[0];
            const periodoData = periodoRows[0];


            const queryClientes = `
                SELECT
                    COALESCE(SUM(
                        CASE WHEN saldoFinal > 0
                        THEN saldoFinal ELSE 0 END
                    ), 0) AS cuentaCorrienteClientes,

                    COALESCE(SUM(
                        CASE WHEN saldoFinal < 0
                        THEN ABS(saldoFinal) ELSE 0 END
                    ), 0) AS saldoFavorClientes

                FROM (
                    SELECT 
                        c.id,
                        (
                            COALESCE(c.inicial, 0)

                            + COALESCE((
                                SELECT SUM(
                                    CASE 
                                        WHEN v.idTComprobante NOT IN (3,8,13,100)
                                        THEN v.total
                                        ELSE -v.total
                                    END
                                )
                                FROM ventas v
                                WHERE v.fechaBaja IS NULL
                                AND v.idCliente = c.id
                            ), 0)

                            - COALESCE((
                                SELECT SUM(vp.monto)
                                FROM ventas_pagos vp
                                JOIN recibos r ON r.id = vp.idRecibo
                                WHERE r.fechaBaja IS NULL
                                AND r.idCliente = c.id
                                AND vp.idMetodo <> 8
                            ), 0)

                        ) AS saldoFinal

                    FROM clientes c
                    WHERE c.fechaBaja IS NULL
                ) saldos;
            `;

            const [clientes]: any =
                await connection.query(queryClientes);

            return {
                saldoTotal:
                    Number(saldoData.saldoTotal),

                ingresosDia:
                    Number(periodoData.ingresosDia),

                egresosDia:
                    Number(periodoData.egresosDia),

                netoDia:
                    Number(periodoData.ingresosDia)
                    - Number(periodoData.egresosDia),

                cuentaCorrienteClientes:
                    Number(clientes[0].cuentaCorrienteClientes),

                saldoFavorClientes:
                    Number(clientes[0].saldoFavorClientes)
            };

        } finally {
            connection.release();
        }
    }
    async ObtenerResumenFondos(filtros: FiltrosFondos): Promise<any[]> {
        const connection = await db.getConnection();

        try {
            const condiciones: string[] = [];
            const params: any[] = [];

            if (filtros.idCaja) {
                condiciones.push('mf.idCaja = ?');
                params.push(filtros.idCaja);
            }

            if (filtros.fechaDesde) {
                condiciones.push('DATE(mf.fecha) >= ?');
                params.push(filtros.fechaDesde);
            }

            if (filtros.fechaHasta) {
                condiciones.push('DATE(mf.fecha) <= ?');
                params.push(filtros.fechaHasta);
            }

            if (filtros.usuario) {
                condiciones.push('mf.usuario = ?');
                params.push(filtros.usuario);
            }

            const filtrosJoin = condiciones.length
                ? `AND ${condiciones.join(' AND ')}`
                : '';

            const query = `
                SELECT
                    f.id,
                    f.nombre,
                    f.icono,
                    COALESCE(SUM(
                        CASE
                            WHEN mf.tipo = 'INGRESO' THEN mf.monto
                            WHEN mf.tipo = 'EGRESO' THEN -mf.monto
                            ELSE 0
                        END
                    ),0) as saldo,

                    COUNT(mf.id) as movimientos

                FROM fondos f

                LEFT JOIN movimientos_fondos mf
                    ON mf.idFondo = f.id
                    ${filtrosJoin}

                GROUP BY f.id, f.nombre

                ORDER BY f.id ASC
            `;

            const [rows]: any = await connection.query(query, params);
            return rows.map((fondo: any) => ({
                id: fondo.id,
                nombre: fondo.nombre,
                saldo: Number(fondo.saldo),
                movimientos: Number(fondo.movimientos),
                icono: fondo.icono
            }));

        } finally {
            connection.release();
        }
    }

    async ObtenerMovimientos(filtros: FiltrosFondos) {
        const connection = await db.getConnection();

        try {
            // Obtengo query y params
            const queryRegistros = await ObtenerQueryMovimientos(filtros, false);
            const queryTotal = await ObtenerQueryMovimientos(filtros, true);

            // Ejecuto queries
            const [rows]: any = await connection.query(queryRegistros.query, queryRegistros.params);
            const [resultado]: any = await connection.query(queryTotal.query, queryTotal.params);

            const registros = rows.map((mov: any) => ({
                ...mov,
                monto: Number(mov.monto)
            }));

            return {
                total: resultado[0].total,
                registros
            };
        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerMovimientosFondo(filtros: FiltrosFondos){
        const connection = await db.getConnection();
        try {
            const condiciones: string[] = [];
            const params: any[] = [];

            if (filtros.idFondo) {
                condiciones.push('mf.idFondo = ?');
                params.push(filtros.idFondo);
            }

            if (filtros.fechaDesde) {
                condiciones.push('DATE(mf.fecha) >= ?');
                params.push(filtros.fechaDesde);
            }

            if (filtros.fechaHasta) {
                condiciones.push('DATE(mf.fecha) <= ?');
                params.push(filtros.fechaHasta);
            }

            if (filtros.usuario) {
                condiciones.push('mf.usuario = ?');
                params.push(filtros.usuario);
            }

            const filtrosJoin = condiciones.length
                ? `AND ${condiciones.join(' AND ')}`
                : '';

            const query = `
                SELECT
                    b.id,
                    b.nombre AS banco,
                    SUM(
                        CASE
                            WHEN mp.tipo = 'CREDITO'
                            THEN vp.monto
                            ELSE 0
                        END
                    ) AS total_credito,
                    SUM(
                        CASE
                            WHEN mp.tipo = 'DEBITO'
                            THEN vp.monto
                            ELSE 0
                        END
                    ) AS total_debito,
                    SUM(
                        CASE
                            WHEN mp.tipo = 'TRANSFERENCIA'
                            THEN vp.monto
                            ELSE 0
                        END
                    ) AS total_transferencia,
                    SUM(vp.monto) AS total_general

                FROM movimientos_fondos mf
                INNER JOIN ventas v ON v.id = mf.idReferencia
                INNER JOIN ventas_pagos vp ON vp.idVenta = v.id
                INNER JOIN metodos_pago mp ON mp.id = vp.idMetodo
                INNER JOIN bancos b ON b.id = mp.idBanco

                WHERE mf.origen = 'VENTA' AND mf.tipo = 'INGRESO'
                ${filtrosJoin}

                GROUP BY b.id, b.nombre
                ORDER BY total_general DESC;
            `;

            const [rows]: any = await connection.query(query, params);
            return rows;

        } finally {
            connection.release();
        }
    }

    async RegistrarMovimientoManual(movimiento: MovimientoFondo): Promise<number> {

        const connection = await db.getConnection();

        try {

            await connection.beginTransaction();

            const query = `
                INSERT INTO movimientos_fondos (
                    idCaja,
                    idFondo,
                    tipo,
                    origen,
                    monto,
                    descripcion,
                    usuario,
                    observaciones
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                movimiento.idCaja,
                movimiento.idFondo,
                movimiento.tipo,
                movimiento.origen,
                movimiento.monto,
                movimiento.descripcion!.trim(),
                movimiento.usuario,
                movimiento.observaciones
            ];

            const [result]: any =
                await connection.query(query, params);

            await connection.commit();

            return result.insertId;

        } catch (error) {

            await connection.rollback();
            throw error;

        } finally {

            connection.release();
        }
    }

    async CrearTransferencia(datos: {
        idCajaOrigen: number;
        idFondoOrigen: number;
        idCajaDestino: number;
        idFondoDestino: number;
        monto: number;
        descripcion?: string;
        usuario?: string;
        }) {

        const { idCajaOrigen, idFondoOrigen, idCajaDestino, idFondoDestino, monto, descripcion, usuario } = datos;

        // Validaciones previas a la transacción
        if (idCajaOrigen === idCajaDestino && idFondoOrigen === idFondoDestino) {
            throw { status: 400, message: 'El origen y destino no pueden ser iguales.' };
        }
        if (!monto || monto <= 0) {
            throw { status: 400, message: 'El monto debe ser mayor a cero.' };
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // Verificar si el fondo permite negativo
            const [[fondo]]: any = await connection.query(
            `SELECT permiteNegativo FROM fondos WHERE id = ?`,
            [idFondoOrigen]
            );
            if (!fondo) throw { status: 404, message: 'Fondo origen no encontrado.' };

            // Validar saldo si el fondo no permite negativo
            if (!fondo.permiteNegativo) {
            const [[{ saldo }]]: any = await connection.query(
                `SELECT COALESCE(SUM(CASE WHEN tipo = 'INGRESO' THEN monto ELSE -monto END), 0) AS saldo
                FROM movimientos_fondos
                WHERE idCaja = ? AND idFondo = ?`,
                [idCajaOrigen, idFondoOrigen]
            );
            if (parseFloat(saldo) < monto) {
                throw { status: 400, message: `Saldo insuficiente. Disponible: $${parseFloat(saldo).toFixed(2)}` };
            }
            }

            const fecha = moment().format('YYYY-MM-DD HH:mm:ss');

            // 1. Registrar la transferencia
            const [tfResult]: any = await connection.query(
            `INSERT INTO transferencias_fondos
                (idCajaOrigen, idFondoOrigen, idCajaDestino, idFondoDestino, monto, descripcion, fecha, usuario)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [idCajaOrigen, idFondoOrigen, idCajaDestino, idFondoDestino, monto, descripcion ?? '', fecha, usuario ?? '']
            );
            const idTransferencia = tfResult.insertId;

            // 2. Egreso en origen
            await connection.query(
            `INSERT INTO movimientos_fondos
                (idCaja, idFondo, tipo, origen, idReferencia, monto, descripcion, fecha, usuario)
            VALUES (?, ?, 'EGRESO', 'TRANSFERENCIA', ?, ?, ?, ?, ?)`,
            [idCajaOrigen, idFondoOrigen, idTransferencia, monto, descripcion ?? '', fecha, usuario ?? '']
            );

            // 3. Ingreso en destino
            await connection.query(
            `INSERT INTO movimientos_fondos
                (idCaja, idFondo, tipo, origen, idReferencia, monto, descripcion, fecha, usuario)
            VALUES (?, ?, 'INGRESO', 'TRANSFERENCIA', ?, ?, ?, ?, ?)`,
            [idCajaDestino, idFondoDestino, idTransferencia, monto, descripcion ?? '', fecha, usuario ?? '']
            );

            await connection.commit();
            return "OK";

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        }

    private construirWhere(filtros: FiltrosFondos) {
        const condiciones: string[] = [];
        const params: any[] = [];

        if (!filtros.fechaDesde && !filtros.fechaHasta) {
            condiciones.push("DATE(fecha) = CURDATE()");
        }

        if (filtros.fechaDesde) {
            condiciones.push('DATE(fecha) >= ?');
            params.push(filtros.fechaDesde);
        }

        if (filtros.fechaHasta) {
            condiciones.push('DATE(fecha) <= ?');
            params.push(filtros.fechaHasta);
        }

        if (filtros.usuario) {
            condiciones.push("usuario = ?");
            params.push(filtros.usuario);
        }

        if (filtros.idCaja) {
            condiciones.push("idCaja = ?");
            params.push(filtros.idCaja);
        }

        if (filtros.idFondo) {
            condiciones.push("idFondo = ?");
            params.push(filtros.idFondo);
        }

        const where = condiciones.length
            ? `WHERE ${condiciones.join(" AND ")}`
            : "";

        return { where, params };
    }
}


async function ObtenerQueryMovimientos(
    filtros: any,
    esTotal: boolean
): Promise<{ query: string, params: any[] }> {

    try {

        //#region VARIABLES
        let query: string;
        let paginado: string = "";

        let count: string = "";
        let endCount: string = "";
        //#endregion

        //#region FILTROS
        const condiciones: string[] = [];
        const params: any[] = [];

        if (filtros.idCaja) {
            condiciones.push('mf.idCaja = ?');
            params.push(filtros.idCaja);
        }

        if (filtros.idFondo) {
            condiciones.push('mf.idFondo = ?');
            params.push(filtros.idFondo);
        }

        if (filtros.fechaDesde) {
            condiciones.push('DATE(mf.fecha) >= ?');
            params.push(filtros.fechaDesde);
        }

        if (filtros.fechaHasta) {
            condiciones.push('DATE(mf.fecha) <= ?');
            params.push(filtros.fechaHasta);
        }

        if (filtros.usuario) {
            condiciones.push('mf.usuario = ?');
            params.push(filtros.usuario);
        }

        const where = condiciones.length
            ? `WHERE ${condiciones.join(' AND ')}`
            : '';
        //#endregion

        if (esTotal) {

            count = "SELECT COUNT(*) AS total FROM ( ";
            endCount = " ) as subquery";

        } else {

            if (filtros.tamanioPagina != null) {

                const limit = Number(filtros.tamanioPagina);
                const offset =
                    (Number(filtros.pagina || 1) - 1) * limit;

                paginado = `
                    LIMIT ${limit}
                    OFFSET ${offset}
                `;
            }
        }

        query = `
            ${count}

            SELECT
                mf.id,
                mf.fecha,
                f.nombre as fondo,
                mf.tipo,
                mf.origen,
                mf.descripcion,
                mf.monto,
                mf.usuario

            FROM movimientos_fondos mf

            INNER JOIN fondos f
                ON f.id = mf.idFondo

            ${where}

            ORDER BY mf.fecha DESC

            ${paginado}

            ${endCount}
        `;

        return {
            query,
            params
        };

    } catch (error) {
        throw error;
    }
}

export const FondosRepo = new FondosRepository();