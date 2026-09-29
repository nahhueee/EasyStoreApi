import db from '../db';
import { EstadoEmision } from '../models/EstadoEmision';

// F3 - HANDOFF blindaje facturacion y logs (sec. F3.2/F3.3).
//
// Registro durable de cada intento de pedirle un CAE a ARCA. Todas las operaciones de
// este repositorio usan una conexion propia en autocommit (nunca la transaccion de
// Agregar/Modificar ni la conexion del GET_LOCK de facturacionService): la fila PENDIENTE
// tiene que quedar guardada de verdad ANTES de llamar a createVoucher, y las
// actualizaciones de estado posteriores tampoco pueden depender de que una transaccion
// de otra parte del sistema haga commit. La unica excepcion es VincularVenta, que
// corre a proposito DENTRO de la transaccion de Agregar/Modificar (ver comentario ahi).
class FeEmisionesRepository {

    /**
     * Inserta la fila PENDIENTE previa a pedir el CAE. Si ya existe una fila para el
     * mismo (cuitEmisor, ptoVenta, tipoCbte, nro) -caso normal cuando ARCA reasigna el
     * mismo numero tras un RECHAZADO anterior, que no lo consume- la actualiza a
     * PENDIENTE en vez de fallar por el UNIQUE, conservando el intento anterior en
     * `respuestaArca` (HANDOFF F3.2: "actualizando la fila RECHAZADO existente a
     * PENDIENTE en el reintento, no borrandola").
     *
     * Si la fila existente NO esta en RECHAZADO (no deberia pasar nunca: el lock de
     * F1.3 serializa por talonario y la reconciliacion de F3.3 se corre antes de
     * llegar aca si hay un PENDIENTE/INCIERTO colgado) se relanza el error tal cual:
     * es una situacion inesperada que tiene que frenar la emision, no pisarse en
     * silencio.
     */
    async InsertarOReintentarPendiente(datos: {
        idEmpresa: number;
        cuitEmisor: number;
        ptoVenta: number;
        tipoCbte: number;
        nro: number;
        payloadVenta?: any;
        entornoProduccion: boolean;
        usuario?: string;
        requestId?: string;
    }): Promise<number> {
        const connection = await db.getConnection();
        try {
            const consulta = `INSERT INTO fe_emisiones
                (idEmpresa, cuitEmisor, ptoVenta, tipoCbte, nro, estado, payloadVenta, entornoProduccion, usuario, requestId)
                VALUES (?, ?, ?, ?, ?, '${EstadoEmision.PENDIENTE}', ?, ?, ?, ?)`;
            const parametros = [
                datos.idEmpresa,
                datos.cuitEmisor,
                datos.ptoVenta,
                datos.tipoCbte,
                datos.nro,
                datos.payloadVenta ? JSON.stringify(datos.payloadVenta) : null,
                datos.entornoProduccion ? 1 : 0,
                datos.usuario ?? null,
                datos.requestId ?? null,
            ];

            try {
                const [resultado]: any = await connection.query(consulta, parametros);
                return resultado.insertId;
            } catch (error: any) {
                if (error.code !== 'ER_DUP_ENTRY') throw error;

                const [filas]: any = await connection.query(
                    `SELECT id, estado, respuestaArca FROM fe_emisiones
                     WHERE cuitEmisor = ? AND ptoVenta = ? AND tipoCbte = ? AND nro = ?
                     FOR UPDATE`,
                    [datos.cuitEmisor, datos.ptoVenta, datos.tipoCbte, datos.nro]
                );
                const existente = filas?.[0];

                if (!existente || existente.estado !== EstadoEmision.RECHAZADO) {
                    // No es el caso esperado (reintento tras rechazo): no pisamos nada,
                    // se relanza para que Facturar() lo trate como bloqueante.
                    throw error;
                }

                const historial = Array.isArray(existente.respuestaArca)
                    ? existente.respuestaArca
                    : (existente.respuestaArca ? [existente.respuestaArca] : []);

                await connection.query(
                    `UPDATE fe_emisiones
                     SET estado = '${EstadoEmision.PENDIENTE}', cae = NULL, caeVto = NULL,
                         payloadVenta = ?, payloadArca = NULL, respuestaArca = ?
                     WHERE id = ?`,
                    [
                        datos.payloadVenta ? JSON.stringify(datos.payloadVenta) : null,
                        JSON.stringify(historial),
                        existente.id,
                    ]
                );
                return existente.id;
            }
        } finally {
            connection.release();
        }
    }

    async MarcarAprobado(id: number, datos: { cae: string | number; caeVto: string; payloadArca?: any; respuestaArca?: any }): Promise<void> {
        await this.actualizarEstado(id, EstadoEmision.APROBADO, datos);
    }

    async MarcarRechazado(id: number, datos: { payloadArca?: any; respuestaArca?: any }): Promise<void> {
        await this.actualizarEstado(id, EstadoEmision.RECHAZADO, datos);
    }

    async MarcarIncierto(id: number, datos: { payloadArca?: any; respuestaArca?: any }): Promise<void> {
        await this.actualizarEstado(id, EstadoEmision.INCIERTO, datos);
    }

    private async actualizarEstado(id: number, estado: EstadoEmision, datos: { cae?: string | number; caeVto?: string; payloadArca?: any; respuestaArca?: any }): Promise<void> {
        const connection = await db.getConnection();
        try {
            await connection.query(
                `UPDATE fe_emisiones
                 SET estado = ?, cae = ?, caeVto = ?, payloadArca = ?, respuestaArca = ?
                 WHERE id = ?`,
                [
                    estado,
                    datos.cae ?? null,
                    datos.caeVto ?? null,
                    datos.payloadArca ? JSON.stringify(datos.payloadArca) : null,
                    datos.respuestaArca ? JSON.stringify(datos.respuestaArca) : null,
                    id,
                ]
            );
        } finally {
            connection.release();
        }
    }

    /**
     * MAX(nro) entre los estados que efectivamente consumieron numero en ARCA
     * (ver ESTADOS_EMISION_CONSUMEN_NUMERO). F3.3 reemplaza a ObtenerUltimoTicketLocal
     * (que leia solo ventas_factura) - facturacionService toma el mayor entre este
     * valor y el de ventas_factura, y loguea si difieren.
     */
    async ObtenerUltimoNroLocal(cuitEmisor: number, ptoVenta: number, tipoCbte: number): Promise<number> {
        const connection = await db.getConnection();
        try {
            const [rows]: any = await connection.query(
                `SELECT MAX(nro) AS ultimoNro
                 FROM fe_emisiones
                 WHERE cuitEmisor = ? AND ptoVenta = ? AND tipoCbte = ?
                   AND estado IN ('APROBADO', 'APROBADO_SIN_REGISTRAR', 'REGULARIZADO')`,
                [cuitEmisor, ptoVenta, tipoCbte]
            );
            return Number(rows?.[0]?.ultimoNro ?? 0);
        } finally {
            connection.release();
        }
    }

    /**
     * Fila que bloquea el talonario (F3.3): un INCIERTO sin resolver, o un PENDIENTE
     * de mas de 2 minutos (se asume que el proceso que lo dejo asi murio o colgo antes
     * de llegar a actualizar el estado). Se corre la reconciliacion de F1.4 sobre ella
     * antes de permitir una nueva emision.
     */
    async ObtenerFilaBloqueante(cuitEmisor: number, ptoVenta: number, tipoCbte: number): Promise<any | null> {
        const connection = await db.getConnection();
        try {
            const [rows]: any = await connection.query(
                `SELECT * FROM fe_emisiones
                 WHERE cuitEmisor = ? AND ptoVenta = ? AND tipoCbte = ?
                   AND (
                        estado = '${EstadoEmision.INCIERTO}'
                        OR (estado = '${EstadoEmision.PENDIENTE}' AND fechaAlta < DATE_SUB(NOW(), INTERVAL 2 MINUTE))
                   )
                 ORDER BY fechaAlta DESC
                 LIMIT 1`,
                [cuitEmisor, ptoVenta, tipoCbte]
            );
            return rows?.[0] ?? null;
        } finally {
            connection.release();
        }
    }

    /**
     * Vincula la emision con la venta ya guardada. A proposito corre DENTRO de la
     * transaccion de Agregar/Modificar (recibe su `connection`, no abre una propia):
     * si esa transaccion hace rollback, el vinculo tiene que revertirse con ella. La
     * fila de fe_emisiones en si (estado APROBADO, CAE, etc.) sobrevive al rollback
     * -es historia real de lo que paso con ARCA- pero queda con idVenta NULL, como
     * un comprobante emitido y no registrado (mismo caso que APROBADO_SIN_REGISTRAR,
     * a resolver por Regularizar en F4).
     */
    async VincularVenta(connection: any, idEmision: number, idVenta: number): Promise<void> {
        await connection.query(
            `UPDATE fe_emisiones SET idVenta = ? WHERE id = ?`,
            [idVenta, idEmision]
        );
    }
}

export const FeEmisionesRepo = new FeEmisionesRepository();
