import db from '../db';

// ENDOSADO: el cheque se entregó a un proveedor como pago. Para recuperarlo hay que anular ese pago
// (vuelve a PENDIENTE); acreditarlo o rechazarlo desde acá dejaría el pago al proveedor sin respaldo.
function MensajeValorNoPendiente(estado: string): string {
    if (estado === 'ENDOSADO') {
        return 'El cheque ya fue endosado a un proveedor. Para recuperarlo, anulá el pago de la compra o de Pagar a Proveedor.';
    }
    return `El valor ya fue ${estado.toLowerCase()}.`;
}

class ValoresRepository {

    /**
     * Devuelve los valores_acreditar PENDIENTES de una empresa,
     * con datos de venta, cliente, cheque (si aplica) y fondo destino.
     * Incluye totales por tipo al final del resultado.
     * Filtros opcionales (los usa el selector de cheques a endosar en Compras / Pagar a Proveedor):
     *   tipo (ej. 'CHEQUE'), idEmpresa. Sin filtros devuelve todos los PENDIENTES, igual que antes.
     * Los ENDOSADO no aparecen: ya salieron de Valores a Acreditar (los egresó el pago al proveedor).
     */
    async ObtenerValoresPendientes(filtros?: { tipo?: string; idEmpresa?: number }): Promise<any> {
        const connection = await db.getConnection();
        try {
            const condiciones: string[] = [`va.estado = 'PENDIENTE'`];
            const params: any[] = [];
            if (filtros?.tipo) { condiciones.push('va.tipo = ?'); params.push(filtros.tipo); }
            if (filtros?.idEmpresa) { condiciones.push('va.idEmpresa = ?'); params.push(Number(filtros.idEmpresa)); }

            const [rows]: any = await connection.query(`
                SELECT
                    va.id,
                    va.idEmpresa,
                    va.tipo,
                    va.monto,
                    va.estado,
                    va.fechaAlta,
                    va.usuarioAlta,
                    va.idFondoDestino,
                    f.nombre                    AS fondoDestino,
                    vp.idVenta,
                    COALESCE(v.fecha, r.fecha)   AS fechaVenta,
                    COALESCE(c.nombre, cr.nombre) AS cliente,
                    -- Datos de cheque (NULL si es TARJETA_CREDITO)
                    ch.numero                   AS chequeNumero,
                    ch.banco                    AS chequeBanco,
                    ch.importe                  AS chequeImporte,
                    ch.fechaCobro               AS chequeFechaCobro,
                    ch.libradorNombre           AS chequeLibradorNombre,
                    ch.libradorCuit             AS chequeLibradorCuit
                FROM valores_acreditar va
                INNER JOIN ventas_pagos vp  ON vp.id  = va.idVentaPago
                -- LEFT (no INNER): en una Entrega de Dinero de cuenta corriente que
                -- cancela solo saldo inicial o genera saldo a favor, el ventas_pagos
                -- ancla se crea con idVenta NULL (no hay una venta puntual asociada).
                -- Con INNER JOIN esos valores desaparecían de este listado aunque
                -- estuvieran PENDIENTE (el movimiento de fondo sí se veía, pero acá no).
                LEFT  JOIN ventas v         ON v.id   = vp.idVenta
                LEFT  JOIN clientes c       ON c.id   = v.idCliente
                LEFT  JOIN recibos r        ON r.id   = vp.idRecibo
                LEFT  JOIN clientes cr      ON cr.id  = r.idCliente
                LEFT  JOIN fondos f         ON f.id   = va.idFondoDestino
                LEFT  JOIN cheques ch       ON ch.idValor = va.id
                WHERE ${condiciones.join(' AND ')}
                ORDER BY va.fechaAlta DESC
            `, params);

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
     * Cheques de terceros (valores_acreditar tipo CHEQUE) en CUALQUIER estado, para la pantalla informativa de
     * Cheques (Administración). Solo lectura. Filtros opcionales: estado, idEmpresa, fechaCobroDesde/Hasta, limite.
     * Dónde terminó cada uno: PENDIENTE (sigue en Valores a Acreditar), ENDOSADO (proveedor + fecha),
     * ACREDITADO (fondo + fecha), RECHAZADO (observaciones).
     */
    async ObtenerCheques(filtros?: any): Promise<any[]> {
        const connection = await db.getConnection();
        try {
            const condiciones: string[] = [`va.tipo = 'CHEQUE'`];
            const params: any[] = [];
            if (filtros?.estado) { condiciones.push('va.estado = ?'); params.push(filtros.estado); }
            if (filtros?.idEmpresa) { condiciones.push('va.idEmpresa = ?'); params.push(Number(filtros.idEmpresa)); }
            if (filtros?.fechaCobroDesde) { condiciones.push('ch.fechaCobro >= ?'); params.push(String(filtros.fechaCobroDesde).substring(0, 10)); }
            if (filtros?.fechaCobroHasta) { condiciones.push('ch.fechaCobro <= ?'); params.push(String(filtros.fechaCobroHasta).substring(0, 10)); }

            const limite = Math.floor(Number(filtros?.limite));
            const limit = Number.isFinite(limite) && limite > 0 ? ` LIMIT ${Math.min(limite, 2000)}` : '';

            const [rows]: any = await connection.query(`
                SELECT
                    va.id, va.idEmpresa, va.estado, va.monto, va.fechaAlta,
                    va.fechaAcreditacion, va.usuarioAcredita, va.observaciones,
                    va.fechaEndoso, va.usuarioEndoso, va.idProveedorEndoso,
                    pe.razonSocial                  AS proveedorEndoso,
                    f.nombre                        AS fondoDestino,
                    COALESCE(c.nombre, cr.nombre)   AS cliente,
                    ch.numero                       AS chequeNumero,
                    ch.banco                        AS chequeBanco,
                    ch.libradorNombre               AS chequeLibradorNombre,
                    ch.fechaCobro                   AS chequeFechaCobro,
                    DATEDIFF(ch.fechaCobro, CURDATE()) AS diasParaCobro
                FROM valores_acreditar va
                LEFT JOIN ventas_pagos vp ON vp.id = va.idVentaPago
                LEFT JOIN ventas v        ON v.id  = vp.idVenta
                LEFT JOIN clientes c      ON c.id  = v.idCliente
                LEFT JOIN recibos r       ON r.id  = vp.idRecibo
                LEFT JOIN clientes cr     ON cr.id = r.idCliente
                LEFT JOIN fondos f        ON f.id  = va.idFondoDestino
                LEFT JOIN proveedores pe  ON pe.id = va.idProveedorEndoso
                LEFT JOIN cheques ch      ON ch.idValor = va.id
                WHERE ${condiciones.join(' AND ')}
                ORDER BY ch.fechaCobro ASC, va.id ASC${limit}
            `, params);

            for (const row of rows) {
                row.monto = parseFloat(row.monto);
                row.diasParaCobro = row.diasParaCobro === null ? null : Number(row.diasParaCobro);
            }
            return rows;

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
            // idEmpresa se trae acá para poder taggear los 2 movimientos de fondo de
            // abajo (antes no se pasaba, y quedaban sin empresa asignada aunque el
            // dato ya estaba guardado en esta misma fila desde que se creó el valor -
            // ver arqueo por empresa, jul-2026).
            const [[valor]]: any = await connection.query(
                `SELECT id, estado, monto, tipo, idFondoDestino, idEmpresa
                 FROM valores_acreditar WHERE id = ? FOR UPDATE`,
                [idValor]
            );

            if (!valor) throw { status: 404, message: 'Valor no encontrado.' };
            if (valor.estado !== 'PENDIENTE') {
                throw { status: 400, message: MensajeValorNoPendiente(valor.estado) };
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
                    (idCaja, idFondo, tipo, origen, idReferencia, monto, descripcion, usuario, observaciones, idEmpresa)
                VALUES (?, ?, 'EGRESO', 'ACREDITACION_VALOR', ?, ?, ?, ?, ?, ?)
            `, [idCaja, fondoVA.id, idValor, valor.monto, desc, usuario, observaciones ?? null, valor.idEmpresa]);

            // 4. INGRESO en el fondo destino real
            await connection.query(`
                INSERT INTO movimientos_fondos
                    (idCaja, idFondo, tipo, origen, idReferencia, monto, descripcion, usuario, observaciones, idEmpresa)
                VALUES (?, ?, 'INGRESO', 'ACREDITACION_VALOR', ?, ?, ?, ?, ?, ?)
            `, [idCaja, idFondoDestino, idValor, valor.monto, desc, usuario, observaciones ?? null, valor.idEmpresa]);

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
     * Abre su propia conexión/transacción (uso desde el endpoint de Valores a
     * Acreditar). Para reusar la misma lógica dentro de OTRA transacción ya
     * abierta (ej. DarBajaRecibo en cuentasRepository.ts), usar RechazarValorConn.
     */
    async RechazarValor(params: {
        idValor: number;
        idCaja: number;
        usuario: string;
        observaciones: string;
    }): Promise<void> {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();
            await RechazarValorConn(connection, params);
            await connection.commit();

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

/**
 * Misma lógica de RechazarValor, pero recibe una `connection` ya abierta en
 * vez de manejar su propia transacción - para poder correr dentro de la
 * transacción de otra operación (ej. DarBajaRecibo). No hace commit/rollback:
 * eso es responsabilidad de quien abrió la transacción.
 */
export async function RechazarValorConn(connection, params: {
    idValor: number;
    idCaja: number;
    usuario: string;
    observaciones: string;
}): Promise<void> {
    const { idValor, idCaja, usuario, observaciones } = params;

    // Validar estado
    const [[valor]]: any = await connection.query(
        `SELECT id, estado, monto, tipo, idEmpresa FROM valores_acreditar WHERE id = ? FOR UPDATE`,
        [idValor]
    );

    if (!valor) throw { status: 404, message: 'Valor no encontrado.' };
    if (valor.estado !== 'PENDIENTE') {
        throw { status: 400, message: MensajeValorNoPendiente(valor.estado) };
    }

    // Fondo "Valores a Acreditar"
    const [[fondoVA]]: any = await connection.query(
        `SELECT id FROM fondos WHERE nombre = 'Valores a Acreditar' LIMIT 1`
    );
    if (!fondoVA) throw { status: 500, message: "Fondo 'Valores a Acreditar' no encontrado." };

    // EGRESO — la plata sale de VA sin ingresar a ningún fondo real
    await connection.query(`
        INSERT INTO movimientos_fondos
            (idCaja, idFondo, tipo, origen, idReferencia, monto, descripcion, usuario, observaciones, idEmpresa)
        VALUES (?, ?, 'EGRESO', 'ACREDITACION_VALOR', ?, ?, ?, ?, ?, ?)
    `, [idCaja, fondoVA.id, idValor, valor.monto,
        `Rechazo valor #${idValor} (${valor.tipo})`, usuario, observaciones, valor.idEmpresa]);

    // Marcar RECHAZADO
    await connection.query(`
        UPDATE valores_acreditar
        SET estado = 'RECHAZADO',
            usuarioAcredita = ?,
            observaciones   = ?
        WHERE id = ?
    `, [usuario, observaciones, idValor]);
}

export const ValoresRepo = new ValoresRepository();
