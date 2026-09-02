import db from '../db';
import { RowDataPacket } from 'mysql2';
import { IdProceso } from '../models/ventaEstados';
const moment = require('moment');

/**
 * Repositorio del Libro IVA (Ventas y Compras). Archivo nuevo y separado de
 * ventasRepository.ts (que ya pasa las 2100 líneas) - ver HANDOFF-libro-iva-
 * ventas-y-compras.md para el diseño completo.
 *
 * Fase 1 (este archivo, por ahora): Libro IVA Ventas.
 * Fase 2 (pendiente): Libro IVA Compras, en la misma clase.
 */
class LibrosIvaRepository {

    //#region VENTAS

    /**
     * Filas del Libro IVA Ventas para el período y empresa dados.
     *
     * El INNER JOIN contra ventas_factura es el filtro fiscal: solo trae ventas
     * que efectivamente se informaron a ARCA (tienen CAE), excluyendo sin casos
     * especiales Cotización, NC X y ND X (que no pasan por ARCA y no generan fila
     * en ventas_factura).
     *
     * vf.dni / vf.tipoDni (no clientes.documento): el libro tiene que reflejar lo
     * que se informó a ARCA en el momento de facturar. Si después se editó el
     * cliente, el libro no puede cambiar retroactivamente.
     *
     * razonSocial sí sale de clientes en vivo - no hay snapshot en ventas_factura,
     * no queda otra. Es una limitación conocida, documentada en el handoff.
     *
     * No se filtra por v.estado ni v.fechaBaja: un comprobante con CAE ya existe
     * para ARCA, no puede desaparecer del libro porque en el sistema se marcó
     * como anulado. Se trae igual y se marca en la columna Observación del Excel
     * (Fase 1, Paso 3) - filtrarlo acá haría que el libro no cierre contra Mis
     * Comprobantes.
     */
    async ObtenerLibroIvaVentas(filtros: any) {
        if (!filtros?.idEmpresa) {
            throw new Error('Falta idEmpresa: el Libro IVA es por CUIT, no se puede generar sin especificar la empresa.');
        }
        if (!(filtros.fechas?.length === 2 && filtros.fechas[0] && filtros.fechas[1])) {
            throw new Error('Faltan las fechas del período.');
        }

        const connection = await db.getConnection();

        try {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            const query = `
                SELECT
                    v.id                                         AS idVenta,
                    v.fecha,
                    v.hora,
                    vf.tipoFactura,
                    vf.ptoVenta,
                    vf.ticket,
                    vf.tipoDni,
                    vf.dni,
                    IFNULL(NULLIF(c.razonSocial, ''), c.nombre)   AS razonSocial,
                    ci.descripcion                                AS condicionIva,
                    vf.neto,
                    vf.iva,
                    v.total,
                    vf.cae,
                    vf.tipoRelacionado,
                    vf.ptoVentaRelacionado,
                    vf.ticketRelacionado,
                    v.estado,
                    v.fechaBaja
                FROM ventas v
                INNER JOIN ventas_factura vf ON vf.idVenta = v.id
                LEFT JOIN clientes c          ON c.id = v.idCliente
                LEFT JOIN condiciones_iva ci  ON ci.id = c.idCondIva
                WHERE v.idEmpresa = ?
                  AND v.fecha >= ? AND v.fecha < ?
                ORDER BY vf.tipoFactura ASC, vf.ptoVenta ASC, vf.ticket ASC
            `;

            const [rows] = await connection.query<RowDataPacket[]>(query, [filtros.idEmpresa, desde, hasta]);
            return rows;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Control de correlatividad del período: por cada par (tipoFactura, ptoVenta)
     * presente, calcula el piso (último ticket emitido antes del período), el
     * rango del período y la lista de números faltantes.
     *
     * Los huecos se arman en TypeScript, no en SQL: el volumen es chico (un par
     * de miles de comprobantes como mucho) y es mucho más legible que resolverlo
     * con una CTE recursiva. Si el primer ticket del período no es piso+1, el
     * hueco arranca en el período anterior - se refleja igual en `faltantes`,
     * marcado aparte con `saltoRespectoPeriodoAnterior` para que el Excel (Fase 1,
     * Paso 3) lo pueda anotar con una leyenda distinta.
     */
    async ObtenerCorrelatividadVentas(filtros: any) {
        if (!filtros?.idEmpresa) {
            throw new Error('Falta idEmpresa: el Libro IVA es por CUIT, no se puede generar sin especificar la empresa.');
        }
        if (!(filtros.fechas?.length === 2 && filtros.fechas[0] && filtros.fechas[1])) {
            throw new Error('Faltan las fechas del período.');
        }

        const connection = await db.getConnection();

        try {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            const [filasPeriodo] = await connection.query<RowDataPacket[]>(`
                SELECT vf.tipoFactura, vf.ptoVenta, vf.ticket
                FROM ventas v
                INNER JOIN ventas_factura vf ON vf.idVenta = v.id
                WHERE v.idEmpresa = ? AND v.fecha >= ? AND v.fecha < ?
                ORDER BY vf.tipoFactura ASC, vf.ptoVenta ASC, vf.ticket ASC
            `, [filtros.idEmpresa, desde, hasta]);

            const [filasPiso] = await connection.query<RowDataPacket[]>(`
                SELECT vf.tipoFactura, vf.ptoVenta, MAX(vf.ticket) AS piso
                FROM ventas v
                INNER JOIN ventas_factura vf ON vf.idVenta = v.id
                WHERE v.idEmpresa = ? AND v.fecha < ?
                GROUP BY vf.tipoFactura, vf.ptoVenta
            `, [filtros.idEmpresa, desde]);

            const pisoPorPar = new Map<string, number>();
            for (const fila of filasPiso) {
                pisoPorPar.set(`${fila.tipoFactura}-${fila.ptoVenta}`, fila.piso);
            }

            // Agrupa los tickets del período por par (tipoFactura, ptoVenta).
            const ticketsPorPar = new Map<string, { tipoFactura: number; ptoVenta: number; tickets: number[] }>();
            for (const fila of filasPeriodo) {
                const clave = `${fila.tipoFactura}-${fila.ptoVenta}`;
                if (!ticketsPorPar.has(clave)) {
                    ticketsPorPar.set(clave, { tipoFactura: fila.tipoFactura, ptoVenta: fila.ptoVenta, tickets: [] });
                }
                ticketsPorPar.get(clave)!.tickets.push(fila.ticket);
            }

            const resultado: any[] = [];
            for (const [clave, { tipoFactura, ptoVenta, tickets }] of ticketsPorPar) {
                const piso = pisoPorPar.has(clave) ? pisoPorPar.get(clave)! : null;
                const primero = tickets[0];
                const ultimo = tickets[tickets.length - 1];

                // Piso conocido -> el rango esperado arranca en piso+1 (así el hueco
                // entre períodos también aparece). Sin piso (primer comprobante
                // histórico del par) -> arranca en el primero del período.
                const desdeEsperado = piso !== null ? piso + 1 : primero;

                const emitidos = new Set(tickets);
                const faltantes: number[] = [];
                for (let n = desdeEsperado; n <= ultimo; n++) {
                    if (!emitidos.has(n)) faltantes.push(n);
                }

                resultado.push({
                    tipoFactura,
                    ptoVenta,
                    ultimoPeriodoAnterior: piso,
                    desde: primero,
                    hasta: ultimo,
                    emitidos: tickets.length,
                    esperados: ultimo - desdeEsperado + 1,
                    faltantes,
                    saltoRespectoPeriodoAnterior: piso !== null && primero !== piso + 1,
                });
            }

            return resultado.sort((a, b) => a.tipoFactura - b.tipoFactura || a.ptoVenta - b.ptoVenta);

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Ventas del período (misma empresa) que impactan el total de ventas del
     * negocio pero NO tienen fila en ventas_factura - típicamente NC X, ND X y
     * Cotizaciones. Es el insumo de la hoja de conciliación (Fase 1, Paso 3,
     * Hoja 3): explica por qué el total del libro no coincide con el total de
     * ventas del período sin que haya que ir a buscarlo a mano.
     *
     * Se limita a idProceso IN (Factura, Cotización, NC, ND) - el circuito de
     * facturación - para no traer Presupuestos/Pedidos/Notas de Empaque, que no
     * son parte de este análisis.
     */
    async ObtenerExcluidosDelLibro(filtros: any) {
        if (!filtros?.idEmpresa) {
            throw new Error('Falta idEmpresa: el Libro IVA es por CUIT, no se puede generar sin especificar la empresa.');
        }
        if (!(filtros.fechas?.length === 2 && filtros.fechas[0] && filtros.fechas[1])) {
            throw new Error('Faltan las fechas del período.');
        }

        const connection = await db.getConnection();

        try {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            const query = `
                SELECT v.id, v.idProceso, pv.descripcion AS proceso, v.idTComprobante,
                       v.nroProceso, v.fecha, v.total,
                       IFNULL(NULLIF(c.razonSocial, ''), c.nombre) AS razonSocial
                FROM ventas v
                LEFT JOIN ventas_factura vf ON vf.idVenta = v.id
                LEFT JOIN procesos_venta pv ON pv.id = v.idProceso
                LEFT JOIN clientes c        ON c.id = v.idCliente
                WHERE v.idEmpresa = ?
                  AND v.fecha >= ? AND v.fecha < ?
                  AND vf.idVenta IS NULL
                  AND v.idProceso IN (?, ?, ?, ?)
                ORDER BY v.fecha
            `;

            const [rows] = await connection.query<RowDataPacket[]>(query, [
                filtros.idEmpresa, desde, hasta,
                IdProceso.FACTURA, IdProceso.COTIZACION, IdProceso.NOTA_CREDITO, IdProceso.NOTA_DEBITO,
            ]);
            return rows;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    //#endregion
}

export const LibrosIvaRepo = new LibrosIvaRepository();
