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
     * Igual que ArmarFiltroComun pero SIN la fecha (R3 filtra por fecha de
     * COBRO, no de comprobante - HANDOFF-informes-administracion-R3.md §2) y
     * sin el filtro de cliente (en ObtenerCobranzas el cliente se resuelve
     * distinto según la fila tenga o no comprobante - ver ArmarBaseCobranzas).
     */
    private ArmarFiltroProcesoSinFecha(filtros: any): string {
        let filtro = '';
        if (filtros?.idProceso && filtros.idProceso != 0) {
            filtro += ' AND v.idProceso = ' + Number(filtros.idProceso);
        }
        if (filtros?.nroProceso && filtros.nroProceso != 0) {
            filtro += ' AND v.nroProceso = ' + Number(filtros.nroProceso);
        }
        return filtro;
    }

    /**
     * Rango de fechas ya formateado para SQL (mismo criterio que ArmarFiltroComun),
     * separado para poder aplicarlo sobre "fechaCobro" en vez de "v.fecha" - R3
     * (HANDOFF-informes-administracion-R3.md §2).
     */
    private RangoFechas(filtros: any): { desde: string; hasta: string } | null {
        if (filtros?.fechas?.length === 2 && filtros.fechas[0] && filtros.fechas[1]) {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');
            return { desde, hasta };
        }
        return null;
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
                    CONCAT(LPAD(IFNULL(e.puntoVta, 0), 4, '0'), '-', LPAD(IFNULL(v.id, 0), 8, '0')) AS remito,

                    -- Crudo para R2 (HANDOFF-informes-administracion-R2.md §4.a): distingue NC del
                    -- resto para aplicar signo al valorizar el detalle. No se muestra en la hoja
                    -- "Ventas" (no está en sheetVentas.columns) - uso interno del servicio de Excel.
                    v.idProceso                                     AS idProcesoRaw,

                    -- Crudo para R2 (corrección tanda 1, sep-2026, punto 1): IVA real informado a
                    -- ARCA, para prorratear entre las líneas del detalle en vez de derivarlo al 21%
                    -- fijo (rompía en Factura C, que no discrimina IVA). NULL si no es fiscal.
                    vf.iva                                          AS vfIvaRaw,

                    -- Crudo para R2 (corrección tanda 1, punto 6): plazo de pago actual del cliente,
                    -- para el texto "Cliente (N días)" de la columna "Origen del vencimiento" cuando
                    -- v.fechaVencimiento sí tiene valor.
                    c.diasVencimiento                               AS diasVencimientoCliente

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

    /**
     * Hoja "Detalle valorizado" (R2): 1 fila cruda por línea de comprobante, sin
     * valorizar todavía - la valorización (convención BRUTO/NETO, neto/IVA,
     * pseudolíneas, residual) se hace en TS en excelConciliacionService.ts (§4 y
     * §5 del handoff de R2), no acá, porque necesita agregar por comprobante y
     * volver a la línea (ilegible en SQL, ver §10).
     *
     * UNION ALL de 3 orígenes (§6 del handoff): a propósito NO se filtran las
     * cosas que sí filtra ObtenerReporteDetalles/ObtenerReporteServicios
     * (cantidad<>0, tipoItem='CATALOGO', exclusión de servicios) - esos filtros
     * son correctos para un reporte de conteo de prendas, pero acá rompen el
     * control "detalle = cabecera" (§1 del handoff): si una línea tiene importe,
     * tiene que entrar, tenga cantidad o no, esté catalogada o no.
     *
     * La cabecera de cada comprobante (identificación, total, redondeo,
     * ajusteTransferencia, motivo) NO se vuelve a traer acá - se reusa el
     * resultado de ObtenerVentasConciliacion (mismo filtro, misma corrida),
     * como ya anticipaba el comentario de ese método. idProcesoRaw se agregó
     * ahí puntualmente para que R2 pueda determinar el signo sin adivinarlo.
     */
    async ObtenerDetalleLineas(filtros: any) {
        const connection = await db.getConnection();
        const filtro = this.ArmarFiltroComun(filtros);
        const incluirAnuladas = !!filtros?.incluirAnuladas;

        const condicionVentas = `
            v.estado IN ('Finalizada', 'Facturada')
            AND v.idProceso IN (${IdProceso.FACTURA}, ${IdProceso.COTIZACION}, ${IdProceso.NOTA_CREDITO}, ${IdProceso.NOTA_DEBITO})
            ${incluirAnuladas ? '' : 'AND v.fechaBaja IS NULL'}
            ${filtro}
        `;

        try {
            const query = `
                SELECT
                    vp.idVenta,
                    vp.id                                   AS idLinea,
                    'Producto'                               AS tipoItem,
                    vp.cantidad,
                    vp.precioLista,
                    vp.total,
                    IFNULL(vp.importeDescuento, 0)           AS importeDescuento,
                    vp.talles,
                    vp.t1, vp.t2, vp.t3, vp.t4, vp.t5, vp.t6, vp.t7, vp.t8, vp.t9, vp.t10,
                    prod.codigo                              AS codigoArticulo,
                    prod.nombre                              AS descripcion,
                    tp.descripcion                           AS producto,
                    sp.descripcion                           AS tipo,
                    g.descripcion                            AS genero,
                    m.descripcion                            AS material,
                    col.descripcion                          AS color,
                    -- Corrección tanda 1, punto 5 / B4-213: existe en productos.idTemporada,
                    -- sin migración - solo catálogo, NULL en no catalogado/servicio (ramas de abajo).
                    temp.descripcion                         AS temporada
                FROM ventas_productos vp
                INNER JOIN ventas v            ON v.id = vp.idVenta
                -- Mismo criterio que ObtenerReporteDetalles: el JOIN al catálogo va
                -- condicionado por tipoItem, dos tablas con numeración independiente.
                LEFT JOIN productos prod       ON prod.id = vp.idProducto AND vp.tipoItem = 'CATALOGO'
                LEFT JOIN tipos_producto tp    ON tp.id = prod.idTipo
                LEFT JOIN subtipos_producto sp ON sp.id = prod.idSubtipo
                LEFT JOIN materiales m         ON m.id = prod.idMaterial
                LEFT JOIN generos g            ON g.id = prod.idGenero
                LEFT JOIN colores col          ON col.id = prod.idColor
                LEFT JOIN temporadas temp      ON temp.id = prod.idTemporada
                WHERE vp.tipoItem = 'CATALOGO' AND ${condicionVentas}

                UNION ALL

                SELECT
                    vp.idVenta,
                    vp.id                                   AS idLinea,
                    'No catalogado'                          AS tipoItem,
                    vp.cantidad,
                    vp.precioLista,
                    vp.total,
                    IFNULL(vp.importeDescuento, 0)           AS importeDescuento,
                    vp.talles,
                    vp.t1, vp.t2, vp.t3, vp.t4, vp.t5, vp.t6, vp.t7, vp.t8, vp.t9, vp.t10,
                    NULL                                      AS codigoArticulo,
                    -- Snapshot del ítem no catalogado (§6.2 del handoff) - no hay JOIN a
                    -- productos_presupuesto acá a propósito, el nombre queda fijado al
                    -- momento de la venta.
                    vp.descripcion                           AS descripcion,
                    NULL AS producto, NULL AS tipo, NULL AS genero, NULL AS material, NULL AS color,
                    NULL AS temporada
                FROM ventas_productos vp
                INNER JOIN ventas v ON v.id = vp.idVenta
                WHERE vp.tipoItem = 'PRESUPUESTO' AND ${condicionVentas}

                UNION ALL

                SELECT
                    vs.idVenta,
                    vs.id                                   AS idLinea,
                    'Servicio'                                AS tipoItem,
                    vs.cantidad,
                    NULL                                      AS precioLista,
                    vs.total,
                    IFNULL(vs.importeDescuento, 0)            AS importeDescuento,
                    NULL AS talles,
                    NULL AS t1, NULL AS t2, NULL AS t3, NULL AS t4, NULL AS t5,
                    NULL AS t6, NULL AS t7, NULL AS t8, NULL AS t9, NULL AS t10,
                    s.codigo                                  AS codigoArticulo,
                    -- Mismo fallback que ObtenerReporteServicios: un idServicio huérfano
                    -- (borrado del catálogo) sigue apareciendo, no desaparece del detalle.
                    IFNULL(s.descripcion, CONCAT('(servicio eliminado #', vs.idServicio, ')')) AS descripcion,
                    NULL AS producto, NULL AS tipo, NULL AS genero, NULL AS material, NULL AS color,
                    NULL AS temporada
                FROM ventas_servicios vs
                INNER JOIN ventas v    ON v.id = vs.idVenta
                LEFT JOIN servicios s  ON s.id = vs.idServicio
                WHERE ${condicionVentas}

                ORDER BY idVenta ASC, idLinea ASC
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
     * Base de "1 fila por cobro" para R3 (HANDOFF-informes-administracion-R3.md
     * §3-5), UNION ALL de DOS orígenes:
     *
     * - Rama A: `ventas_pagos` con idEntrega NULL - cobrado al emitir el
     *   comprobante. Siempre tiene idVenta (ProcesarCobroVenta en
     *   ventasRepository.ts liga pago.idVenta = venta.id).
     * - Rama B: `ventas_entrega_detalle` - TODO lo que salió de una Entrega de
     *   Dinero (cuenta corriente), tenga o no comprobante puntual.
     *
     * OJO, esto NO es "ventas_pagos con idEntrega no nulo" (que sería el
     * espejo directo de la rama A): es `ventas_entrega_detalle`. Verificado
     * línea por línea en EntregaDinero() (cuentasRepository.ts): la
     * cancelación de saldo inicial en efectivo/transferencia/débito (sin
     * cheque/crédito/retención) NO genera fila en ventas_pagos - "la
     * cancelación de saldo inicial no genera su propio ventas_pagos" dice el
     * comentario ahí mismo -, solo en ventas_entrega_detalle. Armar esta rama
     * sobre ventas_pagos hubiera perdido la mayoría de los cobros de saldo
     * inicial (confirmado por Nahu: $22,1M de $58,4M en agosto). El remanente
     * a saldo a favor SÍ genera fila en ambas tablas siempre, pero se usa
     * ventas_entrega_detalle igual acá por consistencia de una sola fuente
     * para todo lo que viene de una entrega.
     *
     * `tipoCobro` sale de ventas_entrega_detalle.tipoAplicacion: NULL (falsy,
     * confirmado en ObtenerRecibo de este mismo archivo: `if (!r.tipoAplicacion)
     * return acc`) = aplicado a un comprobante puntual; 'SALDO_INICIAL' /
     * 'SALDO_A_FAVOR' = sin comprobante (columnas de comprobante NULL en esas
     * filas - §5.3 del handoff).
     *
     * `estadoIngreso`: cinco valores posibles - 'Ingresó', 'Pendiente de
     * acreditación' (CHEQUE/CREDITO todavía PENDIENTE), 'Rechazado' (CHEQUE/
     * CREDITO con estado RECHAZADO - la plata nunca entró), 'No es ingreso'
     * (financiación/crédito ya existente, nunca plata nueva) y 'Revisar
     * (fondo sin clasificar)' (ver abajo). CHEQUE y CREDITO pasan los dos por
     * `valores_acreditar` (RegistrarMovimientosVenta en ventasRepository.ts:
     * `TIPOS_VALOR = ['CHEQUE', 'CREDITO']`), con estado PENDIENTE/ACREDITADO/
     * RECHAZADO (valoresRepository.ts) - datos reales de agosto: tarjeta
     * 72,6% ACREDITADO / 19,6% PENDIENTE / 7,8% RECHAZADO, cheques 9/9
     * acreditados.
     *
     * Historial de esta columna (2 fixes previos, ambos por confiar en una
     * regla que no cubría todos los casos y fallaba EN SILENCIO):
     *   1. Lista blanca de mp.tipo (EFECTIVO/TRANSFERENCIA/DEBITO -> 'Ingresó',
     *      default 'No es ingreso') - dejó afuera 38 filas de MERCADOPAGO
     *      ($4.446.440,76) que sí eran plata real.
     *   2. `f.tipo IS NULL` = "fondo real" - premisa equivocada (asumida a
     *      partir de que solo 3 fondos VIRTUALES puntuales tienen `tipo`
     *      seteado, sin verificar el resto). fondos.tipo está poblado para
     *      TODOS los fondos - la condición no daba TRUE nunca, todo caía a
     *      'No es ingreso'.
     * Fix final (15/09/2026, verificado por Nahu contra la base real): DOS
     * listas EXPLÍCITAS sobre `f.tipo` (fondos.tipo, no fondos.nombre), sin
     * default silencioso en ninguna dirección:
     *   - Ingresa: EFECTIVO, BANCARIO, DIGITAL -> 'Ingresó'.
     *   - No ingresa: CUENTA_CLIENTE, VALOR_PENDIENTE, RETENCIONES_SUFRIDAS,
     *     CC_PROVEEDORES, SALDO_FAVOR_PROVEEDORES -> 'No es ingreso'.
     *   - Cualquier fondos.tipo que no esté en ninguna de las dos -> 'Revisar
     *     (fondo sin clasificar)', visible en vez de perdido en silencio.
     * CHEQUE/CREDITO se resuelven ANTES que las listas de fondo (su
     * `mp.idFondo` es un fondo tipo VALOR_PENDIENTE hasta que se acredita -
     * si el check de fondo fuera primero, un cheque ya ACREDITADO caería mal
     * igual). `f.tipo AS fondoTipo` / `mp.tipo AS metodoTipo` quedan como
     * columnas de salida (pedido de Nahu, defensivo/trazabilidad) aunque el
     * bug real nunca fue una colisión de alias - mp.tipo/f.tipo solo se usan
     * acá calificados, dentro del CASE/WHERE, nunca como columna de salida
     * sin alias.
     *
     * Vínculo a cheque/tarjeta (N° de operación, Estado del valor, Importe del
     * valor): un cheque/crédito que cancela varias ventas en una misma Entrega
     * de Dinero genera UN solo `valores_acreditar` anclado a UN solo
     * `ventas_pagos` (el primero que se crea en esa entrega - "Se registra UN
     * solo valores_acreditar por el monto total de la entrega... aunque
     * internamente se reparta entre varias ventas", cuentasRepository.ts). Un
     * join directo por idVentaPago solo lo muestra en 1 de las N filas de la
     * entrega. Se resuelve con la derived table `valorPorEntrega`, que ubica el
     * valor por `idEntrega` en vez de por el `ventas_pagos` ancla puntual, así
     * se repite en todas las filas de esa entrega (decisión de Nahu, R3 punto
     * 2). Para la rama A (cobrado al emitir, sin entrega) el vínculo es directo
     * por `vp.id`, no hace falta esa resolución.
     *
     * Cabecera del comprobante (fecha, cliente, condición de venta, etc.) se
     * repite en cada fila de cobro (§5 del handoff) y se resuelve con el mismo
     * patrón de columnas que ObtenerVentasConciliacion, pero SIN el filtro de
     * fecha (eso lo aplica el caller sobre `fechaCobro`, no acá - §2 del
     * handoff) y con los JOIN de venta en LEFT (la rama B puede no tener
     * comprobante).
     */
    private ArmarBaseCobranzas(filtros: any): string {
        const incluirAnuladas = !!filtros?.incluirAnuladas;
        const filtroProceso = this.ArmarFiltroProcesoSinFecha(filtros);
        const filtroCliente = filtros?.cliente && filtros.cliente != 0 ? Number(filtros.cliente) : null;

        // Condición de venta sobre v.*, la misma en las dos ramas - se guarda
        // en una constante para no repetirla mal entre las dos.
        const condicionVenta = `
            v.estado IN ('Finalizada', 'Facturada')
            AND v.idProceso IN (${IdProceso.FACTURA}, ${IdProceso.COTIZACION}, ${IdProceso.NOTA_CREDITO}, ${IdProceso.NOTA_DEBITO})
            ${incluirAnuladas ? '' : 'AND v.fechaBaja IS NULL'}
            ${filtroProceso}
        `;

        // Resuelve N° de operación (solo cheque - InsertCheque() en
        // ventasRepository.ts corre únicamente `if (tipo === 'CHEQUE')`, una
        // tarjeta nunca tiene fila en `cheques`), Estado del valor e Importe
        // del valor (cheque y tarjeta, va.monto) para un valor ya localizado
        // (alias `valor` con columnas idValor/tipoValor/estadoValor/montoValor).
        //
        // CORRECCIÓN R3 (15/09/2026, auditoría de agosto): `estadoIngreso` NO
        // se resuelve más por lista blanca de mp.tipo - dejaba afuera en
        // silencio cualquier medio no contemplado (38 filas de MERCADOPAGO,
        // $4.446.440,76, cayeron a "No es ingreso" antes de este fix).
        //
        // CORRECCIÓN 2 (15/09/2026, misma auditoría, segunda vuelta): el
        // primer fix (`f.tipo IS NULL` = fondo real) también estaba mal -
        // premisa equivocada. `GetIdFondoRetenciones()`/`GetFondoVirtual()`
        // solo prueban que 3 fondos VIRTUALES puntuales tienen `tipo` seteado;
        // de ahí asumí (sin verificar) que el resto quedaba en NULL. Verificado
        // contra la base real por Nahu: fondos.tipo está poblado para TODOS
        // los fondos, no solo los virtuales - EFECTIVO/BANCARIO/DIGITAL para
        // los que sí ingresan, CUENTA_CLIENTE/VALOR_PENDIENTE/
        // RETENCIONES_SUFRIDAS/CC_PROVEEDORES/SALDO_FAVOR_PROVEEDORES para los
        // que no - así que `f.tipo IS NULL` no daba TRUE nunca, y todo lo que
        // no fuera CHEQUE/CREDITO caía al ELSE. Fix: dos listas EXPLÍCITAS
        // (ninguna con default silencioso - ya fallamos en las dos direcciones:
        // lista blanca perdió MercadoPago, "sin tipo = real" perdió todo lo
        // demás) más un 5° valor `Revisar (fondo sin clasificar)` para
        // cualquier fondos.tipo que no esté en ninguna de las dos - así un
        // fondo nuevo sin clasificar queda VISIBLE, no perdido en silencio en
        // ninguna dirección. CHEQUE/CREDITO se resuelven ANTES que las listas
        // de fondo (su fondo es VALOR_PENDIENTE hasta que se acredita - si el
        // check de fondo fuera primero, un cheque ACREDITADO caería mal).
        //
        // `f.tipo AS fondoTipo` / `mp.tipo AS metodoTipo` como columnas de
        // salida (pedido de Nahu, defensivo): no hacía falta para este bug en
        // particular (mp.tipo/f.tipo solo se usan acá calificados, dentro del
        // CASE/WHERE - no hay columna de salida sin alias que colisione), pero
        // deja trazabilidad directa en el Excel/logs de qué tipo trajo cada
        // fila sin tener que volver a esta query.
        const columnasValor = `
            valor.estadoValor,
            valor.montoValor                                  AS importeValor,
            IF(valor.tipoValor = 'CHEQUE', chVal.numero, NULL) AS numeroOperacion,
            f.tipo                                             AS fondoTipo,
            mp.tipo                                            AS metodoTipo,
            CASE
                WHEN mp.tipo IN ('CHEQUE', 'CREDITO') AND valor.estadoValor = 'ACREDITADO' THEN 'Ingresó'
                WHEN mp.tipo IN ('CHEQUE', 'CREDITO') AND valor.estadoValor = 'RECHAZADO' THEN 'Rechazado'
                WHEN mp.tipo IN ('CHEQUE', 'CREDITO') THEN 'Pendiente de acreditación'
                WHEN f.tipo IN ('EFECTIVO', 'BANCARIO', 'DIGITAL') THEN 'Ingresó'
                WHEN f.tipo IN ('CUENTA_CLIENTE', 'VALOR_PENDIENTE', 'RETENCIONES_SUFRIDAS', 'CC_PROVEEDORES', 'SALDO_FAVOR_PROVEEDORES') THEN 'No es ingreso'
                ELSE 'Revisar (fondo sin clasificar)'
            END                                                AS estadoIngreso
        `;

        const columnasCabecera = `
            LPAD(IFNULL(vf.ptoVenta, e.puntoVta), 4, '0')       AS puntoVenta,
            com.descripcion                                     AS tipoComprobante,
            LPAD(IFNULL(
                CASE WHEN v.idTComprobante IN (99, 100, 101) THEN v.nroProceso ELSE vf.ticket END
            , 0), 8, '0')                                       AS nroComprobante,
            IF(vf.idVenta IS NOT NULL, 'S', 'N')                AS fiscal,
            e.razonSocial                                       AS facturante,
            IF(cc.tieneCC = 1, 'Cuenta corriente', 'Contado')   AS condicionVenta,
            IF(v.idProceso = ${IdProceso.NOTA_CREDITO}, v.total * -1, v.total) AS totalComprobante,
            v.idProceso                                          AS idProcesoRaw,
            v.fechaVencimiento
        `;

        // Condición de venta ('Cuenta corriente' si algún pago de la venta es
        // CC) - mismo criterio y misma query que ObtenerVentasConciliacion.
        const joinCondicionVenta = `
            LEFT JOIN (
                SELECT vpCC.idVenta, MAX(CASE WHEN mpCC.tipo = 'CUENTA_CORRIENTE' THEN 1 ELSE 0 END) AS tieneCC
                FROM ventas_pagos vpCC
                INNER JOIN metodos_pago mpCC ON mpCC.id = vpCC.idMetodo
                GROUP BY vpCC.idVenta
            ) cc ON cc.idVenta = v.id
        `;

        const ramaA = `
            SELECT
                CONCAT('VP', vp.id)                             AS idPago,
                vp.idVenta                                      AS idVentaCab,
                NULL                                             AS idEntrega,
                vp.idRecibo,
                'Aplicado a comprobante'                        AS tipoCobro,
                v.fecha                                          AS fechaCobro,
                vp.monto                                         AS importeCobrado,
                ${SQL_METODO_PAGO_CASE}                          AS medioCobro,
                f.nombre                                         AS fondo,
                v.nroProceso,
                v.fecha                                          AS fechaComprobante,
                c.id                                              AS codCliente,
                IFNULL(NULLIF(c.razonSocial, ''), c.nombre)      AS cliente,
                c.diasVencimiento                                 AS diasVencimientoCliente,
                ${columnasCabecera},
                ${columnasValor}
            FROM ventas_pagos vp
            INNER JOIN ventas v              ON v.id = vp.idVenta
            LEFT JOIN metodos_pago mp        ON mp.id = vp.idMetodo
            LEFT JOIN fondos f               ON f.id = mp.idFondo
            LEFT JOIN clientes c             ON c.id = v.idCliente
            LEFT JOIN tipos_comprobantes com ON com.id = v.idTComprobante
            LEFT JOIN empresas e             ON e.id = v.idEmpresa
            LEFT JOIN ventas_factura vf      ON vf.idVenta = v.id
            ${joinCondicionVenta}
            -- Vínculo directo (sin entrega, sin riesgo de partición - §3 del handoff).
            LEFT JOIN (
                SELECT idVentaPago, id AS idValor, tipo AS tipoValor, estado AS estadoValor, monto AS montoValor
                FROM valores_acreditar
            ) valor ON valor.idVentaPago = vp.id
            LEFT JOIN cheques chVal ON chVal.idValor = valor.idValor
            -- CORRECCIÓN R3 (15/09/2026): una fila de Cuenta Corriente es la venta
            -- FINANCIÁNDOSE, no un cobro - error de especificación del handoff
            -- original (inflaba el total del período en $61,2 M en agosto). Ya está
            -- representada en "Condición de venta" y lo pendiente en "Saldo
            -- pendiente"; no le corresponde una fila propia acá. No confundir con
            -- mp.tipo = 'SALDO_FAVOR' (Medio de cobro = Saldo a Favor - SÍ es un
            -- cobro, cancela una factura con crédito existente - eso no se toca).
            WHERE vp.idEntrega IS NULL
              AND (mp.tipo IS NULL OR mp.tipo <> 'CUENTA_CORRIENTE')
              AND ${condicionVenta}
              ${filtroCliente != null ? `AND v.idCliente = ${filtroCliente}` : ''}
        `;

        const ramaB = `
            SELECT
                CONCAT('VED', ved.id)                           AS idPago,
                ved.idVenta                                      AS idVentaCab,
                ved.idEntrega,
                ved.idRecibo,
                CASE ved.tipoAplicacion
                    WHEN 'SALDO_INICIAL' THEN 'Cancelación de saldo inicial'
                    WHEN 'SALDO_A_FAVOR' THEN 'Saldo a favor'
                    ELSE 'Aplicado a comprobante'
                END                                               AS tipoCobro,
                ve.fecha                                          AS fechaCobro,
                ved.montoAplicado                                 AS importeCobrado,
                ${SQL_METODO_PAGO_CASE}                           AS medioCobro,
                f.nombre                                          AS fondo,
                v.nroProceso,
                v.fecha                                           AS fechaComprobante,
                COALESCE(c.id, ce.id)                             AS codCliente,
                COALESCE(
                    IFNULL(NULLIF(c.razonSocial, ''), c.nombre),
                    IFNULL(NULLIF(ce.razonSocial, ''), ce.nombre)
                )                                                  AS cliente,
                COALESCE(c.diasVencimiento, ce.diasVencimiento)   AS diasVencimientoCliente,
                ${columnasCabecera},
                ${columnasValor}
            FROM ventas_entrega_detalle ved
            INNER JOIN ventas_entrega ve     ON ve.id = ved.idEntrega
            LEFT JOIN ventas v                ON v.id = ved.idVenta
            LEFT JOIN metodos_pago mp        ON mp.id = ved.idMetodoAplicado
            LEFT JOIN fondos f               ON f.id = mp.idFondo
            LEFT JOIN clientes c             ON c.id = v.idCliente
            -- Cliente de la ENTREGA (para las filas sin comprobante - §5.3 del handoff).
            LEFT JOIN clientes ce            ON ce.id = ve.idCliente
            LEFT JOIN tipos_comprobantes com ON com.id = v.idTComprobante
            -- Facturante: de la venta si hay comprobante; si no, no hay uno solo
            -- resoluble sin ambigüedad (ventas_entrega.idEmpresa es la empresa que
            -- ATENDIÓ la entrega, no necesariamente la que factura cada NC/ND que
            -- se está cancelando) - se deja vacío a propósito en esas filas.
            LEFT JOIN empresas e              ON e.id = v.idEmpresa
            LEFT JOIN ventas_factura vf       ON vf.idVenta = v.id
            ${joinCondicionVenta}
            -- Vínculo por idEntrega (repite en las filas partidas - R3 punto 2,
            -- decisión de Nahu). vpAncla es el ventas_pagos puntual al que quedó
            -- anclado el valores_acreditar de ESTA entrega (uno solo por entrega).
            LEFT JOIN (
                SELECT vpAncla.idEntrega, va.id AS idValor, va.tipo AS tipoValor,
                       va.estado AS estadoValor, va.monto AS montoValor
                FROM valores_acreditar va
                INNER JOIN ventas_pagos vpAncla ON vpAncla.id = va.idVentaPago
                WHERE vpAncla.idEntrega IS NOT NULL
            ) valor ON valor.idEntrega = ved.idEntrega
            LEFT JOIN cheques chVal ON chVal.idValor = valor.idValor
            -- Mismo filtro de Cuenta Corriente que ramaA (por consistencia - no se
            -- confirmó un caso real acá, pero ved.idMetodoAplicado podría en teoría
            -- apuntar a CC igual que vp.idMetodo).
            WHERE (
                ved.idVenta IS NULL
                OR ${condicionVenta}
            )
              AND (mp.tipo IS NULL OR mp.tipo <> 'CUENTA_CORRIENTE')
              ${filtroCliente != null ? `AND COALESCE(v.idCliente, ve.idCliente) = ${filtroCliente}` : ''}
        `;

        return `${ramaA} UNION ALL ${ramaB}`;
    }

    /**
     * Hoja "Cobranzas" (R3): 1 fila por cobro. Devuelve DOS conjuntos -
     * `filasPeriodo` (lo que se muestra, filtrado por fecha de COBRO - §2 del
     * handoff) y `filasUniverso` (TODOS los cobros de cada comprobante que
     * aparece en `filasPeriodo`, sin filtro de fecha - necesario para el
     * arrastre de saldo pendiente, §6: si una factura se cobró en dos meses,
     * el saldo de la fila del período tiene que descontar también lo del mes
     * anterior). La valorización (arrastre, días de atraso, filtrado final a
     * las filas del período) se hace en TS, en excelConciliacionService.ts.
     */
    async ObtenerCobranzas(filtros: any): Promise<{ filasPeriodo: any[]; filasUniverso: any[] }> {
        const connection = await db.getConnection();
        try {
            const base = this.ArmarBaseCobranzas(filtros);
            const rango = this.RangoFechas(filtros);

            const queryPeriodo = `
                SELECT * FROM (${base}) base
                ${rango ? `WHERE base.fechaCobro >= '${rango.desde}' AND base.fechaCobro < '${rango.hasta}'` : ''}
                ORDER BY base.idVentaCab ASC, base.fechaCobro ASC, base.idPago ASC
            `;
            const [filasPeriodo] = await connection.query<RowDataPacket[]>(queryPeriodo);

            // Universo completo SOLO de los comprobantes que aparecen en el
            // período (§6) - las filas sin comprobante (saldo inicial/a favor)
            // no necesitan arrastre, no se vuelven a traer acá.
            const idVentas = Array.from(new Set(
                filasPeriodo.map((f: any) => f.idVentaCab).filter((id: any) => id != null)
            ));

            let filasUniverso: RowDataPacket[] = [];
            if (idVentas.length > 0) {
                const queryUniverso = `
                    SELECT * FROM (${base}) base
                    WHERE base.idVentaCab IN (${idVentas.join(',')})
                    ORDER BY base.idVentaCab ASC, base.fechaCobro ASC, base.idPago ASC
                `;
                const [rows] = await connection.query<RowDataPacket[]>(queryUniverso);
                filasUniverso = rows;
            }

            return { filasPeriodo, filasUniverso };

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Recibos dados de baja en el período (R3, corrección 15/09/2026, fix 4.b).
     * DarBajaRecibo() (cuentasRepository.ts) NO borra el recibo - lo marca con
     * `fechaBaja` y `observaciones` (motivo obligatorio, valida con throw si
     * viene vacío) - pero SÍ borra en cascada sus movimientos de cobro
     * (ventas_pagos/ventas_entrega_detalle/ventas_entrega/valores_acreditar/
     * cheques/retenciones - las FK no dejan otra). Por eso un recibo dado de
     * baja después de emitido este informe hace que una corrida posterior del
     * mismo período no reproduzca los mismos números - este listado es la
     * trazabilidad de ESE caso: qué se anuló, cuándo y por qué. Filtra por
     * fechaBaja (no por fecha del recibo - lo que importa es cuándo se anuló).
     */
    async ObtenerRecibosDadosDeBaja(filtros: any): Promise<any[]> {
        const connection = await db.getConnection();
        try {
            const rango = this.RangoFechas(filtros);
            const [rows] = await connection.query<RowDataPacket[]>(`
                SELECT
                    r.id,
                    r.fecha,
                    r.idCliente,
                    IFNULL(NULLIF(c.razonSocial, ''), c.nombre) AS cliente,
                    r.total,
                    r.fechaBaja,
                    r.observaciones AS motivo
                FROM recibos r
                LEFT JOIN clientes c ON c.id = r.idCliente
                WHERE r.fechaBaja IS NOT NULL
                ${rango ? `AND r.fechaBaja >= '${rango.desde}' AND r.fechaBaja < '${rango.hasta}'` : ''}
                ORDER BY r.fechaBaja ASC
            `);
            return rows;
        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }
}

export const ConciliacionRepo = new ConciliacionRepository();
