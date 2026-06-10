import db from '../db';

class ValoresRepository {

    /**
     * Devuelve los valores_acreditar PENDIENTES de una empresa,
     * con datos de venta, cliente, cheque (si aplica) y fondo destino.
     * Incluye totales por tipo al final del resultado.
     */
    async ObtenerValoresPendientes(): Promise<any> {
        const connection = await db.getConnection();
        try {
            const [rows]: any = await connection.query(`
                SELECT
                    va.id,
                    va.tipo,
                    va.monto,
                    va.estado,
                    va.fechaAlta,
                    va.usuarioAlta,
                    va.idFondoDestino,
                    f.nombre                    AS fondoDestino,
                    vp.idVenta,
                    v.fecha                     AS fechaVenta,
                    c.nombre                    AS cliente,
                    -- Datos de cheque (NULL si es TARJETA_CREDITO)
                    ch.numero                   AS chequeNumero,
                    ch.banco                    AS chequeBanco,
                    ch.importe                  AS chequeImporte,
                    ch.fechaCobro               AS chequeFechaCobro,
                    ch.libradorNombre           AS chequeLibradorNombre,
                    ch.libradorCuit             AS chequeLibradorCuit
                FROM valores_acreditar va
                INNER JOIN ventas_pagos vp  ON vp.id  = va.idVentaPago
                INNER JOIN ventas v         ON v.id   = vp.idVenta
                LEFT  JOIN clientes c       ON c.id   = v.idCliente
                LEFT  JOIN fondos f         ON f.id   = va.idFondoDestino
                LEFT  JOIN cheques ch       ON ch.idValor = va.id
                WHERE va.estado = 'PENDIENTE'
                ORDER BY va.fechaAlta DESC
            `);

            // Totales por tipo para mostrar en el resumen
            const totales = rows.reduce((acc: any, row: any) => {
                const tipo = row.tipo as string;
                acc[tipo] = (acc[tipo] || 0) + parseFloat(row.monto);
                return acc;
            }, {} as Record<string, number>);

            return { pendientes: rows, totales };

        } catch (error) {
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Acredita un valor pendiente:
     * 1. Valida que esté PENDIENTE (idempotencia).
     * 2. EGRESO del fondo "Valores a Acreditar".
     * 3. INGRESO en el fondo destino real.
     * 4. UPDATE estado → ACREDITADO.
     *
     * Para CHEQUE: idFondoDestino debe venir en el body (el usuario lo elige).
     * Para TARJETA_CREDITO: idFondoDestino ya está en la tabla; se puede
     *   sobreescribir con el valor del body si se envía.
     */
    async AcreditarValor(params: {
        idValor: number;
        idCaja: number;
        usuario: string;
        idFondoDestino?: number;
        observaciones?: string;
    }): Promise<void> {
        const { idValor, idCaja, usuario, observaciones } = params;
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // 1. Leer el valor y validar estado
            const [[valor]]: any = await connection.query(
                `SELECT id, estado, monto, tipo, idFondoDestino
                 FROM valores_acreditar WHERE id = ? FOR UPDATE`,
                [idValor]
            );

            if (!valor) throw { status: 404, message: 'Valor no encontrado.' };
            if (valor.estado !== 'PENDIENTE') {
                throw { status: 400, message: `El valor ya fue ${valor.estado.toLowerCase()}.` };
            }

            // Resolver fondo destino: prioridad → body, luego tabla
            const idFondoDestino = params.idFondoDestino ?? valor.idFondoDestino;
            if (!idFondoDestino) {
                throw { status: 400, message: 'Se requiere idFondoDestino para acreditar este valor.' };
            }

            // 2. Obtener id del fondo "Valores a Acreditar"
            const [[fondoVA]]: any = await connection.query(
                `SELECT id FROM fondos WHERE nombre = 'Valores a Acreditar' LIMIT 1`
            );
            if (!fondoVA) throw { status: 500, message: "Fondo 'Valores a Acreditar' no encontrado." };

            const desc = `Acreditación valor #${idValor} (${valor.tipo})`;

            // 3. EGRESO de "Valores a Acreditar"
            await connection.query(`
                INSERT INTO movimientos_fondos
                    (idCaja, idFondo, tipo, origen, idReferencia, monto, descripcion, usuario, observaciones)
                VALUES (?, ?, 'EGRESO', 'ACREDITACION_VALOR', ?, ?, ?, ?, ?)
            `, [idCaja, fondoVA.id, idValor, valor.monto, desc, usuario, observaciones ?? null]);

            // 4. INGRESO en el fondo destino real
            await connection.query(`
                INSERT INTO movimientos_fondos
                    (idCaja, idFondo, tipo, origen, idReferencia, monto, descripcion, usuario, observaciones)
                VALUES (?, ?, 'INGRESO', 'ACREDITACION_VALOR', ?, ?, ?, ?, ?)
            `, [idCaja, idFondoDestino, idValor, valor.monto, desc, usuario, observaciones ?? null]);

            // 5. Marcar como ACREDITADO
            await connection.query(`
                UPDATE valores_acreditar
                SET estado = 'ACREDITADO',
                    fechaAcreditacion = NOW(),
                    usuarioAcredita   = ?,
                    idFondoDestino    = ?,
                    observaciones     = ?
                WHERE id = ?
            `, [usuario, idFondoDestino, observaciones ?? null, idValor]);

            await connection.commit();

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Rechaza un valor pendiente:
     * EGRESO de "Valores a Acreditar" (la plata nunca llega al fondo real).
     * UPDATE estado → RECHAZADO.
     */
    async RechazarValor(params: {
        idValor: number;
        idCaja: number;
        usuario: string;
        observaciones: string;
    }): Promise<void> {
        const { idValor, idCaja, usuario, observaciones } = params;
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // Validar estado
            const [[valor]]: any = await connection.query(
                `SELECT id, estado, monto, tipo FROM valores_acreditar WHERE id = ? FOR UPDATE`,
                [idValor]
            );

            if (!valor) throw { status: 404, message: 'Valor no encontrado.' };
            if (valor.estado !== 'PENDIENTE') {
                throw { status: 400, message: `El valor ya fue ${valor.estado.toLowerCase()}.` };
            }

            // Fondo "Valores a Acreditar"
            const [[fondoVA]]: any = await connection.query(
                `SELECT id FROM fondos WHERE nombre = 'Valores a Acreditar' LIMIT 1`
            );
            if (!fondoVA) throw { status: 500, message: "Fondo 'Valores a Acreditar' no encontrado." };

            // EGRESO — la plata sale de VA sin ingresar a ningún fondo real
            await connection.query(`
                INSERT INTO movimientos_fondos
                    (idCaja, idFondo, tipo, origen, idReferencia, monto, descripcion, usuario, observaciones)
                VALUES (?, ?, 'EGRESO', 'ACREDITACION_VALOR', ?, ?, ?, ?, ?)
            `, [idCaja, fondoVA.id, idValor, valor.monto,
                `Rechazo valor #${idValor} (${valor.tipo})`, usuario, observaciones]);

            // Marcar RECHAZADO
            await connection.query(`
                UPDATE valores_acreditar
                SET estado = 'RECHAZADO',
                    usuarioAcredita = ?,
                    observaciones   = ?
                WHERE id = ?
            `, [usuario, observaciones, idValor]);

            await connection.commit();

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export const ValoresRepo = new ValoresRepository();
