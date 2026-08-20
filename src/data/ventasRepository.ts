import db from '../db';
import { NotaCreditoVenta, PagosVenta, ProductosVenta, ServiciosVenta, Venta } from '../models/Venta';
import { ObjQR } from '../models/ObjQR';
import { FacturaVenta } from '../models/FacturaVenta';
import { ProductosRepo } from './productosRepository';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Cliente } from '../models/Cliente';
import { SesionServ } from '../services/sesionService';
import { ResolverEstadoRelacionado, IdProceso, EstadoVenta, puedeDarseDeBaja, TipoItemVenta, TipoRelacionado } from '../models/ventaEstados';
const moment = require('moment');

// Actualiza el estado del proceso relacionado (Presupuesto/Pedido/Nota de Empaque)
// referenciado por venta.nroRelacionado/tipoRelacionado. Se llama una sola vez por
// guardado (alta o edición), después de tener venta.idProceso definitivo: si la venta
// que se está guardando es un cierre (Factura o Cotización) el relacionado pasa a su
// estado de cierre (Facturado/a, o Relacionado en el caso de Presupuesto); si no, queda
// en su estado "en uso" (Asociado/a). Reemplaza los dos bloques que existían antes
// (uno "al asociar" y otro "al facturar", éste último solo dentro de `if(venta.factura)`),
// que dependían de que la venta tuviera datos de AFIP cargados - una Cotización nunca
// los tiene, así que ese segundo bloque nunca corría para cierres por Cotización.
async function ActualizarEstadoRelacionado(connection, venta: Venta) {
    if (!venta.nroRelacionado || venta.nroRelacionado == 0) return;

    const resultado = ResolverEstadoRelacionado(venta.idProceso, venta.tipoRelacionado);
    if (!resultado) return;

    await connection.query(
        "UPDATE ventas SET estado = ? WHERE nroProceso = ? AND idProceso = ? ",
        [resultado.estado, venta.nroRelacionado, resultado.idProceso]
    );
}

class VentasRepository{

    //#region REPORTE
    async ObtenerReporteAcumulado(filtros:any){
        const connection = await db.getConnection();
        let filtro:string = "";

        if (filtros.fechas?.length === 2 && filtros.fechas[0] && filtros.fechas[1]) {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            filtro += ` AND v.fecha >= '${desde}' AND v.fecha < '${hasta}'`;
        }
        if(filtros.idProceso != 0){
            filtro += " AND v.idProceso = " + filtros.idProceso;
        }
        if(filtros.cliente != 0){
            filtro += " AND v.idCliente = " + filtros.cliente;
        }
        if(filtros.nroProceso && filtros.nroProceso != 0){
            filtro += " AND v.nroProceso = " + filtros.nroProceso;
        }

        try {
            //Obtengo la query segun los filtros
            let query = `
            SELECT
                CASE
                    WHEN mp.tipo = 'CREDITO'
                        THEN CONCAT(f.nombre, ' - Crédito')

                    WHEN mp.tipo = 'DEBITO'
                        THEN CONCAT(f.nombre, ' - Débito')

                    WHEN mp.tipo = 'TRANSFERENCIA'
                        THEN CONCAT(f.nombre, ' - Transferencia')

                    ELSE mp.nombre
                END AS metodo_pago,
                SUM(
                    CASE
                        -- NC resta (monto guardado positivo, se invierte aquí)
                        WHEN v.idProceso = 3 THEN -vp.monto
                        -- CC: monto real = total venta - lo pagado con otros métodos.
                        -- Por tipo, no por id fijo (12 solo es correcto para la empresa
                        -- 1; mp ya está joineado acá, así que no hace falta subquery
                        -- aparte para resolverlo). Antes esto no disparaba en el resto
                        -- de las empresas y el pago CC cola por el ELSE, mostrando el
                        -- monto nominal como si fuera plata real cobrada por ese método.
                        WHEN mp.tipo = 'CUENTA_CORRIENTE' THEN v.total - COALESCE(otros.total_otros, 0)
                        ELSE vp.monto
                    END
                ) AS total_acumulado

            FROM ventas v
            INNER JOIN ventas_pagos vp
                ON vp.idVenta = v.id
            INNER JOIN metodos_pago mp
                ON mp.id = vp.idMetodo
            LEFT JOIN fondos f
                ON f.id = mp.idFondo
            -- Subquery para calcular lo pagado con métodos distintos a CC (para deducir el monto CC real)
            LEFT JOIN (
                SELECT vpOtros.idVenta, SUM(vpOtros.monto) AS total_otros
                FROM ventas_pagos vpOtros
                JOIN metodos_pago mpOtros ON mpOtros.id = vpOtros.idMetodo
                WHERE mpOtros.tipo <> 'CUENTA_CORRIENTE'
                GROUP BY vpOtros.idVenta
            ) otros ON otros.idVenta = v.id
            WHERE v.fechaBaja IS NULL
                AND (
                    v.estado = 'Finalizada'
                    OR v.estado = 'Facturada'
                )
                -- 'Facturada' también es el estado final de una Nota de Empaque ya
                -- facturada (ver EstadoVenta en ventaEstados.ts): sin este filtro el
                -- reporte la contaba como si fuera una venta real, además de la
                -- Factura/Cotización que efectivamente la facturó.
                AND v.idProceso IN (${IdProceso.FACTURA}, ${IdProceso.COTIZACION}, ${IdProceso.NOTA_CREDITO}, ${IdProceso.NOTA_DEBITO})
            ${filtro}
            -- Se agrupa por el nombre calculado (metodo_pago), no por mp.id: cada
            -- empresa tiene su propia fila en metodos_pago para el mismo método
            -- (ej. "Cuenta Corriente" id=12 para SUCEDE SRL, id=99 para GABEL BRIAN
            -- OSCAR), y agrupar por id hacía que el reporte mostrara el mismo
            -- nombre repetido en varias filas en vez de un único total consolidado.
            GROUP BY metodo_pago
            ORDER BY total_acumulado DESC
        `;

            const [rows] = await connection.query<RowDataPacket[]>(query);
            return rows.map(r => ({ ...r }));

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerReporteVentas(filtros:any){
        const connection = await db.getConnection();
        let filtro:string = "";

        if (filtros.fechas?.length === 2 && filtros.fechas[0] && filtros.fechas[1]) {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            filtro += ` AND v.fecha >= '${desde}' AND v.fecha < '${hasta}'`;
        }
        if(filtros.idProceso != 0){
            filtro += " AND v.idProceso = " + filtros.idProceso;
        }
        if(filtros.cliente != 0){
            filtro += " AND v.idCliente = " + filtros.cliente;
        }
        if(filtros.nroProceso && filtros.nroProceso != 0){
            filtro += " AND v.nroProceso = " + filtros.nroProceso;
        }

        try {
            //Obtengo la query segun los filtros
            let query = `
            SELECT
                pv.descripcion AS proceso,
                v.idProceso,
                v.nroProceso,
                p.descripcion AS punto_venta,
                CONCAT(
                    DATE_FORMAT(v.fecha, '%d/%m/%Y'),
                    ' ',
                    IFNULL(v.hora, '')
                ) AS fecha_hora,
                c.nombre AS cliente,
                -- "Venta" se muestra en bruto (IVA incluido) para cerrar siempre contra
                -- "Cobrado". En el caso normal (sin lista propia), ventas_productos.total
                -- YA incluye IVA - no hace falta sumar nada. Pero para Mayorista con lista
                -- propia (idCategoria=2/MAYORISTA y v.idLista distinto de 1/
                -- CONSUMIDOR_FINAL), O para cualquier cliente con Lista 3 (v.idLista=2,
                -- sin importar idCategoria - excepción confirmada por el usuario ago-2026,
                -- ver esMayoristaConListaPropia() en venta.constants.ts, usada en
                -- addmod-ventas/listado-ventas/notas-venta/vista-previa/factura.service)
                -- el precio persistido es NETO y el IVA se agrega aparte al facturar, hay
                -- que sumarlo acá para mostrar el bruto real.
                -- OJO: replica los IDs 2/1 a mano porque no hay forma de reusar la función
                -- TS desde SQL - si esa regla vuelve a cambiar en el front, actualizar
                -- también acá (los 2 IF de abajo).
                --
                -- Excepción "sin productos" (NC X / ND X libres, nota-credito-x.component.ts
                -- y nota-debito-x.component.ts): no generan ninguna fila en ventas_productos
                -- ni ventas_servicios, todo el importe vive solo en v.total. Sin este
                -- fallback, "Venta" quedaba en $0,00 aunque "Cobrado" sí mostrara el
                -- importe real - se detecta por ausencia total de ítems (prendas Y
                -- servicios NULL), no por idTComprobante, porque la NC X sí permite cargar
                -- productos reales (ahí sí hay que mostrar el desglose normal). La ND X en
                -- cambio nunca tiene productos (decisión de diseño, ver nota-debito-x.component.ts),
                -- así que ahí el fallback aplica siempre que no haya ítems.
                -- TEMPORAL (jul-2026, sacar cuando el cliente deje de facturar así):
                -- idServicio 8/12/13/14 son "venta sin stock" cargada como servicio a
                -- pedido puntual del cliente, no servicios reales. Se reclasifican acá
                -- a la columna "Venta" solo para el reporte (servicios.total_servicios_venta
                -- más abajo) - no se toca ventas_servicios ni el catálogo de servicios.
                IF(v.idProceso = 3,
                    IF(prendas.total_prendas IS NULL AND servicios.total_servicios IS NULL,
                        v.total,
                        IFNULL(prendas.total_prendas, 0) + IFNULL(servicios.total_servicios_venta, 0) + IF((c.idCategoria = 2 AND v.idLista IS NOT NULL AND v.idLista <> 1) OR v.idLista = 2, IFNULL(vf.iva, 0), 0)
                    ) * -1,
                    IF(v.idProceso = 4 AND prendas.total_prendas IS NULL AND servicios.total_servicios IS NULL,
                        v.total,
                        IFNULL(prendas.total_prendas, 0) + IFNULL(servicios.total_servicios_venta, 0) + IF((c.idCategoria = 2 AND v.idLista IS NOT NULL AND v.idLista <> 1) OR v.idLista = 2, IFNULL(vf.iva, 0), 0)
                    )
                ) AS venta,
                -- "servicio" = total_servicios (todos) menos el subtotal ya reclasificado
                -- arriba (total_servicios_venta), para no duplicarlo.
                IF(v.idProceso = 3,
                    (IFNULL(servicios.total_servicios, 0) - IFNULL(servicios.total_servicios_venta, 0)) * -1,
                    (IFNULL(servicios.total_servicios, 0) - IFNULL(servicios.total_servicios_venta, 0))
                ) AS servicio,
                -- Suma el importeDescuento REAL persistido por ítem (productos + servicios),
                -- no un recálculo de venta.descuento% asumiendo que el descuento nunca toca
                -- Servicio. Ese supuesto es la política general (topeDescuento=0 para
                -- servicios en catálogo), pero no es una invariante dura: hay ventas
                -- puntuales donde el descuento sí se aplicó a un servicio al momento de
                -- facturar aunque su tope de catálogo HOY sea 0 (ver ventas #69 y #120,
                -- corregidas jul-2026 - "Correccion venta 69/120 servicio LOGO"). El
                -- recálculo naive por % general no reflejaba esos casos y "Venta + Servicio
                -- - Descuento + Ajuste" no cerraba contra "Cobrado". Sumar importeDescuento
                -- real es correcto siempre que el dato esté persistido (confirmado por
                -- auditoría jul-2026: sin casos pendientes fuera de #69/#120).
                IF(v.idProceso = 3,
                    IFNULL(prendas.descuento_prendas, 0) + IFNULL(servicios.descuento_servicios, 0),
                    (IFNULL(prendas.descuento_prendas, 0) + IFNULL(servicios.descuento_servicios, 0)) * -1
                ) AS des,
                -- Recargo del 10% por transferencia (ajusteTransf=1), aplicado sobre
                -- Venta neta de descuento + Servicio (el descuento nunca toca Servicio,
                -- mismo criterio que "des" arriba). Sin esta columna, "Venta + Servicio -
                -- Descuento" no cerraba contra "Cobrado" en ninguna venta con recargo por
                -- transferencia (pedido explícito del usuario, jul-2026).
                IF(v.ajusteTransf = 1,
                    IF(v.idProceso = 3,
                        ROUND((IFNULL(prendas.total_prendas, 0) * (1 - IFNULL(v.descuento, 0) / 100) + IFNULL(servicios.total_servicios, 0)) * 0.10, 2) * -1,
                        ROUND((IFNULL(prendas.total_prendas, 0) * (1 - IFNULL(v.descuento, 0) / 100) + IFNULL(servicios.total_servicios, 0)) * 0.10, 2)
                    ),
                    0
                ) AS ajuste,
                -- IVA discriminado según lo confirmado por AFIP en ventas_factura (mismo
                -- valor que usa factura.service.ts para imprimir "IVA Total" - no se
                -- recalcula acá para no reabrir la discusión neto/bruto por lista de
                -- precio, ya resuelta en ese servicio). NULL cuando no hay comprobante
                -- fiscal con IVA (Factura C, Sin Comprobante, etc.) -> 0.
                -- OJO: esta columna es informativa, no siempre aditiva. En Consumidor
                -- Final el precio de venta YA INCLUYE el IVA (se discrimina, no se suma),
                -- así que Venta+Servicio-Descuento+Ajuste ya cierra contra Cobrado SIN
                -- sumarle esta columna. Solo en mayorista con lista propia (precio neto)
                -- el IVA se agrega arriba y ahí sí es aditivo. Ver EsMayoristaConListaPropia()
                -- en addmod-ventas.component.ts.
                IF(v.idProceso = 3, IFNULL(vf.iva, 0) * -1, IFNULL(vf.iva, 0)) AS iva21,
                IF(v.idProceso = 3, v.total * -1, v.total) cobrado,
                -- % efectivo (Descuento$/Bruto$), no v.descuento (cabecera) directo: con
                -- descuento por ítem (ago-2026) la cabecera puede quedar en 0% mientras
                -- "des" (arriba) sí tiene plata real -> mostraba "0 %" al lado de un
                -- Descuento $ distinto de cero, contradictorio en la misma fila. Reusa las
                -- mismas subqueries que ya alimenta "des", sin JOINs nuevos. NULLIF evita
                -- división por cero en ventas sin ítems (NC/ND "X" libre) - el IFNULL de
                -- afuera resuelve ese caso a "0 %".
                CONCAT(
                    IFNULL(
                        ROUND(
                            (IFNULL(prendas.descuento_prendas, 0) + IFNULL(servicios.descuento_servicios, 0))
                            / NULLIF(IFNULL(prendas.total_prendas, 0) + IFNULL(servicios.total_servicios, 0), 0)
                            * 100,
                        2),
                    0),
                    ' %'
                ) AS descuento,
                com.descripcion AS comprobante,
                CONCAT(
                    LPAD(IFNULL(e.puntoVta, 0), 4, '0'),
                    '-',
                    LPAD(
                        IFNULL(
                            CASE
                                -- 99 = Sin Comprobante, 100 = NC "X", 101 = ND "X"
                                -- (nota-credito-x.component.ts / nota-debito-x.component.ts,
                                -- internas, no pasan por AFIP/ARCA) - ninguna genera fila
                                -- en ventas_factura, por eso vf.ticket es NULL y sin este caso
                                -- especial el N° de comprobante quedaba en 0.
                                WHEN v.idTComprobante IN (99, 100, 101) THEN v.nroProceso
                                ELSE vf.ticket
                            END,
                            0
                        ), 8, '0'
                    )
                ) AS nro_comprobante,
                pagos.metodos, pagos.montos,
                IF(v.idProceso = 3, prendas.cantidad_prendas * -1, prendas.cantidad_prendas) cantidad_prendas,
                -- Mismo criterio de signo que cantidad_prendas: la NC guarda la cantidad
                -- en positivo en ventas_servicios (ver InsertServicioVenta) y se niega aca,
                -- para que el neto del periodo sea "vendido - acreditado".
                IF(v.idProceso = 3, servicios.cantidad_servicios * -1, servicios.cantidad_servicios) cantidad_servicios,
                e.razonSocial AS facturante
            FROM ventas v

            LEFT JOIN procesos_venta pv 
                ON pv.id = v.idProceso

            LEFT JOIN clientes c 
                ON c.id = v.idCliente

            LEFT JOIN tipos_comprobantes com 
                ON com.id = v.idTComprobante

            LEFT JOIN puntos_venta p 
                ON p.id = v.idPunto

            LEFT JOIN empresas e 
                ON e.id = v.idEmpresa

            LEFT JOIN ventas_factura vf 
                ON vf.idVenta = v.id

            LEFT JOIN (
                SELECT 
                    vp.idVenta,

                    GROUP_CONCAT(
                        mp.nombre
                        ORDER BY mp.nombre
                        SEPARATOR ';'
                    ) AS metodos,

                    GROUP_CONCAT(
                        vp.monto
                        ORDER BY mp.nombre
                        SEPARATOR ';'
                    ) AS montos

                FROM ventas_pagos vp
                INNER JOIN metodos_pago mp 
                    ON mp.id = vp.idMetodo

                GROUP BY vp.idVenta
            ) pagos 
                ON pagos.idVenta = v.id

            LEFT JOIN (
                SELECT
                    idVenta,
                    -- cantidad_prendas cuenta SOLO items de catalogo: un item no catalogado
                    -- (tipoItem='PRESUPUESTO') no tiene talles ni stock y no es una prenda,
                    -- asi que sumarlo desvirtuaba el conteo. Los importes (total_prendas /
                    -- descuento_prendas) SI los incluyen: son plata facturada y tienen que
                    -- seguir cerrando contra "Cobrado".
                    SUM(CASE WHEN tipoItem = '${TipoItemVenta.CATALOGO}' THEN cantidad ELSE 0 END) AS cantidad_prendas,
                    SUM(total) AS total_prendas,
                    SUM(importeDescuento) AS descuento_prendas
                FROM ventas_productos
                GROUP BY idVenta
            ) prendas
                ON prendas.idVenta = v.id

            LEFT JOIN (
                SELECT
                    idVenta,
                    SUM(total) AS total_servicios,
                    SUM(importeDescuento) AS descuento_servicios,
                    -- Cantidad de unidades de servicio facturadas en la venta. A diferencia
                    -- de las columnas de importe, NO excluye los idServicio reclasificados
                    -- abajo (6/8/12/13/14, el parche de "venta sin stock"): decision
                    -- explicita del cliente (ago-2026). El motivo es que la hoja "Servicios"
                    -- del Excel desglosa por idServicio, asi que esas lineas quedan
                    -- visibles e identificables en vez de fundirse en un unico numero, y
                    -- el dia que se migre el parche a items no catalogados desaparecen
                    -- solas sin tener que tocar esta query.
                    SUM(cantidad) AS cantidad_servicios,
                    -- TEMPORAL (jul-2026): subtotal de los idServicio usados para
                    -- facturar "venta sin stock" - ver comentario en columna "venta".
                    SUM(CASE WHEN idServicio IN (6, 8, 12, 13, 14) THEN total ELSE 0 END) AS total_servicios_venta
                FROM ventas_servicios
                GROUP BY idVenta
            ) servicios
                ON servicios.idVenta = v.id

            WHERE
                v.fechaBaja IS NULL
                AND v.estado IN ('Finalizada', 'Facturada')
                -- Solo comprobantes reales: excluye Presupuesto/Pedido/Nota de Empaque
                -- aunque su estado final coincida en el string (ver comentario en
                -- ObtenerReporteAcumulado).
                AND v.idProceso IN (${IdProceso.FACTURA}, ${IdProceso.COTIZACION}, ${IdProceso.NOTA_CREDITO}, ${IdProceso.NOTA_DEBITO})
                ${filtro}
                ORDER BY v.fecha DESC, v.hora DESC;
            `

            const [rows] = await connection.query<RowDataPacket[]>(query);
            return rows.map(r => ({ ...r }));

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerReporteDetalles(filtros:any){
        const connection = await db.getConnection();
        let filtro:string = "";

        if (filtros.fechas?.length === 2 && filtros.fechas[0] && filtros.fechas[1]) {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            filtro += ` AND v.fecha >= '${desde}' AND v.fecha < '${hasta}'`;
        }
        if(filtros.idProceso != 0){
            filtro += " AND v.idProceso = " + filtros.idProceso;
        }
        if(filtros.cliente != 0){
            filtro += " AND v.idCliente = " + filtros.cliente;
        }
        if(filtros.nroProceso && filtros.nroProceso != 0){
            filtro += " AND v.nroProceso = " + filtros.nroProceso;
        }

        try {
            //Obtengo la query segun los filtros
            let query = `
            SELECT CONCAT(DATE_FORMAT(v.fecha, '%d/%m/%Y'),' ',IFNULL(v.hora, '')) AS fecha_hora, p.descripcion punto_venta, c.nombre cliente, e.razonSocial facturante,
                CONCAT(
                    LPAD(IFNULL(e.puntoVta, 0), 4, '0'),
                    '-',
                    LPAD(IFNULL(v.id,0), 8, '0')
                ) AS remito,
                CONCAT(
                    LPAD(IFNULL(e.puntoVta, 0), 4, '0'),
                    '-',
                    LPAD(
                        IFNULL(
                            CASE
                                -- 99 = Sin Comprobante, 100 = NC "X", 101 = ND "X" (nota-credito-x /
                                -- nota-debito-x.component.ts, internas, no pasan por AFIP/ARCA) -
                                -- mismo fix que en ObtenerReporteVentas/nro_comprobante.
                                WHEN v.idTComprobante IN (99, 100, 101) THEN v.nroProceso
                                ELSE vf.ticket
                            END,
                            0
                        ), 8, '0'
                    )
                ) AS comprobante,
                pv.descripcion AS proceso,
                tp.descripcion producto,
                sp.descripcion tipo,
                g.descripcion genero,
                prod.codigo,
                prod.nombre articulo,
                m.descripcion material,
                col.descripcion color,
                IF(v.idProceso = 3, t1 * -1, t1) XS,
                IF(v.idProceso = 3, t2 * -1, t2) S,
                IF(v.idProceso = 3, t3 * -1, t3) M,
                IF(v.idProceso = 3, t4 * -1, t4) L,
                IF(v.idProceso = 3, t5 * -1, t5) XL,
                IF(v.idProceso = 3, t6 * -1, t6) XXL,
                IF(v.idProceso = 3, t7 * -1, t7) '3XL',
                IF(v.idProceso = 3, t8 * -1, t8) '4XL',
                IF(v.idProceso = 3, t9 * -1, t9) '5XL',
                IF(v.idProceso = 3, t10 * -1, t10) '6XL',
                IF(v.idProceso = 3, vp.cantidad * -1, vp.cantidad) total
            FROM ventas v
                LEFT JOIN puntos_venta p ON p.id = v.idPunto
                LEFT JOIN clientes c ON c.id = v.idCliente
                LEFT JOIN empresas e ON e.id = v.idEmpresa
                LEFT JOIN ventas_factura vf ON vf.idVenta = v.id
                LEFT JOIN procesos_venta pv ON pv.id = v.idProceso
                LEFT JOIN ventas_productos vp ON vp.idVEnta = v.id
                -- El JOIN al catalogo va condicionado por tipoItem: sin eso, una linea no
                -- catalogada (idProducto apunta a productos_presupuesto) matcheaba el
                -- producto del catalogo que tuviera ese mismo id y el reporte mostraba
                -- articulo/color/material de un producto ajeno. Las dos tablas tienen
                -- numeracion independiente y ambas arrancan en 1.
                LEFT JOIN productos prod ON prod.id = vp.idProducto AND vp.tipoItem = '${TipoItemVenta.CATALOGO}'
                LEFT JOIN tipos_producto tp ON tp.id = prod.idTipo
                LEFT JOIN subtipos_producto sp ON sp.id = prod.idSubtipo
                LEFT JOIN materiales m ON m.id = prod.idMaterial
                LEFT JOIN generos g ON g.id = prod.idGenero
                LEFT JOIN colores col ON col.id = prod.idColor
            WHERE
                v.fechaBaja IS NULL
                AND v.estado IN ('Finalizada','Facturada')
                -- Solo comprobantes reales: excluye Presupuesto/Pedido/Nota de Empaque
                -- aunque su estado final coincida en el string (ver comentario en
                -- ObtenerReporteAcumulado).
                AND v.idProceso IN (${IdProceso.FACTURA}, ${IdProceso.COTIZACION}, ${IdProceso.NOTA_CREDITO}, ${IdProceso.NOTA_DEBITO})
                -- Excluye filas sin cantidad real de producto: ventas solo de
                -- servicios (LEFT JOIN sin fila en ventas_productos -> cantidad
                -- NULL, ej. Venta Julián Etulain) y líneas cargadas con cantidad=0
                -- a propósito (ej. ajuste de precio especial sin afectar stock,
                -- caso Graciela Bolzan). Ninguna de las dos afecta stock real, no
                -- deberían aparecer en un reporte pensado por cantidad de prendas.
                AND IFNULL(vp.cantidad, 0) <> 0
                -- Mismo criterio: los items no catalogados no tienen NINGUNA de las columnas
                -- de esta hoja (tipo, genero, material, color, talles) - solo aportarian una
                -- fila en blanco. Se excluyen del desglose por talle; su importe sigue
                -- contando en la hoja Ventas, que es donde corresponde.
                AND vp.tipoItem = '${TipoItemVenta.CATALOGO}'
                ${filtro}
            ORDER BY v.fecha DESC, v.hora DESC;
            `

            const [rows] = await connection.query<RowDataPacket[]>(query);
            return rows.map(r => ({ ...r }));

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    // Reporte agrupado POR SERVICIO (no por venta): responde "cuantas unidades netas de
    // cada servicio se facturaron en el periodo", que es la pregunta que la columna
    // cantidad_servicios de ObtenerReporteVentas no puede contestar (ahi el numero sale
    // agregado por venta, mezclando servicios de unidades distintas - "LOGO" cuenta
    // prendas bordadas, "Flete" cuenta 1 = una vez).
    // Neto = facturado menos acreditado: la NC (idProceso 3) guarda cantidad/total en
    // positivo y se niegan aca, mismo criterio que el resto de los reportes.
    async ObtenerReporteServicios(filtros:any){
        const connection = await db.getConnection();
        let filtro:string = "";

        if (filtros.fechas?.length === 2 && filtros.fechas[0] && filtros.fechas[1]) {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            filtro += ` AND v.fecha >= '${desde}' AND v.fecha < '${hasta}'`;
        }
        if(filtros.idProceso != 0){
            filtro += " AND v.idProceso = " + filtros.idProceso;
        }
        if(filtros.cliente != 0){
            filtro += " AND v.idCliente = " + filtros.cliente;
        }
        if(filtros.nroProceso && filtros.nroProceso != 0){
            filtro += " AND v.nroProceso = " + filtros.nroProceso;
        }

        try {
            //Obtengo la query segun los filtros
            let query = `
            SELECT
                vs.idServicio,
                IFNULL(s.codigo, '') AS codigo,
                -- LEFT JOIN + fallback a proposito: si un idServicio quedo huerfano
                -- (borrado del catalogo, ver EliminarServicio) la fila tiene que seguir
                -- apareciendo con su cantidad, no desaparecer en silencio del reporte.
                IFNULL(s.descripcion, CONCAT('(servicio eliminado #', vs.idServicio, ')')) AS descripcion,
                SUM(IF(v.idProceso = 3, vs.cantidad * -1, vs.cantidad)) AS cantidad_neta,
                SUM(IF(v.idProceso = 3, vs.total * -1, vs.total)) AS importe_neto
            FROM ventas v
                INNER JOIN ventas_servicios vs ON vs.idVenta = v.id
                LEFT JOIN servicios s ON s.id = vs.idServicio
            WHERE
                v.fechaBaja IS NULL
                AND v.estado IN ('Finalizada', 'Facturada')
                -- Mismo recorte que ObtenerReporteVentas/ObtenerReporteDetalles: solo
                -- comprobantes reales, excluye Presupuesto/Pedido/Nota de Empaque aunque
                -- su estado final coincida en el string (ver ObtenerReporteAcumulado).
                AND v.idProceso IN (${IdProceso.FACTURA}, ${IdProceso.COTIZACION}, ${IdProceso.NOTA_CREDITO}, ${IdProceso.NOTA_DEBITO})
                ${filtro}
            GROUP BY vs.idServicio, s.codigo, s.descripcion
            ORDER BY cantidad_neta DESC;
            `

            const [rows] = await connection.query<RowDataPacket[]>(query);
            return rows.map(r => ({ ...r }));

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();

        try {
            //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQuery(filtros,false);
            let queryTotal = await ObtenerQuery(filtros,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);
            const ventas:Venta[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    ventas.push(await this.CompletarObjeto(connection, row));
                  }
            }
            
            return {total:resultado[0][0].total, registros:ventas};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerVenta(idVenta, desdeCuenta:boolean = false){
        const connection = await db.getConnection();

        try {
            let queryRegistros = await ObtenerQuery({idVenta, desdeCuenta},false);

            const rows = await connection.query(queryRegistros);
            return await this.CompletarObjeto(connection, rows[0][0]);
        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

     async ObtenerVentasCliente(data:any){
        const connection = await db.getConnection();

        try {
            let queryRegistros = await ObtenerQuery(
                {
                    cliente: data.idCliente,
                    tipo: 'pre',
                    nroEditando: data.nroEditando,
                    soloAbiertas: true
                },
                false);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);

            const ventas:Venta[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    ventas.push(await this.CompletarObjeto(connection, row));
                  }
            }

            return ventas;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async CompletarObjeto(connection, row){
        let venta:Venta = new Venta();
        venta.id = row['id'];
        venta.idProceso = row['idProceso'];
        venta.idCaja = row['idCaja'];
        venta.proceso = row['proceso'];
        venta.nroProceso = row['nroProceso'];
        venta.idPunto = row['idPunto'];
        venta.punto = row['punto'];
        venta.fecha = moment(row['fecha']).toDate();
        venta.hora = row['hora'];
        venta.fechaEntrega = row['fechaEntrega'] ? moment(row['fechaEntrega']).toDate() : undefined;
        venta.idListaPrecio = row['idLista'];
        venta.idEmpresa = row['idEmpresa'];
        venta.empresa = row['empresa'];
        venta.idTipoComprobante = row['idTComprobante'];
        venta.tipoComprobante = row['tipoComprobante'];
        venta.idTipoDescuento = row['idTDescuento'];
        venta.tipoDescuento = row['tipoDescuento'];
        venta.descuento = parseFloat(row['descuento']);
        venta.codPromocion = row['codPromocion'];
        venta.redondeo = parseFloat(row['redondeo']);
        venta.total = parseFloat(row['total']);
        venta.nroRelacionado = parseFloat(row['nroRelacionado']);
        venta.tipoRelacionado = row['tipoRelacionado'];
        venta.estado = row['estado'];
        venta.observacion = row['observacion'];
        venta.impaga = row['impaga'];
        venta.entregado = parseFloat(row['entregado'] ?? 0);
        venta.deuda = parseFloat(row['deuda']) ?? 0;
        venta.ajuste = parseFloat(row['ajusteTransf']) ?? 0;

        venta.cliente = new Cliente();
        venta.cliente.id = row['idCliente'];
        venta.cliente.nombre = row['nombre'];
        venta.cliente.razonSocial = row['razonSocial'];
        venta.cliente.idCondicionIva = row['idCondIva'];
        venta.cliente.condicionIva = row['condicionIva'];
        venta.cliente.idTipoDocumento = row['idTipoDocumento'];
        venta.cliente.documento = row['documento'];
        venta.cliente.idCategoria = row['idCategoria'];

        venta.pagos = await ObtenerPagosVenta(connection, venta.id!);
        venta.servicios = await ObtenerServiciosVenta(connection, venta.id!);
        venta.productos = await ObtenerProductosVenta(connection, venta.id!, venta.idProceso!);
        venta.factura = await ObtenerFacturaVenta(connection, venta.id!);
        venta.notas = await ObtenerNotasVenta(connection, venta.nroProceso!);
        return venta;
    }

    async ObtenerProximoNroProceso(idProceso){
        const connection = await db.getConnection();

        try {
            return ObtenerProximoNroProceso(connection, idProceso);
        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async VerificarNroNotaEmpaque(nroNota){
        const connection = await db.getConnection();

        try {
            // Solo debe poder facturarse una Nota de Empaque ya validada (Aprobada):
            // en Pendiente todavía no pasó el control manual, y en Asociada/Facturada
            // ya fue usada por otro proceso o ya se facturó.
            const rows = await connection.query(
                `SELECT id FROM ventas WHERE idProceso = ${IdProceso.NOTA_EMPAQUE} AND nroProceso = ? AND estado = '${EstadoVenta.APROBADA}' ORDER BY id DESC LIMIT 1`,
                nroNota
            );
            if(rows[0][0] == undefined) return null;
            connection.release();

            return this.ObtenerVenta(rows[0][0].id);

        } catch (error) {
            connection.release();
            throw error; 
        }

    }
    //#endregion

    //#region ABM
    async Agregar(venta:Venta): Promise<string>{
        const connection = await db.getConnection();

        // Un Presupuesto facturado es una conversión FIEL: las líneas no se pueden tocar
        // (decisión de negocio, ago-2026). El front bloquea la grilla, pero ese bloqueo es
        // cosmético - cualquiera puede armar el POST a mano. Esta es la validación real.
        // Va ANTES de abrir la transacción, mismo patrón de retorno de string que usa
        // proveedoresRepository.Agregar para los errores de validación.
        const errorPresupuesto = await ValidarFacturacionDePresupuesto(connection, venta);
        if (errorPresupuesto) {
            connection.release();
            return errorPresupuesto;
        }

        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            // Obtenemos el proximo nro de venta a insertar. Va DESPUES de abrir la
            // transacción y a propósito adentro (no antes): el SELECT usa FOR UPDATE
            // para bloquear la última fila de este idProceso hasta el commit, así una
            // segunda venta del mismo tipo guardada en simultáneo espera a que esta
            // termine en vez de leer el mismo "último número" y calcular el mismo
            // nroProceso. Bug real: Pedidos duplicados con el mismo nroProceso
            // (condición de carrera, sin lock ni UNIQUE constraint) - ago-2026.
            venta.nroProceso = await ObtenerProximoNroProceso(connection, venta.idProceso);

            //Insertamos la venta
            const consulta = " INSERT INTO ventas(idCaja,idProceso,nroProceso,idPunto,fecha,hora,idCliente,idLista,idEmpresa,idTComprobante,idTDescuento,descuento,codPromocion,redondeo,total,nroRelacionado,tipoRelacionado,estado,impaga,ajusteTransf,observacion,fechaEntrega) " +
                             " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?) ";

            const parametros = [venta.idCaja,venta.idProceso, venta.nroProceso, venta.idPunto, moment(venta.fecha).format('YYYY-MM-DD'), moment().format('HH:mm'), venta.cliente?.id, venta.idListaPrecio, venta.idEmpresa, venta.idTipoComprobante, venta.idTipoDescuento, venta.descuento, venta.codPromocion, venta.redondeo, venta.total, venta.nroRelacionado, venta.tipoRelacionado, venta.estado, venta.impaga, venta.ajuste, venta.observacion ?? null, venta.fechaEntrega ? moment(venta.fechaEntrega).format('YYYY-MM-DD') : null];
            const [resultado] = await connection.query<ResultSetHeader>(consulta, parametros);
            venta.id =  resultado.insertId;

            //Actualizamos el estado del relacionado (Presupuesto/Pedido/Nota de Empaque)
            await ActualizarEstadoRelacionado(connection, venta);

            //insertamos los datos del pago de la venta
            const usuarioActivo = SesionServ.LeerSesion().usuario;
            let pagosProcesados = [...(venta.pagos || [])];

            if(venta.idProceso === IdProceso.NOTA_CREDITO)
            {
                await this.RegistrarMovimientoNotaCredito(connection, pagosProcesados, venta, usuarioActivo);
            }else{
                // El recibo, los pagos y el movimiento de fondo se generan cuando llegan
                // pagos reales (venta.pagos con longitud > 0), sin importar si la venta
                // tiene un comprobante fiscal (venta.factura) o es un Ticket X/Cotización
                // (idTComprobante = SIN_COMPROBANTE). ProcesarCobroVenta ya contempla el
                // caso sin factura (usa ptoVenta 9999 como fallback). Antes se exigía
                // venta.factura también, lo que hacía que toda venta cobrada sin factura
                // AFIP (Cotizaciones, Pedidos/Notas de Empaque cerrados con Ticket X)
                // perdiera silenciosamente el pago: no se guardaba ventas_pagos, no había
                // recibo ni movimiento de fondo. Si se guarda pendiente de facturar (sin
                // pagos todavía), los pagos quedan solo como intención del front y se
                // procesan recién en Modificar cuando lleguen los pagos reales.
                //
                // Restringido a procesos facturables: Factura(1)/Cotización(2)/Nota de
                // Débito(4). Presupuesto(5)/Pedido(6)/Nota de Empaque(7) no son ventas
                // confirmadas todavía: el front les arma igual una línea "Cuenta Corriente"
                // por el saldo pendiente cuando no tienen formulario de pago (ver
                // getSaldoPendiente/pagoCompleto en addmod-ventas), y sin este filtro esa
                // línea fantasma terminaría generando un cobro real sobre un documento que
                // todavía puede no convertirse nunca en venta.
                const esProcesoFacturable = [IdProceso.FACTURA, IdProceso.COTIZACION, IdProceso.NOTA_DEBITO].includes(venta.idProceso!);
                if (esProcesoFacturable && pagosProcesados.length > 0) {
                    await this.ProcesarCobroVenta(connection, venta, pagosProcesados, usuarioActivo);
                }
            }


            //insertamos los productos de la venta
            if(venta.productos){
                for (const element of venta.productos) {
                    element.idVenta = venta.id;
                    await InsertProductoVenta(connection, element);
                    const finalizandoCotizacion = venta.idProceso == IdProceso.COTIZACION && venta.estado == EstadoVenta.FINALIZADA;

                    // Signo del movimiento de stock atado a idProceso, no a un flag aparte:
                    // una Nota de Crédito SIEMPRE devuelve stock (venga del flujo clásico
                    // desde listado-ventas/notas-venta.component, o de una NC libre cargada
                    // directo). Antes esto dependía de un booleano "desdeNotas" pasado a mano
                    // por cada caller, señal redundante con idProceso que podía desincronizarse
                    // (una NC creada desde otro flujo sin pasar el flag no devolvía stock).
                    // Nota de Débito X (nota-debito-x.component.ts, idProceso=NOTA_DEBITO):
                    // decisión de diseño (jul-2026) - NUNCA descuenta stock, a diferencia
                    // de la NC X que sí puede devolver stock real. La ND X solo registra un
                    // cargo monetario (ej. "CARGO POR DEPÓSITO") y siempre viaja con
                    // productos=[], así que este loop no se ejecuta para ella - no hace
                    // falta una rama explícita acá. Si en el futuro aparece un caso real de
                    // ND con mercadería asociada, es una decisión de negocio aparte (evaluar
                    // ahí si conviene simetría total con NC, ej. resta de stock).
                    // Un ítem no catalogado (tipoItem = PRESUPUESTO) NUNCA mueve stock: su
                    // idProducto no existe en `productos`/`talles_producto`, y no tiene
                    // talles ni línea de talle. Sin este gate, ActualizarInventario llamaba
                    // a ObtenerLineaDeTalle(null) -> devuelve undefined -> TypeError al leer
                    // lineaTalle.talles -> rollback de toda la transacción. Como el CAE se
                    // pide a AFIP ANTES de guardar (ver comentario en Guardar(),
                    // addmod-ventas), eso dejaba un comprobante fiscal emitido y sin registro
                    // en el sistema. Confirmado por diagnóstico (ago-2026) que nunca llegó a
                    // pasar en producción sólo porque nadie facturó un presupuesto todavía.
                    if(element.tipoItem === TipoItemVenta.PRESUPUESTO) continue;

                    if(venta.idProceso === IdProceso.NOTA_CREDITO){
                        await ProductosRepo.ActualizarInventario(connection, element, "+");
                    }else{
                        if(venta.factura || finalizandoCotizacion)
                            await ProductosRepo.ActualizarInventario(connection, element, "-");
                    }
                }
            }
         
            //insertamos los servicios de la venta
            if(venta.servicios){
                for (const element of venta.servicios) {
                    element.idVenta = venta.id;
                    await InsertServicioVenta(connection, element);
                }
            }

            //insertamos los datos de la factura de la venta
            if(venta.factura){
                venta.factura.idVenta = venta.id;
                await InsertFacturaVenta(connection, venta.factura);
            }

            //Mandamos la transaccion
            await connection.commit();
            return venta.id.toString();

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }

    // Genera el recibo, los ventas_pagos y el movimiento de fondo de una venta ya facturada.
    // Solo debe invocarse cuando venta.factura está presente (ver Agregar/Modificar).
    async ProcesarCobroVenta(connection, venta, pagosProcesados, usuarioActivo) {
        // Resolver el tipo real de cada método por su fila en metodos_pago: NO asumir
        // por id numérico. metodos_pago está scopeado por empresa (cada empresa tiene su
        // propia fila para "Cuenta Corriente"/"Saldo a Favor", con ids distintos), así que
        // comparar contra un id fijo (12/13, válidos solo para la empresa 1) rompe la
        // detección para el resto de las empresas. Bug real: recibos indebidos en Venta
        // #87 (empresa 6) y #98 (empresa 5), corregido 07/2026.
        for (const pago of pagosProcesados) {
            const { tipo } = await GetMetodoPago(connection, pago.idMetodo);
            pago.tipo = tipo;
        }

        const totalPagado = pagosProcesados
                            .filter(p => p.tipo !== 'CUENTA_CORRIENTE')
                            .reduce((acc, p) => acc + (p.monto || 0), 0);

        const ptoVenta = venta.factura ? venta.factura.ptoVenta : 9999;

        let idRecibo;
        if(totalPagado > 0){
            idRecibo = await InsertRecibo(connection, {
                idCliente: venta.cliente?.id,
                ptoVenta,
                total: totalPagado
            });
        }

        for (const pago of pagosProcesados) {
            pago.idVenta = venta.id;
            pago.idRecibo = pago.tipo === 'CUENTA_CORRIENTE' ? null : idRecibo;
            // CC: sin recibo, pero se guarda el monto real para el reporte acumulado.
            // El movimiento de fondo se skipea en RegistrarMovimientosVenta.

            pago.idVentaPago = await InsertPagoVenta(connection, pago);
        }

        //Insertamos el movimiento en el saldo
        await this.RegistrarMovimientosVenta(connection, {
            ...venta,
            pagos: pagosProcesados
        }, usuarioActivo);

        return idRecibo;
    }

    async RegistrarMovimientosVenta(connection, venta, usuario) {
        const TIPOS_VALOR = ['CHEQUE', 'CREDITO'];

        // Obtener el fondo VA una sola vez si hay pagos que lo requieran
        const tieneValores = venta.pagos.some(p => TIPOS_VALOR.includes(p.tipo));
        const idFondoValores = tieneValores ? await GetIdFondoValoresAcreditar(connection) : null;

        for (const pago of venta.pagos) {

            const { idFondo: idFondoReal, tipo } = await GetMetodoPago(connection, pago.idMetodo);

            // CC no genera movimiento de fondo (la deuda se gestiona por cuenta corriente).
            // Comparación por tipo, no por id (ver comentario en ProcesarCobroVenta).
            if (tipo === 'CUENTA_CORRIENTE') continue;

            const esSaldoAFavor = tipo === 'SALDO_FAVOR';
            const esValorAcreditar = TIPOS_VALOR.includes(tipo);

            if (esValorAcreditar) {
                // El INGRESO cae en "Valores a Acreditar", no en el fondo real
                await InsertMovimientoFondo(connection, {
                    idCaja: venta.idCaja,
                    idFondo: idFondoValores,
                    tipo: 'INGRESO',
                    origen: 'VENTA',
                    idReferencia: venta.id,
                    monto: pago.monto,
                    descripcion: `Venta #${venta.id} - ${tipo} pendiente`,
                    usuario,
                    idEmpresa: venta.idEmpresa
                });

                // Registrar el valor en tránsito
                const idValor = await InsertValorAcreditar(connection, {
                    idEmpresa: venta.idEmpresa,
                    idVentaPago: pago.idVentaPago,
                    tipo: tipo === 'CREDITO' ? 'TARJETA_CREDITO' : 'CHEQUE',
                    monto: pago.monto,
                    // CRÉDITO: el fondo destino es el banco real del método
                    // CHEQUE: null, se elige al momento de acreditar
                    idFondoDestino: tipo === 'CREDITO' ? idFondoReal : null,
                    usuarioAlta: usuario
                });

                // Detalle extra solo para cheque
                if (tipo === 'CHEQUE' && pago.cheque) {
                    await InsertCheque(connection, idValor, pago.cheque);
                }

            } else {
                // Comportamiento original
                await InsertMovimientoFondo(connection, {
                    idCaja: venta.idCaja,
                    idFondo: idFondoReal,
                    tipo: esSaldoAFavor ? 'EGRESO' : 'INGRESO',
                    origen: 'VENTA',
                    idReferencia: venta.id,
                    monto: pago.monto,
                    descripcion: `Venta #${venta.id} - ${pago.metodo}`,
                    usuario,
                    idEmpresa: venta.idEmpresa
                });
            }
        }
    }

    // devuelveDinero: reservado para el día que se necesite soportar la devolución real
    // de plata al cliente (reintegro por caja/banco). Hoy no se usa: la política vigente
    // es que la NC NUNCA implica devolución real, el importe siempre queda como saldo a
    // favor del cliente para usar en una próxima venta. Si en el futuro hace falta, acá
    // habría que bifurcar y restaurar la lógica de EGRESO real / RECHAZADO de
    // valores_acreditar que existía antes de este cambio (ver historial de git).
    async RegistrarMovimientoNotaCredito(connection, pagosOriginales, notaCredito, usuario, devuelveDinero: boolean = false) {
        // NC libre (cargada directo, sin una venta de origen de la que prorratear
        // métodos de pago, ej. desde una pantalla de NC standalone): no hay nada
        // que prorratear, se registra una única línea por el total con el método
        // "Saldo a Favor" de la empresa (mismo criterio de resolución por tipo,
        // no por id fijo, que ya usa GetIdFondoCuentaCorriente en cuentasRepository -
        // metodos_pago está scopeado por empresa).
        if (!pagosOriginales || pagosOriginales.length === 0) {
            const idMetodoSaldoFavor = await GetIdMetodoSaldoAFavor(connection, notaCredito.idEmpresa);

            await InsertPagoVenta(connection, {
                idVenta: notaCredito.id,
                idMetodo: idMetodoSaldoFavor,
                idRecibo: null,
                monto: notaCredito.total
            });
        } else {
            const totalOriginal = pagosOriginales.reduce(
                (acc, p) => acc + Number(p.monto),
                0
            );

            let acumulado = 0;

            // Registramos el detalle proporcional por método de pago original, solo a
            // efectos informativos/reporte (no implica ningún movimiento real de fondo,
            // porque no se devuelve plata: el importe se acredita entero al cliente).
            for (let i = 0; i < pagosOriginales.length; i++) {
                const pago = pagosOriginales[i];

                const proporcion = Number(pago.monto) / totalOriginal;

                let montoMovimiento =
                    i === pagosOriginales.length - 1
                        ? notaCredito.total - acumulado
                        : Number(
                            (notaCredito.total * proporcion).toFixed(2)
                        );

                acumulado += montoMovimiento;

                // Registrar el pago proporcional en ventas_pagos para que aparezca
                // en el reporte acumulado (con monto positivo; la query lo negará por idProceso=3)
                await InsertPagoVenta(connection, {
                    idVenta: notaCredito.id,
                    idMetodo: pago.idMetodo,
                    idRecibo: null,
                    monto: montoMovimiento
                });
            }
        }

        // Notas de crédito: nunca generan recibo (mismo criterio que Modificar,
        // ver comentario ahí). La propia NC ya representa el saldo a favor por su
        // cuenta (idTComprobante IN (3,8,13,100) → aparece como línea "A FAVOR" en
        // el extracto y resta en ObtenerSaldoCliente vía el término de ventas).
        // Antes se creaba acá un recibo + pago SALDO_FAVOR "espejo" (mismo
        // mecanismo que usa EntregaDinero cuando no hay venta que cargue el
        // crédito) - pero para una NC sí hay una venta que ya lo carga, así que
        // ese recibo era puro ruido: duplicaba la línea en el extracto (sección
        // RECIBOS del UNION) y duplicaba el ingreso en el fondo virtual "Saldo a
        // Favor" (idFondo=5). Bug real: recibos #53/NC #132, corregido 07/2026.
        // Se mantiene el movimiento de fondo (sí es necesario: es la única forma
        // de que el fondo 5 refleje el saldo a favor generado por esta NC).
        await InsertMovimientoFondo(connection, {
            idCaja: notaCredito.idCaja,
            idFondo: 5,
            tipo: 'INGRESO',
            origen: 'NOTA_CREDITO',
            idReferencia: notaCredito.id,
            monto: notaCredito.total,
            descripcion: `Saldo a favor NC #${notaCredito.id}`,
            usuario,
            idEmpresa: notaCredito.idEmpresa
        });
    }

    // Dar de baja Presupuesto/Pedido/Nota de Empaque (decisión 19/07/2026). A
    // diferencia de DarBajaRecibo (cuentasRepository.ts), acá no hay ninguna
    // cascada que revertir: estos procesos nunca generan movimiento de fondo,
    // recibo, ni descuento de stock (eso solo pasa al facturarse/finalizar una
    // Cotización) - por eso alcanza con marcar fechaBaja. El cálculo de
    // "disponible" de Nota de Empaque (productosRepository.ObtenerStockDisponiblePorProducto)
    // ya filtra por fechaBaja IS NULL, así que un Pedido dado de baja deja de
    // reservar stock automáticamente, sin tocar nada más.
    async DarBajaVenta(idVenta: number, motivo: string): Promise<void> {
        const motivoLimpio = (motivo || '').trim();
        if (!motivoLimpio) {
            throw { status: 400, message: 'El motivo es obligatorio para dar de baja.' };
        }

        const connection = await db.getConnection();
        try {
            const [[venta]]: any = await connection.query(
                "SELECT idProceso, estado, fechaBaja FROM ventas WHERE id = ?",
                [idVenta]
            );

            if (!venta) throw { status: 404, message: 'La venta no existe.' };
            if (venta.fechaBaja) throw { status: 400, message: 'Ya fue dada de baja.' };

            if (![IdProceso.PRESUPUESTO, IdProceso.PEDIDO, IdProceso.NOTA_EMPAQUE].includes(venta.idProceso)) {
                throw { status: 400, message: 'Solo se puede dar de baja Presupuestos, Pedidos o Notas de Empaque.' };
            }
            if (!puedeDarseDeBaja(venta.idProceso, venta.estado)) {
                throw { status: 400, message: `No se puede dar de baja: el estado actual ("${venta.estado}") ya no es abierto (fue usado o cerrado por otro documento).` };
            }

            await connection.query(
                "UPDATE ventas SET fechaBaja = NOW(), observacion = ? WHERE id = ?",
                [motivoLimpio, idVenta]
            );
        } finally {
            connection.release();
        }
    }

    async Modificar(venta:Venta): Promise<string>{
        const connection = await db.getConnection();
        
        try {
        
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos la venta
            await UpdateVenta(connection,venta);

            //Actualizamos el estado del relacionado (Presupuesto/Pedido/Nota de Empaque)
            await ActualizarEstadoRelacionado(connection, venta);

            if(venta.idProceso === IdProceso.NOTA_CREDITO){
                // Notas de credito: nunca generan recibo, se mantiene el comportamiento original.
                await connection.query("DELETE FROM ventas_pagos WHERE idVenta = ?", [venta.id]);
                if(venta.pagos){
                    for (const element of venta.pagos) {
                        element.idVenta = venta.id;
                        await InsertPagoVenta(connection, element);
                    }
                }
            } else if ([IdProceso.FACTURA, IdProceso.COTIZACION, IdProceso.NOTA_DEBITO].includes(venta.idProceso!) && (venta.pagos || []).length > 0) {
                // El recibo/pago/movimiento de fondo se procesa cuando llegan pagos
                // reales, con o sin comprobante fiscal (ver mismo criterio en Agregar).
                // Restringido a procesos facturables (1,2,4): Presupuesto/Pedido/Nota de
                // Empaque no deben generar cobro real todavía (ver comentario en Agregar).
                // Si ya existe un recibo (la venta se cobró en un guardado anterior),
                // se reutiliza en vez de generar uno nuevo y no se vuelve a disparar el
                // movimiento de fondo (ya se registró en su momento).
                const [reciboPrevio]: any = await connection.query(
                    "SELECT idRecibo FROM ventas_pagos WHERE idVenta = ? AND idRecibo IS NOT NULL LIMIT 1",
                    [venta.id]
                );
                const idReciboExistente = reciboPrevio.length ? reciboPrevio[0].idRecibo : null;

                await connection.query("DELETE FROM ventas_pagos WHERE idVenta = ?", [venta.id]);

                const pagosProcesados = venta.pagos || [];
                if (pagosProcesados.length > 0) {
                    if (idReciboExistente) {
                        for (const pago of pagosProcesados) {
                            const { tipo } = await GetMetodoPago(connection, pago.idMetodo);
                            pago.tipo = tipo;
                            pago.idVenta = venta.id;
                            pago.idRecibo = tipo === 'CUENTA_CORRIENTE' ? null : idReciboExistente;
                            pago.idVentaPago = await InsertPagoVenta(connection, pago);
                        }

                        // La composición de métodos pudo cambiar (ej: parte pasó a Cuenta
                        // Corriente), así que el total del recibo hay que recalcularlo.
                        const totalPagado = pagosProcesados
                            .filter(p => p.tipo !== 'CUENTA_CORRIENTE')
                            .reduce((acc, p) => acc + (p.monto || 0), 0);
                        await connection.query(
                            "UPDATE recibos SET total = ? WHERE id = ?",
                            [totalPagado, idReciboExistente]
                        );
                    } else {
                        const usuarioActivo = SesionServ.LeerSesion().usuario;
                        await this.ProcesarCobroVenta(connection, venta, pagosProcesados, usuarioActivo);
                    }
                }
            }

            await connection.query("DELETE FROM ventas_productos WHERE idVenta = ?", [venta.id]);
            //insertamos los productos de la venta
            if(venta.productos){
                for (const element of venta.productos) {
                    element.idVenta = venta.id;
                    await InsertProductoVenta(connection, element);

                    // Mismo gate que en Agregar: un ítem no catalogado no mueve stock.
                    if(element.tipoItem === TipoItemVenta.PRESUPUESTO) continue;

                    if(venta.factura)
                        await ProductosRepo.ActualizarInventario(connection, element, "-")
                }
            }
         
            await connection.query("DELETE FROM ventas_servicios WHERE idVenta = ?", [venta.id]);
            //insertamos los servicios de la venta
            if(venta.servicios){
                for (const element of venta.servicios) {
                    element.idVenta = venta.id;
                    await InsertServicioVenta(connection, element);
                }
            }

            //insertamos los datos de la factura de la venta
            if(venta.factura){
                venta.factura.idVenta = venta.id;
                await InsertFacturaVenta(connection, venta.factura);
            }

            //Mandamos la transaccion
            await connection.commit();
            return "OK"

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }


    async GuardarFactura(data:any){
        const connection = await db.getConnection();
        
        try {
            data.factura.idVenta = data.idVenta;
            await InsertFacturaVenta(connection, data.factura);
            return("OK");

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Aprobar(data:any){
        const connection = await db.getConnection();
        
        try {
            // Solo se aprueba una Nota de Empaque que todavía está Pendiente: evita
            // reaprobar una que ya fue asociada/facturada por error desde el listado.
            await connection.query(
                `UPDATE ventas SET estado = '${EstadoVenta.APROBADA}' WHERE id = ? AND idProceso = ${IdProceso.NOTA_EMPAQUE} AND estado = '${EstadoVenta.PENDIENTE}'`,
                [data.idVenta]
            );
            return("OK");

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region OTROS
    async ObtenerQRFactura(idVenta:number){
        const connection = await db.getConnection();

        try {
            const consulta = " SELECT vf.cae, vf.ticket, vf.tipoFactura, vf.neto, vf.iva, vf.dni, vf.tipodni, vf.ptoVenta, v.fecha, v.idEmpresa " +
                             " FROM ventas_factura vf " +
                             " INNER JOIN ventas v on v.id = vf.idVenta " +
                             " WHERE vf.idVenta = ? "

            const [resultado] = await connection.query(consulta, idVenta);
            const row = resultado[0];

            // Ventas sin comprobante fiscal (Sin Comprobante=99, NC X=100, ND X=101) nunca
            // tienen fila en ventas_factura - el frontend ya evita llamar a este endpoint
            // para esos casos (factura.service.ts), pero se deja este chequeo defensivo acá
            // para cualquier otro caller: sin él, row queda undefined y explota con un
            // TypeError críptico al leer row['fecha'] más abajo, envuelto por
            // facturacionService.ObtenerQRFactura en el mensaje genérico "No se pudo generar
            // el QR de la factura." (bug real jul-2026, visto al ver el comprobante de una ND X).
            if (!row) {
                throw { status: 400, message: 'Esta venta no tiene comprobante fiscal (no genera código QR).' };
            }

            const objQR = new ObjQR({
                ver: 1,
                fecha : moment(row['fecha']).format('YYYY-MM-DD'),
                ptoVta : row['ptoVenta'],
                tipoCmp : row['tipoFactura'],
                nroCmp : row['ticket'],
                importe : parseFloat(row['neto']) + parseFloat(row['iva']), 
                moneda : "PES",
                ctz : 1,
                tipoDocRec : row['tipodni'],
                nroDocRec : row['dni'],
                tipoCodAut : "E",
                codAut : row['cae'],
                idEmpresa : row['idEmpresa']
            })

            return objQR;
            
        } catch (error) {
            throw error;
        }finally{
            connection.release();
        }
    }
    //#endregion
}

async function ObtenerQuery(filtros:any,esTotal:boolean):Promise<string>{
    try {
        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";
        let condicional:string = "";
        let adicional:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.cliente && filtros.cliente != 0){

            if(filtros.soloAbiertas){
                // Excluye todo lo que ya fue usado/cerrado: Asociado/a (en uso por otro
                // proceso, todavía sin comprobante), Facturado/a (circuito cerrado con
                // comprobante - incluye al Presupuesto facturado directo desde ago-2026,
                // ver RELACION_CIERRE en ventaEstados.ts), Finalizado/a y Relacionado
                // (Presupuesto usado para armar un Pedido/Nota, ver EstadoVenta.RELACIONADO).
                filtro += " AND (estado <> 'Asociado' AND estado <> 'Asociada' AND estado <> 'Facturado' AND estado <> 'Facturada' AND estado <> 'Finalizado' AND estado <> 'Finalizada' AND estado <> 'Relacionado')";
                // Una Nota de Empaque no debe poder elegirse para relacionar/facturar
                // hasta que fue validada (Aprobada): mientras está Pendiente no aparece.
                filtro += ` AND NOT (v.idProceso = ${IdProceso.NOTA_EMPAQUE} AND estado = '${EstadoVenta.PENDIENTE}')`;
            }

            filtro += "AND v.idCliente = " + filtros.cliente;
        }
             
        if(filtros.nroEditando && filtros.nroEditando != 0)
            filtro += " AND v.id <> " + filtros.nroEditando;

        if (filtros.idVenta && filtros.idVenta != 0)
            filtro += " AND v.id = " + filtros.idVenta;

        if (filtros.tipo){
            if (filtros.tipo == 'factura')
                filtro += " AND v.idProceso IN (1,2,3,4) ";
            if (filtros.tipo == 'pre')
                filtro += " AND v.idProceso IN (5,6,7) ";
        }

        if(filtros.idProceso && filtros.idProceso != 0){
            filtro += " AND v.idProceso = " + filtros.idProceso;
        }
        if(filtros.nroProceso && filtros.nroProceso != 0){
            filtro += " AND v.nroProceso = " + filtros.nroProceso;
        }

        if (filtros.fechas?.length === 2 && filtros.fechas[0] && filtros.fechas[1]) {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            filtro += ` AND v.fecha >= '${desde}' AND v.fecha < '${hasta}'`;
        }

        // Filtro por fecha de entrega prometida (solo aplica a Presupuesto/Pedido/
        // Nota de Empaque - en el resto de los procesos la columna queda NULL, por lo
        // que este filtro simplemente no matchea nada ahí).
        if (filtros.fechasEntrega?.length === 2 && filtros.fechasEntrega[0] && filtros.fechasEntrega[1]) {
            const desdeEntrega = moment.utc(filtros.fechasEntrega[0]).format('YYYY-MM-DD');
            const hastaEntrega = moment.utc(filtros.fechasEntrega[1]).add(1, 'day').format('YYYY-MM-DD');

            filtro += ` AND v.fechaEntrega >= '${desdeEntrega}' AND v.fechaEntrega < '${hastaEntrega}'`;
        }

        if(filtros.idCliente && filtros.idCliente != 0){
            filtro += " AND v.idCliente = " + filtros.idCliente;
        }

        if(filtros.impagas == 1){
            filtro += " AND v.impaga = " + filtros.impagas;
        }
        if(filtros.desdeCuenta && filtros.desdeCuenta == true){
            condicional += " ,p.entregado ,SUM(v.total - IFNULL(p.entregado, 0)) AS deuda "
            // Por tipo, no por id: (9, 12) son ids fijos de "Saldo a favor"/"Cuenta
            // Corriente" válidos solo para la empresa 1 - en el resto de las empresas
            // el pago CC no quedaba excluido acá y "deuda" daba de menos. Mismo bug
            // que en cuentasRepository.ts (ObtenerQueryVentasCliente), corregido 07/2026.
            adicional += " LEFT JOIN (" +
                        " SELECT vp.idVenta, SUM(vp.monto) AS entregado" +
                        " FROM ventas_pagos vp" +
                        " JOIN metodos_pago mp ON mp.id = vp.idMetodo" +
                        " WHERE mp.tipo NOT IN ('SALDO_FAVOR', 'CUENTA_CORRIENTE') " +
                        " GROUP BY vp.idVenta " +
                        " ) p ON p.idVenta = v.id ";
        }
        // #endregion
        if (esTotal)
        {//Si esTotal agregamos para obtener un total de la consulta
            count = "SELECT COUNT(*) AS total FROM ( ";
            endCount = " ) as subquery";
        }
        else
        {//De lo contrario paginamos
            if (filtros.tamanioPagina != null)
                paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
        }

        //Arma la Query con el paginado y los filtros correspondientes
        query = count +
                " SELECT v.*, c.nombre, c.razonSocial, c.idCondIva, c.idTipoDocumento, c.documento, c.idCategoria, ci.descripcion AS condicionIva, pv.descripcion AS proceso, e.razonSocial AS empresa, tc.descripcion AS tipoComprobante, td.descripcion AS tipoDescuento " +
                condicional + 
                " FROM ventas v " + 
                " LEFT JOIN clientes c ON c.id = v.idCliente " +
                " LEFT JOIN procesos_venta pv ON pv.id = v.idProceso " +
                " LEFT JOIN empresas e ON e.id = v.idEmpresa " +
                " LEFT JOIN tipos_comprobantes tc ON tc.id = v.idTComprobante " +
                " LEFT JOIN tipos_descuento td ON td.id = v.idTDescuento " +
                " LEFT JOIN condiciones_iva ci ON ci.id = c.idCondIva " +
                adicional +
                " WHERE v.fechaBaja IS NULL " +
                filtro +
                " GROUP BY v.id " +
                ((filtros.desdeCuenta && filtros.desdeCuenta == true) ? ', p.entregado' : '') +
                " ORDER BY v.fecha DESC, v.hora DESC, v.id DESC " +
                paginado +
                endCount;
        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ObtenerPagosVenta(connection, idVenta:number){
    try {
        const consulta = `
            SELECT
                vp.*,
                mp.tipo AS tipo_metodo,
                CASE
                    WHEN mp.tipo = 'CREDITO'
                        THEN CONCAT(f.nombre, ' - Crédito')

                    WHEN mp.tipo = 'DEBITO'
                        THEN CONCAT(f.nombre, ' - Débito')

                    WHEN mp.tipo = 'TRANSFERENCIA'
                        THEN CONCAT(f.nombre, ' - Transferencia')

                    ELSE mp.nombre
                END AS metodo_pago
            FROM ventas_pagos vp
            LEFT JOIN metodos_pago mp ON mp.id = vp.idMetodo
            LEFT JOIN fondos f        ON f.id  = mp.idFondo
            WHERE vp.idVenta = ?
        `;

        const [rows] = await connection.query(consulta, [idVenta]);
        const pagos:PagosVenta[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                let pago:PagosVenta = new PagosVenta();
                pago.id = row['id'];
                pago.idVenta = row['idVenta'];
                pago.idMetodo = row['idMetodo'];
                pago.metodo = row['metodo_pago'];
                // Por tipo, no por id fijo (idMetodo es específico de cada empresa) -
                // lo usa el frontend para excluir Cuenta Corriente del "entregado" en
                // la pantalla de pago de venta (ver entrega-dinero.component.ts).
                pago.tipo = row['tipo_metodo'];
                pago.monto = parseFloat(row['monto']);
                pagos.push(pago);
              }
        }

        return pagos;

    } catch (error) {
        throw error; 
    }
}

async function ObtenerServiciosVenta(connection, idVenta:number){
    try {
        // topeDescuento sale del catálogo `servicios`, NO de la línea: `ventas_servicios`
        // nunca lo persistió (por eso existe `importeDescuento`, ver migración
        // 20260707120000). Sin traerlo acá, al facturar un Presupuesto/Pedido los
        // servicios llegaban al front con topeDescuento undefined y el cálculo caía al
        // `?? 100` (descuento pleno), aplicando el descuento general a servicios con tope
        // 0. Bug real reportado ago-2026: presupuesto de $300.000 en productos + $12.500
        // en servicios con 10% -> descontaba $31.250 en vez de $30.000.
        const consulta = "SELECT vs.*, s.descripcion, s.codigo, s.topeDescuento FROM ventas_servicios vs " +
                         "LEFT JOIN servicios s ON s.id = vs.idServicio " +
                         "WHERE vs.idVenta = ? "

        const [rows] = await connection.query(consulta, [idVenta]);

        const servicios:ServiciosVenta[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let servicio:ServiciosVenta = new ServiciosVenta();
                servicio.idVenta = row['idVenta'];
                servicio.idServicio = row['idServicio'];
                servicio.codServicio = row['codigo'];
                servicio.nomServicio = row['descripcion'];
                servicio.cantidad = parseInt(row['cantidad']);
                servicio.unitario = parseFloat(row['precio']);
                servicio.total = parseFloat(row['total']);
                // Tope vigente HOY en el catálogo, no el que tenía al momento de la venta
                // original (ese dato no se persiste). Es lo correcto para este uso: el
                // consumidor es el flujo de facturar un Presupuesto/Pedido, donde el
                // descuento se aplica AHORA. Para reconstruir una venta ya cerrada hay que
                // seguir usando el importeDescuento persistido, no recalcular con esto.
                servicio.topeDescuento = row['topeDescuento'] != null ? parseFloat(row['topeDescuento']) : undefined;
                servicio.importeDescuento = row['importeDescuento'] != null ? parseFloat(row['importeDescuento']) : undefined;
                servicios.push(servicio);
              }
        }

        return servicios;

    } catch (error) {
        throw error; 
    }
}

// Resuelve las líneas de una venta sin mirar `idProceso`: cada fila declara su propio
// origen en `tipoItem` (ver TipoItemVenta / migración 20260801120000). Antes esto
// brancheaba por `idProceso == 5`, heurística que se rompía al facturar un Presupuesto:
// la venta pasaba a idProceso 1/2 pero las líneas seguían apuntando a
// productos_presupuesto, así que el INNER JOIN contra `productos` hacía desaparecer la
// línea o - peor - matcheaba otro producto con el mismo id y lo imprimía en el
// comprobante (las dos tablas tienen numeración independiente y ambas arrancan en 1).
//
// LEFT JOIN a las dos tablas en una sola query: si una línea quedara huérfana (ítem
// borrado del catálogo) la fila igual se devuelve, con `descripcion` -el snapshot
// guardado al facturar- como fallback del nombre. El INNER JOIN anterior la hacía
// desaparecer en silencio, que en un comprobante es peor que mostrarla incompleta.
async function ObtenerProductosVenta(connection, idVenta:number, idProceso:number){
    try {
        const consulta =
            "SELECT vp.*, " +
            "       COALESCE(cat.codigo, pre.codigo)   AS codigo, " +
            "       COALESCE(cat.nombre, pre.nombre, vp.descripcion) AS nombre, " +
            // Mismo motivo que en ObtenerServiciosVenta: el tope vive en el catálogo, no
            // en la línea. Sin esto, al facturar un Pedido/Nota de Empaque los productos
            // perdían su tope y recibían el descuento general completo.
            // Para tipoItem='PRESUPUESTO' queda NULL (no hay fila en `productos` ni columna
            // equivalente en `productos_presupuesto`) -> el front cae al `?? 100`, que es
            // el comportamiento decidido para esos ítems.
            "       cat.topeDescuento, " +
            "       col.id AS idColor, col.descripcion AS color, col.hexa " +
            "FROM ventas_productos vp " +
            "LEFT JOIN productos cat " +
            "       ON cat.id = vp.idProducto AND vp.tipoItem = ? " +
            "LEFT JOIN productos_presupuesto pre " +
            "       ON pre.id = vp.idProducto AND vp.tipoItem = ? " +
            "LEFT JOIN colores col ON col.id = cat.idColor " +
            "WHERE vp.idVenta = ? ";

        const [rows] = await connection.query(consulta, [TipoItemVenta.CATALOGO, TipoItemVenta.PRESUPUESTO, idVenta]);
        const productos:ProductosVenta[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let producto:ProductosVenta = new ProductosVenta();
                producto.idVenta = row['idVenta'];
                producto.idProducto = row['idProducto'];
                // Default defensivo a CATALOGO: filas anteriores a la migración no tienen
                // el campo, y ese era su comportamiento efectivo.
                producto.tipoItem = row['tipoItem'] ?? TipoItemVenta.CATALOGO;
                producto.descripcion = row['descripcion'] ?? undefined;
                producto.codProducto = row['codigo'];
                producto.nomProducto = row['nombre'];
                producto.cantidad = row['cantidad'];
                producto.idLineaTalle = row['idLineaTalle'];
                producto.t1 = parseInt(row['t1']);
                producto.t2 = parseInt(row['t2']);
                producto.t3 = parseInt(row['t3']);
                producto.t4 = parseInt(row['t4']);
                producto.t5 = parseInt(row['t5']);
                producto.t6 = parseInt(row['t6']);
                producto.t7 = parseInt(row['t7']);
                producto.t8 = parseInt(row['t8']);
                producto.t9 = parseInt(row['t9']);
                producto.t10 = parseInt(row['t10']);
                // precio = ancla de precio de lista para recálculos posteriores (ver
                // calcularPrecioCliente en el front). Se reconstruye desde precioLista si la
                // venta ya la tiene guardada; si es una venta vieja sin precioLista (columna
                // agregada después), se cae al precio final como aproximación, igual que antes.
                producto.precio = row['precioLista'] != null ? parseFloat(row['precioLista']) : parseFloat(row['precio']);
                producto.precioLista = row['precioLista'] != null ? parseFloat(row['precioLista']) : undefined;
                producto.unitario = parseFloat(row['precio']);
                producto.total = parseFloat(row['total']);
                producto.topeDescuento = row['topeDescuento'] != null ? parseFloat(row['topeDescuento']) : undefined;
                producto.importeDescuento = row['importeDescuento'] != null ? parseFloat(row['importeDescuento']) : undefined;
                producto.tallesSeleccionados = row['talles'];
                producto.color = row['color'];
                producto.hexa = row['hexa'];
                // Solo el catálogo real tiene talles. Para un ítem de presupuesto este id
                // no existe en `talles_producto`, y consultarlo devolvía los talles de OTRO
                // producto (el que tuviera ese mismo id en el catálogo).
                producto.talles = producto.tipoItem === TipoItemVenta.CATALOGO
                    ? await ProductosRepo.ObtenerTallesProducto(producto.idProducto!)
                    : [];

                productos.push(producto);
              }
        }

        return productos;

    } catch (error) {
        throw error; 
    }
}

async function ObtenerFacturaVenta(connection, idVenta:number){
    try {
        const consulta = " SELECT vf.*, tc.cod_arca desComprobante FROM ventas_factura vf " + 
                         " INNER JOIN tipos_comprobantes tc ON tc.id = vf.tipoFactura " +
                         " WHERE idVenta = ? "

        const [rows] = await connection.query(consulta, [idVenta]);
        if(rows.length==0) return undefined;

        const row = rows[0];
        const factura:FacturaVenta = new FacturaVenta(
            {
                cae: row['cae'], 
                caeVto: row['caeVto'], 
                ticket: row['ticket'], 
                tipoComprobante: row['tipoFactura'], 
                neto: parseFloat(row['neto']), 
                iva: parseFloat(row['iva']), 
                dni: row['dni'],
                tipoDni: row['tipoDni'],
                ptoVenta: row['ptoVenta'],
                condReceptor: row['condReceptor'],
                desComprobante: row['desComprobante'],
                comprobanteAsociado: {
                    tipo: row['tipoRelacionado'],
                    numero: row['ticketRelacionado'],
                    puntoVenta: row['ptoVentaRelacionado'],
                },
            }
        );

        return factura;

    } catch (error) {
        throw error; 
    }
}

async function ObtenerNotasVenta(connection, nroProceso:number){
    try {
        const consulta = " SELECT id, nroProceso, total, idTComprobante FROM ventas " +
                         " WHERE nroRelacionado = ? AND idProceso = 3 "

        const [rows] = await connection.query(consulta, [nroProceso]);
        const notas:NotaCreditoVenta[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                const nota:NotaCreditoVenta = new NotaCreditoVenta();
                nota.idNotaVenta = row['id'];
                nota.nroProceso = row['nroProceso'];
                nota.total = row['total'];
                nota.idTipoComprobante = row['idTComprobante'];

                notas.push(nota);
              }
        }

        return notas;

    } catch (error) {
        throw error; 
    }
}

//#region INSERT
async function ObtenerProximoNroProceso(connection, idProceso):Promise<number>{
    try {
        // FOR UPDATE: si esta lectura corre dentro de una transacción (caso real,
        // ver Agregar()), bloquea esta fila hasta el commit/rollback - evita que dos
        // ventas del mismo idProceso guardadas en simultáneo calculen el mismo
        // "próximo número". Fuera de una transacción (ver wrapper de clase, usado
        // para preview) no cambia nada: el lock se toma y libera en el acto.
        const rows = await connection.query(" SELECT nroProceso FROM ventas WHERE idProceso = ? ORDER BY id DESC LIMIT 1 FOR UPDATE ", idProceso);
        let resultado:number = 0;

        if([rows][0][0].length==0){
            resultado = 1;
        }else{
            resultado = rows[0][0].nroProceso + 1;
        }
        return resultado;

    } catch (error) {
        throw error; 
    }
}

async function UpdateVenta(connection, venta):Promise<void>{
    try {
        const consulta = "UPDATE ventas SET " +
                         " idProceso = ?, " +
                         " idPunto = ?, " +
                         " fecha = ?, " +
                         " hora = ?, " +
                         " idCliente = ?, " +
                         " idLista = ?, " +
                         " idEmpresa = ?, " +
                         " idTComprobante = ?, " +
                         " idTDescuento = ?, " +
                         " descuento = ?, " +
                         " codPromocion = ?, " +
                         " redondeo = ?, " +
                         " total = ?, " +
                         " nroRelacionado = ?, " +
                         " tipoRelacionado = ?, " +
                         " estado = ?, " +
                         " impaga = ?, " +
                         " ajusteTransf = ?, " +
                         " observacion = ?, " +
                         " fechaEntrega = ? " +
                         " WHERE id = ? ";

        const parametros = [venta.idProceso, venta.idPunto, moment(venta.fecha).format('YYYY-MM-DD'), moment().format('HH:mm'), venta.cliente.id, venta.idListaPrecio, venta.idEmpresa, venta.idTipoComprobante, venta.idTipoDescuento, venta.descuento, venta.codPromocion, venta.redondeo, venta.total, venta.nroRelacionado, venta.tipoRelacionado, venta.estado, venta.impaga, venta.ajuste, venta.observacion ?? null, venta.fechaEntrega ? moment(venta.fechaEntrega).format('YYYY-MM-DD') : null, venta.id];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

// Exportadas para reutilizar la misma lógica de "Valores a Acreditar" desde
// cuentasRepository.ts (Entrega de Dinero de cuenta corriente) - antes esa
// pantalla tenía su propia copia de GetFondoByMetodoPago que no conocía el
// concepto de Cheque/Crédito y mandaba la plata directo a un fondo real.
export async function GetMetodoPago(connection, idMetodoPago): Promise<{ idFondo: number; tipo: string }> {
    const [rows] = await connection.query(
        'SELECT idFondo, tipo FROM metodos_pago WHERE id = ?',
        [idMetodoPago]
    );
    return { idFondo: rows[0].idFondo, tipo: rows[0].tipo };
}

// Resuelve el método de pago "Saldo a Favor" de una empresa por tipo (no por id
// fijo): metodos_pago está scopeado por empresa, cada una tiene su propia fila
// con un id distinto (mismo criterio ya usado para CUENTA_CORRIENTE en
// cuentasRepository.ts). Se usa solo para la línea informativa de ventas_pagos
// de una NC libre (sin pagos originales de los que prorratear).
export async function GetIdMetodoSaldoAFavor(connection, idEmpresa: number): Promise<number> {
    const [rows] = await connection.query(
        "SELECT id FROM metodos_pago WHERE idEmpresa = ? AND tipo = 'SALDO_FAVOR' LIMIT 1",
        [idEmpresa]
    );
    if (!rows.length) throw new Error(`Método 'Saldo a Favor' no encontrado para la empresa ${idEmpresa}.`);
    return rows[0].id;
}

export async function GetIdFondoValoresAcreditar(connection): Promise<number> {
    const [rows] = await connection.query(
        "SELECT id FROM fondos WHERE nombre = 'Valores a Acreditar' LIMIT 1"
    );
    if (!rows.length) throw new Error("Fondo 'Valores a Acreditar' no encontrado.");
    return rows[0].id;
}

export async function InsertValorAcreditar(connection, valor): Promise<number> {
    const consulta = `
        INSERT INTO valores_acreditar
            (idEmpresa, idVentaPago, tipo, monto, idFondoDestino, estado, usuarioAlta)
        VALUES (?, ?, ?, ?, ?, 'PENDIENTE', ?)
    `;
    const [result] = await connection.query(consulta, [
        valor.idEmpresa,
        valor.idVentaPago,
        valor.tipo,
        valor.monto,
        valor.idFondoDestino ?? null,
        valor.usuarioAlta ?? null
    ]);
    return result.insertId;
}

export async function InsertCheque(connection, idValor: number, cheque): Promise<void> {
    const consulta = `
        INSERT INTO cheques (idValor, numero, banco, importe, fechaCobro, libradorNombre, libradorCuit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await connection.query(consulta, [
        idValor,
        cheque.numero,
        cheque.banco,
        cheque.importe,
        moment(cheque.fechaCobro).format('YYYY-MM-DD'),
        cheque.libradorNombre ?? null,
        cheque.libradorCuit ?? null
    ]);
}

// Fondo virtual donde se registra el INGRESO de una retención sufrida (Ganancias/
// IIBB/SUSS): no es plata real, es un crédito fiscal futuro contra AFIP/ARBA/SUSS.
// Ver 20260705120000_create_retenciones.js. Lookup por `tipo` (no por `nombre`,
// más robusto - mismo criterio que GetFondoVirtual en comprasCuentasRepository.ts).
export async function GetIdFondoRetenciones(connection): Promise<number> {
    const [rows] = await connection.query(
        "SELECT id FROM fondos WHERE tipo = 'RETENCIONES_SUFRIDAS' AND activo = 1"
    );
    if (!rows.length) throw new Error("Fondo 'Retenciones Sufridas' no encontrado.");
    return rows[0].id;
}

// Registro minimalista (tipo + importe) de la retención, anclado a un ventas_pagos
// igual que valores_acreditar.idVentaPago: si la operación reparte el monto en
// varios ventas_pagos (ver EntregaDinero en cuentasRepository.ts), se inserta UN
// solo row por el monto total retenido, no uno por fragmento.
export async function InsertRetencion(
    connection,
    idVentaPago: number,
    retencion: { tipo: string; importe: number },
    usuarioAlta?: string
): Promise<void> {
    const consulta = `
        INSERT INTO retenciones (idVentaPago, tipo, importe, usuarioAlta)
        VALUES (?, ?, ?, ?)
    `;
    await connection.query(consulta, [
        idVentaPago,
        retencion.tipo,
        retencion.importe,
        usuarioAlta ?? null
    ]);
}

async function InsertMovimientoFondo(connection, movimiento): Promise<void> {
    try {
        // idEmpresa se agrega acá (jul-2026): antes esta query no lo insertaba, así
        // que cualquier caller que pasara idEmpresa (venta.idEmpresa) lo perdía en
        // silencio - por eso ninguna venta quedaba con empresa asignada en
        // movimientos_fondos, aunque el dato estaba disponible en `venta`.
        const consulta = `
            INSERT INTO movimientos_fondos
            (idCaja, idFondo, tipo, origen, idReferencia, monto, descripcion, usuario, idEmpresa)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const parametros = [
            movimiento.idCaja,
            movimiento.idFondo,
            movimiento.tipo,
            movimiento.origen,
            movimiento.idReferencia ?? null,
            movimiento.monto,
            movimiento.descripcion ?? null,
            movimiento.usuario ?? null,
            movimiento.idEmpresa ?? null
        ];
        await connection.query(consulta, parametros);
    } catch (error) {
        throw error;
    }
}

// Valida que una venta que se factura a partir de un Presupuesto sea una copia fiel de
// ese presupuesto: mismos ítems, mismas cantidades, mismos precios unitarios. Devuelve
// null si está OK, o el mensaje de error si no.
//
// Por qué existe: el bloqueo de la grilla en addmod-ventas es solo UI. Sin este chequeo,
// un POST armado a mano podría facturar cualquier cosa "en nombre de" un presupuesto
// aprobado, que es justamente lo que el circuito busca impedir (el presupuesto se
// verifica ANTES de relacionarlo; si después se puede editar, la verificación no vale).
//
// Solo aplica al alta desde Presupuesto. No se toca Pedido/Nota de Empaque: esos SÍ
// admiten ajuste al facturar (el precio de un Pedido se negocia, ver permiteEditarPrecio)
// y meterlos acá cambiaría un comportamiento vigente que nadie pidió cambiar.
async function ValidarFacturacionDePresupuesto(connection, venta:Venta): Promise<string | null> {
    const esFacturaDesdePresupuesto =
        venta.tipoRelacionado === TipoRelacionado.PRESUPUESTO &&
        [IdProceso.FACTURA, IdProceso.COTIZACION].includes(venta.idProceso!);

    if (!esFacturaDesdePresupuesto || !venta.nroRelacionado) return null;

    const [ventasOrigen] = await connection.query(
        `SELECT id FROM ventas WHERE idProceso = ${IdProceso.PRESUPUESTO} AND nroProceso = ? AND fechaBaja IS NULL ORDER BY id DESC LIMIT 1`,
        [venta.nroRelacionado]
    );
    if (!Array.isArray(ventasOrigen) || ventasOrigen.length === 0)
        return `No se encontró el presupuesto Nro ${venta.nroRelacionado} al que se quiere facturar.`;

    const [lineasOrigen] = await connection.query(
        "SELECT idProducto, cantidad, precio FROM ventas_productos WHERE idVenta = ?",
        [ventasOrigen[0].id]
    );
    const [serviciosOrigen] = await connection.query(
        "SELECT idServicio, cantidad, precio FROM ventas_servicios WHERE idVenta = ?",
        [ventasOrigen[0].id]
    );

    const productosEnviados = venta.productos ?? [];
    const serviciosEnviados = venta.servicios ?? [];

    if (productosEnviados.length !== lineasOrigen.length || serviciosEnviados.length !== serviciosOrigen.length)
        return `Los ítems no coinciden con el presupuesto Nro ${venta.nroRelacionado}. Un presupuesto se factura tal cual fue aprobado.`;

    // Comparación por contenido, no por orden: el front puede reordenar la grilla.
    // El importe se compara con tolerancia de 1 centavo por el redondeo de los decimales.
    const claveProducto = (idProducto, cantidad, precio) => `${idProducto}|${cantidad}|${Number(precio).toFixed(2)}`;

    const esperados = new Map<string, number>();
    for (const l of lineasOrigen) {
        const k = claveProducto(l.idProducto, l.cantidad, l.precio);
        esperados.set(k, (esperados.get(k) ?? 0) + 1);
    }
    for (const p of productosEnviados) {
        const k = claveProducto(p.idProducto, p.cantidad, p.unitario);
        const restantes = esperados.get(k);
        if (!restantes) return `Los ítems no coinciden con el presupuesto Nro ${venta.nroRelacionado}. Un presupuesto se factura tal cual fue aprobado.`;
        esperados.set(k, restantes - 1);
    }

    const esperadosServicio = new Map<string, number>();
    for (const s of serviciosOrigen) {
        const k = claveProducto(s.idServicio, s.cantidad, s.precio);
        esperadosServicio.set(k, (esperadosServicio.get(k) ?? 0) + 1);
    }
    for (const s of serviciosEnviados) {
        const k = claveProducto(s.idServicio, s.cantidad, s.unitario);
        const restantes = esperadosServicio.get(k);
        if (!restantes) return `Los servicios no coinciden con el presupuesto Nro ${venta.nroRelacionado}. Un presupuesto se factura tal cual fue aprobado.`;
        esperadosServicio.set(k, restantes - 1);
    }

    return null;
}

async function InsertProductoVenta(connection, producto): Promise<void> {
    try {
        const consulta = " INSERT INTO ventas_productos(idVenta, idProducto, tipoItem, descripcion, idLineaTalle, cantidad, precio, precioLista, total, importeDescuento, talles, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        // precioLista = producto.precio (precio de lista calculado por calcularPrecioCliente en el
        // front, previo a cualquier edición manual). producto.unitario es el precio final cobrado,
        // que puede diferir si el vendedor lo editó (ver permiteEditarPrecio en addmod-ventas).
        // importeDescuento: monto de descuento ($) ya aplicado a esta línea, calculado en el front
        // respetando el topeDescuento del producto (ver aplicarDescuentoAItems en addmod-ventas).
        // Se persiste porque el tope no se guarda en ningún lado; sin esto, listado-ventas no puede
        // reconstruir correctamente el descuento al volver a mostrar la venta.
        // tipoItem: se normaliza server-side a CATALOGO si el front no lo manda, que es
        // el comportamiento histórico de toda línea existente. Nunca se confía en un
        // string arbitrario del body: cualquier valor distinto de PRESUPUESTO cae a
        // CATALOGO, porque de este campo depende si la línea mueve stock.
        // descripcion: solo tiene sentido para líneas no catalogadas (para el catálogo el
        // nombre sale del JOIN, y guardarlo duplicado invita a que se desincronicen).
        const esItemPresupuesto = producto.tipoItem === TipoItemVenta.PRESUPUESTO;
        const tipoItem = esItemPresupuesto ? TipoItemVenta.PRESUPUESTO : TipoItemVenta.CATALOGO;
        const descripcion = esItemPresupuesto ? (producto.descripcion ?? producto.nomProducto ?? null) : null;

        const parametros = [producto.idVenta, producto.idProducto, tipoItem, descripcion, producto.idLineaTalle, producto.cantidad, producto.unitario, producto.precio, producto.total, producto.importeDescuento ?? 0, producto.tallesSeleccionados, producto.t1, producto.t2, producto.t3, producto.t4, producto.t5, producto.t6, producto.t7, producto.t8, producto.t9, producto.t10];
        await connection.query(consulta, parametros);
    } catch (error) {
        throw error;
    }
}

async function InsertServicioVenta(connection, pago): Promise<void> {
    try {
        const consulta = " INSERT INTO ventas_servicios(idVenta, idServicio, cantidad, precio, total, importeDescuento) " +
                         " VALUES(?, ?, ?, ?, ?, ?) ";
        // importeDescuento: ver comentario equivalente en InsertProductoVenta.
        const parametros = [pago.idVenta, pago.idServicio, pago.cantidad, pago.unitario, pago.total, pago.importeDescuento ?? 0];
        await connection.query(consulta, parametros);
    } catch (error) {
        throw error;
    }
}

async function InsertHistorialVenta(connection, historial): Promise<void> {
    try {
        const consulta = " INSERT INTO ventas_historial(idVenta, procActual, procAnterior, fecha, hora) " +
                         " VALUES(?, ?, ?, ?, ?) ";
        const parametros = [historial.idVenta, historial.procActual, historial.procAnterior, require('moment')().format('YYYY-MM-DD'), require('moment')().format('HH:mm')];
        await connection.query(consulta, parametros);
    } catch (error) {
        throw error;
    }
}

async function InsertRecibo(connection, recibo) {
    const consulta = `
        INSERT INTO recibos (idCliente, fecha, hora, ptoVenta, total)
        VALUES (?, CURRENT_DATE, CURRENT_TIME, ?, ?)
    `;
    const [result] = await connection.execute(consulta, [
        recibo.idCliente,
        recibo.ptoVenta,
        recibo.total
    ]);
    return result.insertId;
}

async function InsertPagoVenta(connection, pago): Promise<number> {
    try {
        // Invariante: un pago tipo CUENTA_CORRIENTE nunca puede quedar con un
        // recibo real (no es plata real todavía, ver RegistrarMovimientosVenta
        // más arriba - CC no genera movimiento de fondo). Se fuerza acá, en el
        // único punto de inserción a ventas_pagos, en vez de confiar en que cada
        // call site (ProcesarCobroVenta, Modificar, etc.) arme bien el idRecibo.
        // Bug real que motivó esto: recibos indebidos en Venta #87 (empresa 6) y
        // #98 (empresa 5), y Venta #109 (Club Náutico San Isidro) con impaga mal
        // calculado por el mismo desacople - corregido 07/2026.
        const { tipo } = await GetMetodoPago(connection, pago.idMetodo);
        const idRecibo = tipo === 'CUENTA_CORRIENTE' ? null : pago.idRecibo;

        const consulta = " INSERT INTO ventas_pagos(idVenta, idMetodo, idRecibo, monto) " +
                         " VALUES(?, ?, ?, ?) ";
        const parametros = [pago.idVenta, pago.idMetodo, idRecibo, pago.monto];
        const [result] = await connection.query(consulta, parametros);
        return result.insertId;
    } catch (error) {
        throw error;
    }
}

async function InsertFacturaVenta(connection, factura): Promise<void> {
    try {
        const consulta = " INSERT INTO ventas_factura(idVenta, cae, caeVto, ticket, tipoFactura, neto, iva, dni, tipoDni, ptoVenta, condReceptor, tipoRelacionado, ticketRelacionado, ptoVentaRelacionado) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ";
        const asociado = factura.comprobanteAsociado ?? {};
        const parametros = [
            factura.idVenta,
            factura.cae,
            require('moment')(factura.caeVto).format('YYYY-MM-DD'),
            factura.ticket,
            factura.tipoComprobante,
            factura.neto,
            factura.iva,
            factura.dni,
            factura.tipoDni,
            factura.ptoVenta,
            factura.condReceptor,
            asociado.tipo ?? null,
            asociado.numero ?? null,
            asociado.puntoVenta ?? null
        ];
        await connection.query(consulta, parametros);
    } catch (error) {
        throw error;
    }
}
//#endregion

export const VentasRepo = new VentasRepository();
