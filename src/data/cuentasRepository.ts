import moment from 'moment';
import db from '../db';
import { ResultSetHeader } from 'mysql2';
import { CuentaCorriente } from '../models/CuentaCorriente';

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
                    cuenta.cantVentas = row['cantVentas'];
                    cuenta.cliente = row['cliente'];
                    cuenta.idCliente = row['idCliente'];
                    cuenta.totalDeuda = parseFloat(row['totalDeuda']);
                    cuenta.ultimaDeuda = row['ultimaDeuda'];
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

    async ObtenerDeudaTotalCliente(idCliente){
        const connection = await db.getConnection();
        
        try {
            const [rows]: any = await connection.query(
                `
                SELECT 
                    IFNULL(SUM(v.total - IFNULL(vp.pagado, 0)), 0) AS totalDeuda
                FROM ventas v
                LEFT JOIN (
                    SELECT idVenta, SUM(monto) AS pagado
                    FROM ventas_pagos
                    GROUP BY idVenta
                ) vp ON vp.idVenta = v.id
                WHERE v.impaga = 1
                AND v.idCliente = ?
                `,
                [idCliente]
            );

            return rows[0].totalDeuda;

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

            // 1️⃣ Obtener ventas a cancelar
            let resultados = await ObtenerVentasImpagas(connection, data.idCliente);


            // 2️⃣ Cabecera entrega
            const [res] = await connection.query<ResultSetHeader>(
                `
                INSERT INTO ventas_entrega (idCliente, monto, fecha)
                VALUES (?, ?, NOW())
                `,
                [data.idCliente, data.monto]
            );

            const idEntrega = res.insertId;
            let montoRestante = data.monto;

            // 3️⃣ Aplicar el dinero
            for (const venta of resultados) {
                if (montoRestante <= 0) break;

                const deuda = venta.total - venta.pagado;
                if (deuda <= 0) continue;

                const montoAplicado = Math.min(deuda, montoRestante);

                // Pago
                await connection.query(
                    `
                    INSERT INTO ventas_pagos (idVenta, idMetodo, monto, idEntrega)
                    VALUES (?, ?, ?, ?)
                    `,
                    [venta.id, data.idMetodo, montoAplicado, idEntrega]
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

            //Insertamos la cabecera del registro de historial
            const [res] = await connection.query<ResultSetHeader>(
                `
                INSERT INTO ventas_entrega (idCliente, monto, fecha)
                VALUES (?, ?, NOW())
                `,
                [entrega.idCliente, deudaCancelada]
            );

            const idEntrega = res.insertId;

            for (const element of entrega.pagos) {
                //Insertamos los nuevos pagos
                const insertar = " INSERT INTO ventas_pagos(idVenta, idMetodo, monto, idEntrega) " +
                                " VALUES(?, ?, ?, ?) ";
                const parametrosInsert = [entrega.idVenta, element.idMetodo, element.monto, idEntrega];
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
        if(filtros.idCliente != null && filtros.idCliente != 0)
            filtro += " AND c.id = " + filtros.idCliente + "";
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
            " SELECT v.idCliente, c.nombre AS cliente, COUNT(v.id) AS cantVentas, SUM(v.total - IFNULL(p.totalPagado, 0)) AS totalDeuda, MAX(v.fecha) AS ultimaDeuda " +
            " FROM ventas v " +
            " INNER JOIN clientes c on c.id = v.idCliente " +
            " LEFT JOIN (" +
            " SELECT idVenta, SUM(monto) AS totalPagado" +
            " FROM ventas_pagos " +
            " GROUP BY idVenta " +
            " ) p ON p.idVenta = v.id " + 
            " WHERE v.impaga = 1 " +
            " AND IFNULL(p.totalPagado, 0) < v.total " +
            filtro +
            " GROUP BY v.idCliente, c.nombre " +
            " ORDER BY totalDeuda DESC " +
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