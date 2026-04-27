import moment from 'moment';
import db from '../db';
import { ResultSetHeader } from 'mysql2';
import { CuentaCorriente, VentasClienteCuenta } from '../models/CuentaCorriente';

interface pagoDTO {
  idMetodo: number;
  monto: number;
}

interface EntregaDineroVentaDTO {
  idCliente: number;
  idVenta: number;
  totalDeuda: number;
  pagos: pagoDTO[]
}

interface EntregaDineroDTO {
  idCliente: number;
  idMetodo: number;
  monto: number;
  observaciones: string;
}


class CuentasRepository{

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

            const cuentas:CuentaCorriente[] = [];
    
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    
                    let cuenta:CuentaCorriente = new CuentaCorriente();
                    cuenta.cliente = row['cliente'];
                    cuenta.idCliente = row['idCliente'];
                    cuenta.debe = parseFloat(row['debe']);
                    cuenta.haber = parseFloat(row['haber']);
                    cuenta.saldo = parseFloat(row['saldo']);
                    cuenta.estado = row['estado'];
                    cuenta.ultimoMovimiento = row['ultimoMovimiento'];                   
                    cuentas.push(cuenta);
                }
            }
    
            return {total:resultado[0][0].total, registros:cuentas};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerVentasCliente(filtros:any){
        const connection = await db.getConnection();
        
        try {
            //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQueryVentasCliente(filtros,false);
            let queryTotal = await ObtenerQueryVentasCliente(filtros,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            const ventas:VentasClienteCuenta[] = [];
    
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    
                    let venta:VentasClienteCuenta = new VentasClienteCuenta();
                    venta.id = row['id'];
                    venta.nroProceso = row['nroProceso'];
                    venta.proceso = row['proceso'];
                    venta.fecha = row['fecha'];
                    venta.comprobante = row['comprobante'];
                    venta.tipo = row['tipo'];
                    venta.debe = parseFloat(row['debe']);
                    venta.haber = parseFloat(row['haber']);
                    venta.saldo = parseFloat(row['saldo']);
                    venta.estado = row['estado'];     
                    venta.referencia = row['referencia'];
                    venta.observaciones = row['observaciones'];
                   
                    ventas.push(venta);
                }
            }

            return {total:resultado[0][0].total, registros:ventas};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerVentasClienteReporte(filtros:any){
        const connection = await db.getConnection();
        
        try {
            //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQueryVentasCliente(filtros,false,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);
            const ventas:VentasClienteCuenta[] = [];
    
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    
                    let venta:VentasClienteCuenta = new VentasClienteCuenta();
                    venta.id = row['id'];
                    venta.nroProceso = row['nroProceso'];
                    venta.proceso = row['proceso'];
                    venta.fecha = row['fecha'];
                    venta.comprobante = row['comprobante'];
                    venta.tipo = row['tipo'];
                    venta.debe = parseFloat(row['debe']);
                    venta.haber = parseFloat(row['haber']);
                    venta.saldo = parseFloat(row['saldo']);
                    venta.estado = row['estado'];     
                    venta.referencia = row['referencia'];
                   
                    ventas.push(venta);
                }
            }

            return ventas;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerRecibo(idRecibo){
        const connection = await db.getConnection();
        
        try {
            const consulta = `
                SELECT
                    r.id,
                    r.fecha,
                    r.hora,
                    c.nombre AS cliente,

                    mp.descripcion AS metodo,
                    vp.monto,

                    v.id AS idVenta,
                    v.nroProceso,
                    pv.descripcion AS proceso,

                    r.total

                FROM recibos r
                JOIN clientes c ON c.id = r.idCliente
                JOIN ventas_pagos vp ON vp.idRecibo = r.id
                JOIN metodos_pago mp ON mp.id = vp.idMetodo
                LEFT JOIN ventas v ON v.id = vp.idVenta
                LEFT JOIN procesos_venta pv ON pv.id = v.idProceso

                WHERE r.id = ?;
            `;
            
            const [rows]: any = await connection.query(consulta, [idRecibo]);

            const recibo = {
                id: rows[0].id,
                cliente: rows[0].cliente,
                fecha: rows[0].fecha,
                hora: rows[0].hora,
                total: Number(rows[0].total),

                // pagos
                pagos: rows.map(r => ({
                    metodo: r.metodo,
                    monto: Number(r.monto)
                })),

                // ventas 
                ventas: Object.values(
                    rows.reduce((acc, r) => {
                        if (!r.idVenta) return acc;

                        if (!acc[r.idVenta]) {
                            acc[r.idVenta] = {
                                id: r.idVenta,
                                nroProceso: r.nroProceso,
                                proceso: r.proceso
                            };
                        }

                        return acc;
                    }, {})
                )
            };

            return recibo;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    async ObtenerSaldoCliente(idCliente){
        const connection = await db.getConnection();
        
        try {
            const [rows]: any = await connection.query(
                `
                SELECT 
                (
                    COALESCE(c.inicial, 0)

                    + COALESCE((
                        SELECT 
                            SUM(
                                CASE 
                                    WHEN v.idTComprobante NOT IN (3, 8, 13, 100)
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
                WHERE c.id = ?
                AND c.fechaBaja IS NULL;
                `,
                [idCliente]
            );

            return parseFloat(rows[0].saldoFinal);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //#endregion

    async EntregaDinero(data: EntregaDineroDTO): Promise<string> {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // Obtener ventas a cancelar
            let resultados = await ObtenerVentasImpagas(connection, data.idCliente);

            // Cabecera entrega
            const [res] = await connection.query<ResultSetHeader>(
                `
                INSERT INTO ventas_entrega (idCliente, monto, fecha)
                VALUES (?, ?, NOW())
                `,
                [data.idCliente, data.monto]
            );

            const idEntrega = res.insertId;

            const [resRecibo] = await connection.query<ResultSetHeader>(
                `
                INSERT INTO recibos 
                (idCliente, fecha, hora, total, observaciones)
                VALUES (?, CURRENT_DATE, CURRENT_TIME, ?, ?)
                `,
                [data.idCliente, data.monto, data.observaciones]
            );
            const idRecibo = resRecibo.insertId;


            let montoRestante = data.monto;
            // Aplicar el dinero
            for (const venta of resultados) {
                if (montoRestante <= 0) break;

                const deuda = venta.total - venta.pagado;
                if (deuda <= 0) continue;

                const montoAplicado = Math.min(deuda, montoRestante);
                
                // Pago
                await connection.query(
                    `
                    INSERT INTO ventas_pagos (idVenta, idMetodo, monto, idEntrega, idRecibo)
                    VALUES (?, ?, ?, ?, ?)
                    `,
                    [venta.id, data.idMetodo, montoAplicado, idEntrega, idRecibo]
                );

                // Detalle entrega
                await connection.query(
                    `
                    INSERT INTO ventas_entrega_detalle
                    (idEntrega, idVenta, idMetodoAplicado, montoAplicado)
                    VALUES (?, ?, ?, ?)
                    `,
                    [idEntrega, venta.id, data.idMetodo, montoAplicado]
                );

                // ¿Quedó saldada?
                if (montoAplicado === deuda) {
                    await connection.query(
                    `UPDATE ventas SET impaga = 0 WHERE id = ?`,
                    [venta.id]
                    );
                }

                montoRestante -= montoAplicado;
            }

            if (montoRestante > 0) {
                await connection.query(
                    `
                    INSERT INTO ventas_pagos (idVenta, idMetodo, monto, idEntrega, idRecibo)
                    VALUES (NULL, ?, ?, ?, ?)
                    `,
                    [data.idMetodo, montoRestante, idEntrega, idRecibo]
                );
            }

            await connection.commit();
            return "OK";

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }


    async RevertirEntrega(idEntrega: number): Promise<string> {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // 1️⃣ Obtener detalle
            const [detalles] = await connection.query<any[]>(
                `
                SELECT idVenta, idMetodoAplicado, montoAplicado
                FROM ventas_entrega_detalle
                WHERE idEntrega = ?
                `,
                [idEntrega]
            );

            if (!detalles.length) {
                throw new Error("No se encontró la entrega");
            }

            // 2️⃣ Revertir pagos
            for (const d of detalles) {
                await connection.query(
                    `
                    DELETE FROM ventas_pagos
                    WHERE idVenta = ?
                    AND idEntrega = ?`,
                    [d.idVenta, idEntrega]
                );

                // 3️⃣ Recalcular estado de la venta
                const [[venta]] = await connection.query<any[]>(
                    `
                    SELECT 
                        v.total,
                        IFNULL(SUM(p.monto), 0) AS pagado
                    FROM ventas v
                    LEFT JOIN ventas_pagos p ON p.idVenta = v.id
                    WHERE v.id = ?
                    GROUP BY v.id
                    `,
                    [d.idVenta]
                );

                const impaga = venta.pagado < venta.total ? 1 : 0;

                await connection.query(
                    `UPDATE ventas SET impaga = ? WHERE id = ?`,
                    [impaga, d.idVenta]
                );
            }

            // 4️⃣ Eliminar historial
            await connection.query(
                `DELETE FROM ventas_entrega_detalle WHERE idEntrega = ?`,
                [idEntrega]
            );

            await connection.query(
                `DELETE FROM ventas_entrega WHERE id = ?`,
                [idEntrega]
            );

            await connection.commit();
            return "OK";

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }


    async ActualizarPagosVenta(entrega:EntregaDineroVentaDTO): Promise<string>{
        const connection = await db.getConnection();
        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            if (!entrega.pagos || entrega.pagos.length === 0) {
                throw new Error("No hay pagos para aplicar");
            }
            let deudaCancelada:number = entrega.pagos?.reduce((acc, i) => acc + (i.monto || 0), 0) || 0;
             if (deudaCancelada > entrega.totalDeuda) {
                throw new Error("El monto entregado supera la deuda");
            }

            //Insertamos la cabecera del registro de historial
            const [res] = await connection.query<ResultSetHeader>(
                `
                INSERT INTO ventas_entrega (idCliente, monto, fecha)
                VALUES (?, ?, NOW())
                `,
                [entrega.idCliente, deudaCancelada]
            );
            const idEntrega = res.insertId;

            //Creamos el recibo
            const [reciboRes] = await connection.query<ResultSetHeader>(
                `
                INSERT INTO recibos 
                (idCliente, fecha, hora, total)
                VALUES (?, CURRENT_DATE, CURRENT_TIME, ?)
                `,
                [
                    entrega.idCliente,
                    deudaCancelada
                ]
            );
            const idRecibo = reciboRes.insertId;

            for (const element of entrega.pagos) {
                //Insertamos los nuevos pagos
                const insertar = " INSERT INTO ventas_pagos(idVenta, idMetodo, idRecibo, monto, idEntrega) " +
                                " VALUES(?, ?, ?, ?, ?) ";
                const parametrosInsert = [entrega.idVenta, element.idMetodo, idRecibo, element.monto, idEntrega];
                await connection.query(insertar, parametrosInsert);

                //Insertamos los detalle de registro
                await connection.query(
                    `
                    INSERT INTO ventas_entrega_detalle
                    (idEntrega, idVenta, idMetodoAplicado, montoAplicado)
                    VALUES (?, ?, ?, ?)
                    `,
                    [idEntrega, entrega.idVenta, element.idMetodo, element.monto]
                );
            };

            if (deudaCancelada > entrega.totalDeuda) {
                throw new Error("El monto entregado supera la deuda");
            }
          
            if(entrega.totalDeuda == deudaCancelada){
                 //Actualizamos el estado de la venta
                const actualizar = " UPDATE ventas SET " +
                                " impaga = 0 WHERE id = ? ";
                const parametrosUpdate = [entrega.idVenta];
                await connection.query(actualizar, parametrosUpdate);
            }
           
            //Mandamos la transaccion
            await connection.commit();

            return "OK";

        } catch (error:any) {
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }
}

async function ObtenerQuery(filtros:any,esTotal:boolean):Promise<string>{
    try {
        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.nombre != null && filtros.nombre != "") 
            filtro += " AND c.nombre LIKE '%"+ filtros.nombre.toUpperCase().trim() + "%'";
        if (filtros.condicionIva != null && filtros.condicionIva != "") 
            filtro += " AND c.idCondIva = "+ filtros.condicionIva;
        if (filtros.condicionPago != null && filtros.condicionPago != "") 
            filtro += " AND c.idCondicionPago = "+ filtros.condicionPago;
        if (filtros.documento != null && filtros.documento != 0) 
            filtro += " AND c.documento = " + filtros.documento;
        if (filtros.idCliente != null && filtros.idCliente != 0) 
            filtro += " AND c.id = "+ filtros.idCliente;
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
            `WITH
                -- 🟥 Ventas (deuda real)
                ventas_totales AS (
                    SELECT 
                        idCliente,
                        SUM(total) AS totalVentas
                    FROM ventas
                    WHERE fechaBaja IS NULL
                    AND idTComprobante NOT IN (3,8,13,100)
                    GROUP BY idCliente
                ),

                -- 🟦 Notas de crédito
                notas_credito AS (
                    SELECT 
                        idCliente,
                        SUM(total) AS totalNC
                    FROM ventas
                    WHERE fechaBaja IS NULL
                    AND idTComprobante IN (3,8,13,100)
                    GROUP BY idCliente
                ),

                -- 💰 Pagos reales (EXCLUYE saldo a favor)
                pagos_ventas AS (
                    SELECT 
                        v.idCliente,
                        SUM(vp.monto) AS totalPagos
                    FROM ventas_pagos vp
                    JOIN ventas v ON v.id = vp.idVenta
                    JOIN recibos r ON r.id = vp.idRecibo
                    WHERE vp.idMetodo <> 8
                    AND r.fechaBaja IS NULL
                    GROUP BY v.idCliente
                ),

                -- 💚 Entregas (saldo a favor generado)
                entregas AS (
                    SELECT 
                        r.idCliente,
                        SUM(vp.monto) AS totalEntregas
                    FROM ventas_pagos vp
                    JOIN recibos r ON r.id = vp.idRecibo
                    WHERE vp.idVenta IS NULL
                    AND r.fechaBaja IS NULL
                    GROUP BY r.idCliente
                ),

                -- 📅 Últimos movimientos
                ult_ventas AS (
                    SELECT 
                        idCliente,
                        MAX(TIMESTAMP(fecha, hora)) AS fechaVenta
                    FROM ventas
                    WHERE fechaBaja IS NULL
                    GROUP BY idCliente
                ),

                ult_recibos AS (
                    SELECT 
                        idCliente,
                        MAX(TIMESTAMP(fecha, hora)) AS fechaRecibo
                    FROM recibos
                    WHERE fechaBaja IS NULL
                    GROUP BY idCliente
                )

                SELECT
                    c.id AS idCliente,
                    c.nombre AS cliente,

                    -- 🧾 DEBE
                    (
                        COALESCE(v.totalVentas, 0)
                        + CASE 
                            WHEN COALESCE(c.inicial, 0) > 0 
                            THEN c.inicial 
                            ELSE 0 
                        END
                    ) AS debe,

                    -- 💰 HABER
                    (
                        COALESCE(pv.totalPagos, 0)
                        + COALESCE(e.totalEntregas, 0)
                        + COALESCE(nc.totalNC, 0)
                        + CASE 
                            WHEN COALESCE(c.inicial, 0) < 0 
                            THEN ABS(c.inicial) 
                            ELSE 0 
                        END
                    ) AS haber,

                    -- 💥 SALDO FINAL (CORREGIDO)
                    (
                        COALESCE(c.inicial, 0)
                        + COALESCE(v.totalVentas, 0)
                        - COALESCE(nc.totalNC, 0)
                        - COALESCE(pv.totalPagos, 0)
                        - COALESCE(e.totalEntregas, 0)
                    ) AS saldo,

                    -- 🟢 ESTADO
                    CASE
                        WHEN (
                            COALESCE(c.inicial, 0)
                            + COALESCE(v.totalVentas, 0)
                            - COALESCE(nc.totalNC, 0)
                            - COALESCE(pv.totalPagos, 0)
                            - COALESCE(e.totalEntregas, 0)
                        ) > 0 THEN 'Debe'

                        WHEN (
                            COALESCE(c.inicial, 0)
                            + COALESCE(v.totalVentas, 0)
                            - COALESCE(nc.totalNC, 0)
                            - COALESCE(pv.totalPagos, 0)
                            - COALESCE(e.totalEntregas, 0)
                        ) < 0 THEN 'A Favor'

                        ELSE 'Al Día'
                    END AS estado,

                    -- 📅 Último movimiento
                    GREATEST(
                        COALESCE(uv.fechaVenta, '1900-01-01'),
                        COALESCE(ur.fechaRecibo, '1900-01-01')
                    ) AS ultimoMovimiento

                FROM clientes c

                LEFT JOIN ventas_totales v ON v.idCliente = c.id
                LEFT JOIN notas_credito nc ON nc.idCliente = c.id
                LEFT JOIN pagos_ventas pv ON pv.idCliente = c.id
                LEFT JOIN entregas e ON e.idCliente = c.id
                LEFT JOIN ult_ventas uv ON uv.idCliente = c.id
                LEFT JOIN ult_recibos ur ON ur.idCliente = c.id

                WHERE c.fechaBaja IS NULL
                ${filtro}

                GROUP BY 
                    c.id,
                    c.nombre,
                    c.inicial,
                    v.totalVentas,
                    nc.totalNC,
                    pv.totalPagos,
                    e.totalEntregas,
                    uv.fechaVenta,
                    ur.fechaRecibo

                ORDER BY c.nombre ASC
            ` +
            paginado +
            endCount;
        
        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ObtenerQueryVentasCliente(filtros:any,esTotal:boolean,esReporte:boolean=false):Promise<string>{
    try {
        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.proceso != null && filtros.proceso != '') 
            filtro += " AND proceso = '" + filtros.proceso + "'";
        if (filtros.fechas?.length === 2) {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            filtro += ` AND fecha >= '${desde}' AND fecha < '${hasta}'`;
        }
        // #endregion

        if(!esReporte){
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
        }
        
        //Arma la Query con el paginado y los filtros correspondientes
        query = count +
            `SELECT *
                FROM (
                    -- ================= SALDO INICIAL =================
                    SELECT
                        0 AS id,
                        0 AS nroProceso,
                        'INICIAL' AS proceso,
                        '' AS fecha,

                        'SALDO INICIAL' AS comprobante,

                        'INICIAL' AS tipo,

                        CASE 
                            WHEN c.inicial > 0 THEN c.inicial
                            ELSE 0
                        END AS debe,

                        CASE 
                            WHEN c.inicial < 0 THEN ABS(c.inicial)
                            ELSE 0
                        END AS haber,

                        c.inicial AS saldo,

                        'INICIAL' AS estado,
                        '' AS referencia,
                        '' AS observaciones,
                        0 AS orden_tipo

                    FROM clientes c
                    WHERE c.id = ${filtros.cliente}
                    AND c.fechaBaja IS NULL

                    UNION ALL

                    -- ================= VENTAS (DEBE) =================
                    SELECT
                        v.id,
                        v.nroProceso,
                        tp.descripcion AS proceso,
                        CONCAT(DATE(v.fecha), ' ', TIME_FORMAT(v.hora, '%H:%i:%s')) AS fecha,
                        CASE
                            WHEN v.idTComprobante NOT IN (99, 100) THEN
                                CONCAT(
                                    tc.descripcion, ' ',
                                    LPAD(COALESCE(vf.ptoVenta, 0), 4, '0'), '-',
                                    LPAD(COALESCE(vf.ticket, 0), 8, '0')
                                )
                            ELSE
                                CONCAT(
                                    tp.descripcion, ' ',
                                    LPAD(9999, 4, '0'), '-',
                                    LPAD(COALESCE(v.nroProceso, 0), 8, '0')
                                )
                        END AS comprobante,
                        tc.descripcion AS tipo,
                        v.total AS debe,
                        0 AS haber,
                        v.total AS saldo,
                        CASE
                            WHEN COALESCE(p.totalPagos, 0) >= v.total THEN 'PAGADA'
                            ELSE 'CON DEUDA'
                        END AS estado,
                        '--' AS referencia,
                        '' AS observaciones,
                        1 AS orden_tipo 
                    FROM ventas v
                    LEFT JOIN ventas_factura vf ON vf.idVenta = v.id
                    LEFT JOIN tipos_comprobantes tc ON tc.id = v.idTComprobante
                    LEFT JOIN procesos_venta tp ON tp.id = v.idProceso 
                    LEFT JOIN (
                        SELECT idVenta, SUM(monto) AS totalPagos
                        FROM ventas_pagos
                        GROUP BY idVenta
                    ) p ON p.idVenta = v.id
                    WHERE v.fechaBaja IS NULL
                    AND v.idCliente = ${filtros.cliente}
                    AND v.idTComprobante NOT IN (3, 8, 13, 100)

                    UNION ALL

                    -- ================= NOTAS / A FAVOR =================
                    SELECT
                        v.id,
                        v.nroProceso,
                        tp.descripcion AS proceso,
                        CONCAT(DATE(v.fecha), ' ', TIME_FORMAT(v.hora, '%H:%i:%s')) AS fecha,
                        CASE
                            WHEN v.idTComprobante = 100 THEN
                                CONCAT(
                                    tc.descripcion, ' ',
                                    LPAD(12, 4, '0'), '-',
                                    LPAD(COALESCE(v.nroProceso, 0), 8, '0')
                                )
                            ELSE
                                CONCAT(
                                    tc.descripcion, ' ',
                                    LPAD(COALESCE(vf.ptoVenta, 0), 4, '0'), '-',
                                    LPAD(COALESCE(vf.ticket, 0), 8, '0')
                                )
                        END,
                        tc.descripcion,
                        0,
                        v.total,
                        -v.total,
                        'A FAVOR',
                        CONCAT(v.tipoRelacionado, ' # ', v.nroRelacionado),
                        '' AS observaciones,
                        3 AS orden_tipo
                    FROM ventas v
                    LEFT JOIN ventas_factura vf ON vf.idVenta = v.id
                    LEFT JOIN tipos_comprobantes tc ON tc.id = v.idTComprobante
                    LEFT JOIN procesos_venta tp ON tp.id = v.idProceso
                    WHERE v.fechaBaja IS NULL
                    AND v.idCliente = ${filtros.cliente}
                    AND v.idTComprobante IN (3, 8, 13, 100)

                    UNION ALL

                    -- ================= RECIBOS =================
                    SELECT
                        r.id,
                        r.id AS nroProceso,
                        'RECIBO' AS tipo,
                        CONCAT(DATE(r.fecha), ' ', TIME_FORMAT(r.hora, '%H:%i:%s')) AS fecha,

                        CONCAT(
                            'RECIBO # ',
                            LPAD(r.ptoVenta, 4, '0'), '-',
                            LPAD(r.id, 8, '0')
                        ) AS descripcion,

                        'RECIBO' AS proceso,
                        0,
                        r.total,
                        -r.total,
                        '',

                        CASE 
                            WHEN COUNT(DISTINCT v.id) = 1 THEN
                                MAX(CONCAT(pv.descripcion, ' # ', v.nroProceso))
                            WHEN COUNT(DISTINCT v.id) > 1 THEN
                                CONCAT('VARIAS VENTAS (', COUNT(DISTINCT v.id), ')')
                            ELSE
                                ''
                        END AS referencia,
                        r.observaciones AS observaciones,
                        2 AS orden_tipo

                    FROM recibos r
                    LEFT JOIN ventas_pagos vp ON vp.idRecibo = r.id
                    LEFT JOIN ventas v ON v.id = vp.idVenta
                    LEFT JOIN procesos_venta pv ON pv.id = v.idProceso

                    WHERE r.fechaBaja IS NULL
                    AND r.idCliente = ${filtros.cliente}

                    GROUP BY r.id, r.fecha, r.hora, r.total

                ) movimientos
                WHERE 1 = 1 
                ${filtro}
                ORDER BY 
                    fecha DESC,
                    orden_tipo DESC
            ` +
            paginado +
            endCount;
        
        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ObtenerVentasImpagas(connection, idCliente:number){
    try {
        const consulta = " SELECT v.id, v.total, IFNULL(SUM(vp.monto), 0) AS pagado " +
                         " FROM ventas v " +
                         " LEFT JOIN ventas_pagos vp ON vp.idVenta = v.id " +
                         " WHERE v.impaga = 1 " +
                         " AND v.idCliente = ? " +
                         " GROUP BY v.id " +
                         " ORDER BY v.fecha ASC ";

        const [rows] = await connection.query(consulta, [idCliente])
        return [rows][0];

    } catch (error) {
        throw error; 
    }
}

export const CuentasRepo = new CuentasRepository();