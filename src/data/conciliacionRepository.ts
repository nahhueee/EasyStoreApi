import db from '../db';
import { RowDataPacket } from 'mysql2';
import { IdProceso, SQL_METODO_PAGO_CASE } from '../models/ventaEstados';
const moment = require('moment');

/**
 * Repositorio del informe "Ventas para Conciliación" (sección Administración).
 * Ver HANDOFF-informes-administracion-R1.md para el diseño completo.
 *
 * Archivo nuevo y separado de ventasRepository.ts, mismo criterio que
 * librosIvaRepository.ts: es un informe contable-fiscal para Administración,
 * con consumidor y ciclo de cambio distintos del informe operativo de Ventas.
 * NO se toca excelVentasService.ts ni las 4 queries de ObtenerReporte* de
 * ventasRepository.ts (salvo la extracción de SQL_METODO_PAGO_CASE, ya hecha
 * en ventaEstados.ts / ventasRepository.ts).
 *
 * Fase R1 (este archivo, por ahora): cabecera (1 fila por comprobante). R2
 * (detalle valorizado) va a reusar ObtenerVentasConciliacion para su control
 * de consistencia "detalle - cabecera = 0" - ver §1 del handoff.
 */
class ConciliacionRepository {

    /**
     * Filtros comunes a ambas queries de este repositorio:
     * { fechas: [desde, hasta], idProceso, cliente, nroProceso, incluirAnuladas }
     * (misma forma que ya usan ObtenerReporteAcumulado/Ventas, más incluirAnuladas).
     */
    private ArmarFiltroComun(filtros: any): string {
        let filtro = '';

        if (filtros?.fechas?.length === 2 && filtros.fechas[0] && filtros.fechas[1]) {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');
            filtro += ` AND v.fecha >= '${desde}' AND v.fecha < '${hasta}'`;
        }
        if (filtros?.idProceso && filtros.idProceso != 0) {
            filtro += ' AND v.idProceso = ' + Number(filtros.idProceso);
        }
        if (filtros?.cliente && filtros.cliente != 0) {
            filtro += ' AND v.idCliente = ' + Number(filtros.cliente);
        }
        if (filtros?.nroProceso && filtros.nroProceso != 0) {
            filtro += ' AND v.nroProceso = ' + Number(filtros.nroProceso);
        }
        return filtro;
    }

    /**
     * Hoja "Ventas" (R1): 1 fila por comprobante, todas las columnas de §5 del
     * handoff salvo las que se arman en TypeScript en el servicio de Excel
     * (Lista de precios -> MapearListaPrecio, Comprobante origen -> combina
     * columnas de vf/v según el caso, Punto de venta / N° comprobante ya vienen
     * resueltos acá en SQL igual que en ObtenerReporteVentas).
     *
     * PENDIENTE (§7.b del handoff, sin cerrar todavía): "Fecha de entrega" del
     * documento de origen. Por ahora la query no la resuelve - fechaEntregaOrigen
     * queda siempre NULL hasta confirmar contra la base real que
     * v.nroRelacionado/v.tipoRelacionado apuntan de forma confiable al
     * Presupuesto/Pedido de origen (ambigüedad con el mismo campo usado para
     * NC/ND - ver comentario en el handoff). NO agregar un JOIN aproximado
     * (por cliente+fecha ni nada similar) sin esa confirmación.
     */
    async ObtenerVentasConciliacion(filtros: any) {
        const connection = await db.getConnection();
        const filtro = this.ArmarFiltroComun(filtros);
        const incluirAnuladas = !!filtros?.incluirAnuladas;

        try {
            const query = `
                SELECT
                    v.id                                            AS idVenta,
                    v.nroProceso,
                    pv.descripcion                                  AS proceso,
                    v.fecha,
                    v.hora,
                    LPAD(IFNULL(vf.ptoVenta, e.puntoVta), 4, '0')   AS puntoVenta,
                    com.descripcion                                 AS tipoComprobante,
                    LPAD(IFNULL(
                        CASE WHEN v.idTComprobante IN (99, 100, 101) THEN v.nroProceso ELSE vf.ticket END
                    , 0), 8, '0')                                    AS nroComprobante,
                    IF(vf.idVenta IS NOT NULL, 'S', 'N')             AS fiscal,
                    IF(v.fechaBaja IS NOT NULL, 'Anulada', 'Emitida') AS estado,
                    p.descripcion                                   AS canalVenta,

                    e.razonSocial                                   AS facturante,
                    e.cuil                                          AS cuitFacturante,

                    c.id                                            AS codCliente,
                    IFNULL(NULLIF(c.razonSocial, ''), c.nombre)     AS razonSocial,
                    c.nombre                                        AS nombreCliente,
                    td.descripcion                                  AS tipoDoc,
                    c.documento                                     AS cuitDni,
                    ci.descripcion                                  AS condIva,
                    c.idListaPrecio                                 AS idListaPrecioCliente,
                    v.idLista                                       AS idListaVenta,
                    dir.localidad                                   AS localidad,

                    v.usuarioAlta                                   AS vendedor,
                    cp.descripcion                                  AS condicionPago,
                    IF(cc.tieneCC = 1, 'Cuenta corriente', 'Contado') AS condicionVenta,
                    v.fechaVencimiento,
                    -- Fecha de entrega del documento de origen (§7.b, confirmado sep-2026
                    -- contra la base real - ver vo más abajo). NULL para NC/ND (tipoRelacionado
                    -- ahí es 'FACTURA'/'COTIZACION', no matchea el CASE de vo, a propósito:
                    -- fecha de entrega solo aplica a Factura/Cotización originada en
                    -- Presupuesto/Pedido/Nota de Empaque) y para ventas sin origen.
                    vo.fechaEntrega                                 AS fechaEntrega,

                    IF(v.idProceso = ${IdProceso.NOTA_CREDITO}, prendas.cantidad_prendas * -1, prendas.cantidad_prendas) AS cantPrendas,
                    IF(v.idProceso = ${IdProceso.NOTA_CREDITO}, servicios.cantidad_servicios * -1, servicios.cantidad_servicios) AS cantServicios,

                    IF(v.idProceso = ${IdProceso.NOTA_CREDITO},
                        IF(prendas.total_prendas IS NULL AND servicios.total_servicios IS NULL,
                            v.total,
                            IFNULL(prendas.total_prendas, 0) + IFNULL(servicios.total_servicios_venta, 0)
                        ) * -1,
                        IF(v.idProceso = ${IdProceso.NOTA_DEBITO} AND prendas.total_prendas IS NULL AND servicios.total_servicios IS NULL,
                            v.total,
                            IFNULL(prendas.total_prendas, 0) + IFNULL(servicios.total_servicios_venta, 0)
                        )
                    ) AS venta,
                    IF(v.idProceso = ${IdProceso.NOTA_CREDITO},
                        (IFNULL(servicios.total_servicios, 0) - IFNULL(servicios.total_servicios_venta, 0)) * -1,
                        (IFNULL(servicios.total_servicios, 0) - IFNULL(servicios.total_servicios_venta, 0))
                    ) AS servicio,
                    IF(v.idProceso = ${IdProceso.NOTA_CREDITO},
                        IFNULL(prendas.descuento_prendas, 0) + IFNULL(servicios.descuento_servicios, 0),
                        (IFNULL(prendas.descuento_prendas, 0) + IFNULL(servicios.descuento_servicios, 0)) * -1
                    ) AS descuentoMonto,
                    -- % efectivo (Descuento$/Bruto$), como número 0..1 (B4-204) - no como texto "50.00 %".
                    IFNULL(
                        ROUND(
                            (IFNULL(prendas.descuento_prendas, 0) + IFNULL(servicios.descuento_servicios, 0))
                            / NULLIF(IFNULL(prendas.total_prendas, 0) + IFNULL(servicios.total_servicios, 0), 0)
                        , 4),
                    0) AS descuentoPorcentaje,
                    IF(v.ajusteTransf = 1,
                        IF(v.idProceso = ${IdProceso.NOTA_CREDITO},
                            ROUND((IFNULL(prendas.total_prendas, 0) * (1 - IFNULL(v.descuento, 0) / 100) + IFNULL(servicios.total_servicios, 0)) * 0.10, 2) * -1,
                            ROUND((IFNULL(prendas.total_prendas, 0) * (1 - IFNULL(v.descuento, 0) / 100) + IFNULL(servicios.total_servicios, 0)) * 0.10, 2)
                        ),
                        0
                    ) AS ajusteTransferencia,
                    IFNULL(v.redondeo, 0)                           AS redondeo,

                    -- Neto/IVA: confirmados por ARCA (vf) si es fiscal, derivados de v.total si no.
                    -- Se reemplazan por la suma del detalle en R2 (§8 del handoff) - no definitivos.
                    IF(v.idProceso = ${IdProceso.NOTA_CREDITO}, -1, 1) *
                        IF(vf.idVenta IS NOT NULL, vf.neto, ROUND(v.total / 1.21, 2))  AS netoGravado,
                    IF(v.idProceso = ${IdProceso.NOTA_CREDITO}, -1, 1) *
                        IF(vf.idVenta IS NOT NULL, vf.iva, v.total - ROUND(v.total / 1.21, 2)) AS iva,
                    IF(v.idProceso = ${IdProceso.NOTA_CREDITO}, v.total * -1, v.total) AS totalComprobante,

                    pagos.metodos                                   AS metodosPago,
                    pagos.montos                                    AS montosPago,

                    vf.cae                                          AS cae,
                    vf.caeVto                                       AS caeVto,
                    -- Crudos para armar "Comprobante origen" en el servicio de Excel (dos
                    -- fuentes distintas según el caso - ver §5 del handoff):
                    v.idTComprobante,
                    vf.tipoRelacionado                              AS vfTipoRelacionado,
                    vf.ptoVentaRelacionado                          AS vfPtoVentaRelacionado,
                    vf.ticketRelacionado                            AS vfTicketRelacionado,
                    v.nroRelacionado                                AS vNroRelacionado,
                    v.tipoRelacionado                                AS vTipoRelacionado,

                    v.observacion                                   AS motivo,
                    CONCAT(LPAD(IFNULL(e.puntoVta, 0), 4, '0'), '-', LPAD(IFNULL(v.id, 0), 8, '0')) AS remito

                FROM ventas v

                LEFT JOIN procesos_venta pv    ON pv.id = v.idProceso
                LEFT JOIN clientes c            ON c.id = v.idCliente
                LEFT JOIN tipos_comprobantes com ON com.id = v.idTComprobante
                LEFT JOIN puntos_venta p        ON p.id = v.idPunto
                LEFT JOIN empresas e             ON e.id = v.idEmpresa
                LEFT JOIN ventas_factura vf      ON vf.idVenta = v.id
                LEFT JOIN tipos_documento td     ON td.id = c.idTipoDocumento
                LEFT JOIN condiciones_iva ci     ON ci.id = c.idCondIva
                LEFT JOIN condiciones_pago cp    ON cp.id = c.idCondicionPago

                -- Localidad: dirección de menor id del cliente (MIN(id), LEFT JOIN para
                -- que un cliente sin dirección no desaparezca del informe) - decisión
                -- cerrada §3.4 del handoff.
                LEFT JOIN (
                    SELECT idCliente, MIN(id) AS idDireccionMin
                    FROM direcciones_cliente
                    GROUP BY idCliente
                ) dcMin ON dcMin.idCliente = c.id
                LEFT JOIN direcciones_cliente dir ON dir.id = dcMin.idDireccionMin

                -- Documento de origen (Presupuesto/Pedido/Nota de Empaque), solo para leer
                -- su fechaEntrega (§7.b). tipoRelacionado en ventas es texto
                -- ('PRESUPUESTO'/'PEDIDO'/'NOTA DE EMPAQUE' - ver TipoRelacionado en
                -- ventaEstados.ts), por eso el CASE en vez de comparar contra idProceso
                -- directo. Para NC/ND, tipoRelacionado vale 'FACTURA'/'COTIZACION' (ver
                -- ObtenerNotasVenta en ventasRepository.ts) y el CASE no matchea ningún
                -- WHEN -> vo queda NULL, correcto (fecha de entrega no aplica ahí).
                LEFT JOIN ventas vo
                    ON vo.nroProceso = v.nroRelacionado
                   AND vo.idProceso = CASE v.tipoRelacionado
                                        WHEN 'PRESUPUESTO' THEN ${IdProceso.PRESUPUESTO}
                                        WHEN 'PEDIDO' THEN ${IdProceso.PEDIDO}
                                        WHEN 'NOTA DE EMPAQUE' THEN ${IdProceso.NOTA_EMPAQUE}
                                      END

                -- Condición de venta: 'Cuenta corriente' si algún pago de la venta es CC.
                LEFT JOIN (
                    SELECT vp.idVenta, MAX(CASE WHEN mp.tipo = 'CUENTA_CORRIENTE' THEN 1 ELSE 0 END) AS tieneCC
                    FROM ventas_pagos vp
                    INNER JOIN metodos_pago mp ON mp.id = vp.idMetodo
                    GROUP BY vp.idVenta
                ) cc ON cc.idVenta = v.id

                -- Métodos/montos de pago: mismo patrón que ObtenerReporteVentas, pero
                -- usando la constante compartida del método de pago (fix B4-217).
                LEFT JOIN (
                    SELECT
                        vp.idVenta,
                        GROUP_CONCAT(${SQL_METODO_PAGO_CASE} ORDER BY mp.nombre SEPARATOR ';') AS metodos,
                        GROUP_CONCAT(vp.monto ORDER BY mp.nombre SEPARATOR ';')                AS montos
                    FROM ventas_pagos vp
                    INNER JOIN metodos_pago mp ON mp.id = vp.idMetodo
                    LEFT JOIN fondos f          ON f.id = mp.idFondo
                    GROUP BY vp.idVenta
                ) pagos ON pagos.idVenta = v.id

                LEFT JOIN (
                    SELECT
                        idVenta,
                        SUM(CASE WHEN tipoItem = 'CATALOGO' THEN cantidad ELSE 0 END) AS cantidad_prendas,
                        SUM(total) AS total_prendas,
                        SUM(importeDescuento) AS descuento_prendas
                    FROM ventas_productos
                    GROUP BY idVenta
                ) prendas ON prendas.idVenta = v.id

                LEFT JOIN (
                    SELECT
                        idVenta,
                        SUM(total) AS total_servicios,
                        SUM(importeDescuento) AS descuento_servicios,
                        SUM(cantidad) AS cantidad_servicios,
                        SUM(CASE WHEN idServicio IN (6, 8, 12, 13, 14) THEN total ELSE 0 END) AS total_servicios_venta
                    FROM ventas_servicios
                    GROUP BY idVenta
                ) servicios ON servicios.idVenta = v.id

                WHERE
                    v.estado IN ('Finalizada', 'Facturada')
                    AND v.idProceso IN (${IdProceso.FACTURA}, ${IdProceso.COTIZACION}, ${IdProceso.NOTA_CREDITO}, ${IdProceso.NOTA_DEBITO})
                    ${incluirAnuladas ? '' : 'AND v.fechaBaja IS NULL'}
                    ${filtro}
                ORDER BY v.fecha ASC, v.hora ASC, v.id ASC
            `;

            const [rows] = await connection.query<RowDataPacket[]>(query);
            return rows;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Subtotales por medio de pago (hoja "Totales", 4º bloque - §9 del handoff).
     * Mismo criterio que ObtenerReporteAcumulado (incluido el manejo especial de
     * Cuenta Corriente: monto real = total venta - lo pagado con otros métodos),
     * pero reusando SQL_METODO_PAGO_CASE y excluyendo SIEMPRE los anulados
     * (a diferencia de la hoja "Ventas", que puede incluirlos si se pide).
     */
    async ObtenerSubtotalesPorMedioPago(filtros: any) {
        const connection = await db.getConnection();
        const filtro = this.ArmarFiltroComun(filtros);

        try {
            const query = `
                SELECT
                    ${SQL_METODO_PAGO_CASE} AS metodoPago,
                    SUM(
                        CASE
                            WHEN v.idProceso = ${IdProceso.NOTA_CREDITO} THEN -vp.monto
                            WHEN mp.tipo = 'CUENTA_CORRIENTE' THEN v.total - COALESCE(otros.total_otros, 0)
                            ELSE vp.monto
                        END
                    ) AS totalAcumulado
                FROM ventas v
                INNER JOIN ventas_pagos vp ON vp.idVenta = v.id
                INNER JOIN metodos_pago mp ON mp.id = vp.idMetodo
                LEFT JOIN fondos f         ON f.id = mp.idFondo
                LEFT JOIN (
                    SELECT vpOtros.idVenta, SUM(vpOtros.monto) AS total_otros
                    FROM ventas_pagos vpOtros
                    JOIN metodos_pago mpOtros ON mpOtros.id = vpOtros.idMetodo
                    WHERE mpOtros.tipo <> 'CUENTA_CORRIENTE'
                    GROUP BY vpOtros.idVenta
                ) otros ON otros.idVenta = v.id
                WHERE v.fechaBaja IS NULL
                    AND v.estado IN ('Finalizada', 'Facturada')
                    AND v.idProceso IN (${IdProceso.FACTURA}, ${IdProceso.COTIZACION}, ${IdProceso.NOTA_CREDITO}, ${IdProceso.NOTA_DEBITO})
                    ${filtro}
                GROUP BY metodoPago
                ORDER BY totalAcumulado DESC
            `;

            const [rows] = await connection.query<RowDataPacket[]>(query);
            return rows;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }
}

export const ConciliacionRepo = new ConciliacionRepository();
