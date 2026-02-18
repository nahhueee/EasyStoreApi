import moment from 'moment';
import db from '../db';
import { DatoVentaCaja } from '../models/DatoVentasCaja';
import { TotalAcumulado } from '../models/estadisticas/TotalAcumulado';
import { RowDataPacket } from 'mysql2';

class EstadisticasRepository{
    //Totales de venta
    async ObtenerTotalesVenta(filtros:any){
       const connection = await db.getConnection();
        
        try {
            let filtroFecha = "";

            if (filtros.fechas?.length === 2) {
                const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
                const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

                filtroFecha += ` AND fecha >= '${desde}' AND fecha < '${hasta}' `;
            } 
                      
            const consulta = `
                SELECT
                    COUNT(*) AS cantidad_total_ventas,

                    SUM(v.total) AS total_facturado,

                    SUM(IFNULL(p.entregado, 0)) AS total_cobrado,

                    SUM(v.total - IFNULL(p.entregado, 0)) AS deuda_total,

                    SUM(CASE 
                        WHEN IFNULL(p.entregado, 0) >= v.total THEN 1 
                        ELSE 0 
                    END) AS cantidad_pagas,

                    SUM(CASE 
                        WHEN IFNULL(p.entregado, 0) < v.total THEN 1 
                        ELSE 0 
                    END) AS cantidad_impagas,

                    SUM(CASE 
                        WHEN IFNULL(p.entregado, 0) >= v.total THEN v.total 
                        ELSE 0 
                    END) AS total_ventas_pagas,

                    SUM(CASE 
                        WHEN IFNULL(p.entregado, 0) < v.total THEN v.total 
                        ELSE 0 
                    END) AS total_ventas_impagas

                FROM ventas v
                LEFT JOIN (
                    SELECT idVenta, SUM(monto) AS entregado
                    FROM ventas_pagos
                    GROUP BY idVenta
                ) p ON p.idVenta = v.id

                WHERE v.idCliente = ?
                ${filtroFecha}
                AND v.fechaBaja IS NULL
            `;


            const rows = await connection.query(consulta, [parseInt(filtros.idCliente)]);
            const r = rows[0][0];

            return {
                cantidad_total_ventas: parseInt(r.cantidad_total_ventas || 0),
                cantidad_pagas: parseInt(r.cantidad_pagas || 0),
                cantidad_impagas: parseInt(r.cantidad_impagas || 0),

                total_facturado: parseFloat(r.total_facturado || 0),
                total_cobrado: parseFloat(r.total_cobrado || 0),
                deuda_total: parseFloat(r.deuda_total || 0),
                total_ventas_pagas: parseFloat(r.total_ventas_pagas || 0),
                total_ventas_impagas: parseFloat(r.total_ventas_impagas || 0)
            };

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        } 
    }   

    async TotalesPorMetodoPago(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let filtroFecha = "";

            if (filtros.fechas?.length === 2) {
                const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
                const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

                filtroFecha += ` AND fecha >= '${desde}' AND fecha < '${hasta}' `;
            } 

            const consulta = `
                SELECT
                    vp.idMetodo,
                    mp.descripcion,
                    SUM(vp.monto) AS total_por_metodo,
                    COUNT(DISTINCT vp.idVenta) AS cantidad_ventas
                FROM ventas_pagos vp
                INNER JOIN ventas v ON v.id = vp.idVenta
                INNER JOIN metodos_pago mp ON mp.id = vp.idMetodo
                WHERE v.idCliente = ?
                ${filtroFecha}    
                AND v.fechaBaja IS NULL
                GROUP BY vp.idMetodo, mp.descripcion
                ORDER BY vp.idMetodo
            `;

            const [rows] = await connection.query<RowDataPacket[]>(consulta, [parseInt(filtros.idCliente)]);
            
            const toInt = v => parseInt(v || 0);
            const toFloat = v => parseFloat(v || 0);

            return rows.map(r => ({
                idMetodo: toInt(r.idMetodo),
                descripcion: r.descripcion,
                total_por_metodo: toFloat(r.total_por_metodo),
                cantidad_ventas: toInt(r.cantidad_ventas)
            }));


        }catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TotalesPorComprobante(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let filtroFecha = "";

            if (filtros.fechas?.length === 2) {
                const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
                const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

                filtroFecha += ` AND fecha >= '${desde}' AND fecha < '${hasta}' `;
            } 

            const consulta = `
                SELECT
                    tc.descripcion   AS tipo_comprobante,
                    COUNT(v.id)      AS total_ventas
                FROM ventas v 
                INNER JOIN tipos_comprobantes tc ON tc.id = v.idTComprobante
                WHERE v.idCliente = ?
                ${filtroFecha}    
                AND v.fechaBaja IS NULL
                GROUP BY tc.id, tc.descripcion
                ORDER BY tc.descripcion
            `;

            const [rows] = await connection.query<RowDataPacket[]>(consulta, [parseInt(filtros.idCliente)]);
            
            const toFloat = v => parseFloat(v || 0);

            return rows.map(r => ({
                tipo_comprobante: r.tipo_comprobante,
                total_ventas: toFloat(r.total_ventas),
            }));


        }catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TotalesPorProceso(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let filtroFecha = "";

            if (filtros.fechas?.length === 2) {
                const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
                const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

                filtroFecha += ` AND fecha >= '${desde}' AND fecha < '${hasta}' `;
            } 

            const consulta = `
                SELECT
                    v.idProceso,
                    pr.descripcion AS proceso,
                    COUNT(*) AS cantidad_ventas,
                    SUM(v.total) AS monto_total,
                    SUM(LEAST(IFNULL(p.entregado,0), v.total)) AS monto_pagas,
                    SUM(GREATEST(v.total - IFNULL(p.entregado,0), 0)) AS monto_impagas
                FROM ventas v
                INNER JOIN procesos_venta pr 
                    ON pr.id = v.idProceso
                LEFT JOIN (
                    SELECT idVenta, SUM(monto) AS entregado
                    FROM ventas_pagos
                    GROUP BY idVenta
                ) p ON p.idVenta = v.id
                WHERE v.idCliente = ?
                ${filtroFecha}
                AND v.fechaBaja IS NULL
                GROUP BY v.idProceso, pr.descripcion
                ORDER BY v.idProceso
            `;

            const [rows] = await connection.query<RowDataPacket[]>(consulta, [parseInt(filtros.idCliente)]);
            
            return  rows.map((r: any) => ({
                idProceso: parseInt(r.idProceso),
                proceso: r.proceso,
                cantidad_ventas: parseInt(r.cantidad_ventas),
                monto_total: parseFloat(r.monto_total || 0),
                monto_pagas: parseFloat(r.monto_pagas || 0),
                monto_impagas: parseFloat(r.monto_impagas || 0)
            }));


        }catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

   //Obtiene los datos de venta de la caja
    async ObtenerDatoVentasCaja(idCaja:string){
        const connection = await db.getConnection();
        
        try {
            const consulta = " SELECT SUM(((vd.precio - vd.costo) * vd.cantidad)) ganancias, COUNT(vd.id) cantVentas, SUM(vd.precio * vd.cantidad) totalVentas  " +
                             " FROM ventas_detalle vd " +
                             " INNER JOIN ventas v on vd.idVenta = v.id " +
                             " WHERE v.idCaja = ? " +
                             " GROUP BY v.idCaja; ";

            const rows = await connection.query(consulta, [parseInt(idCaja)]);
            const row = rows[0][0];

            let datoVenta:DatoVentaCaja = new DatoVentaCaja();

            if(row!=undefined){
                datoVenta.ganancias = parseFloat(row['ganancias']);
                datoVenta.totalVentas = parseFloat(row['totalVentas']);    
                datoVenta.cantVentas = row['cantVentas'];
            }
            
            return datoVenta;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //Obtiene los totales de venta acumulado por producto o rubro
    async ObtenerTotalesAcumulado(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let queryRegistros = await ObtenerAcumuladosQuery(filtros,false);
            let queryTotal = await ObtenerAcumuladosQuery(filtros,true);

            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            const registros:TotalAcumulado[] = [];

            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let elemento:TotalAcumulado = new TotalAcumulado({
                        nombre: row['nombre'],
                        total: parseFloat(row['total']),
                    });

                    registros.push(elemento);
                }
            }

            return {total:resultado[0][0].total, registros};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //Obtiene los 5 productos más populares 
    async ObtenerGraficoProductos(idCaja:string){
        const connection = await db.getConnection();
        
        let condicion = "";
        if(idCaja != "0") condicion = " AND v.idCaja = ? "; //Si la caja es distinto de 0, filtramos por caja

        try {
            const consulta = " SELECT COUNT(vd.idProducto) EjeY, p.nombre EjeX " +
                             " FROM ventas_detalle vd" +
                             " INNER JOIN productos p ON p.id = vd.idProducto" +
                             " INNER JOIN ventas v on vd.idVenta = v.id " +
                             " WHERE vd.idProducto <> 1 " +
                               condicion + 
                             " GROUP BY vd.idProducto" +
                             " LIMIT 5;";

            const [rows] = await connection.query(consulta, [parseInt(idCaja)]);
            return await TransformarDatos([rows][0]);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //Obtiene las ganancias por caja
    async ObtenerGraficoGanancias(idCaja:string){
        const connection = await db.getConnection();
        
        let condicion = "";
        if(idCaja != "0") condicion = " WHERE c.id <= ? AND c.finalizada = 1 "; //Si la caja es distinto de 0, filtramos por caja

        try {
            const consulta = " SELECT SUM(((vd.precio - vd.costo) * vd.cantidad)) EjeY, c.id EjeX " +
                             " FROM ventas_detalle vd" +
                             " INNER JOIN ventas v on vd.idVenta = v.id " +
                             " INNER JOIN cajas c ON v.idCaja = c.id " +
                               condicion + 
                             " GROUP BY c.id " +
                             " ORDER BY c.id DESC" +
                             " LIMIT 10;";

            const [rows] = await connection.query(consulta, [parseInt(idCaja)]);
            return await TransformarDatos([rows][0]);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
}

async function TransformarDatos(inputArray:any){
    try {
        const ejeX: number[] = [];
        const ejeY: number[] = [];

        // Iteramos sobre cada elemento del array de entrada
        inputArray.forEach(item => {
            // Agregamos el primer elemento al array de ejeY
            ejeY.push(item.EjeY);
            // Agregamos el segundo elemento al array de ejeX
            ejeX.push(item.EjeX);
        });

        // Devolvemos un objeto con los dos arrays
        return { ejeY, ejeX };
    } catch (error) {
        throw error; 
    }
}

async function ObtenerAcumuladosQuery(filtros:any,esTotal:boolean):Promise<string>{
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
            filtro += " AND p.nombre LIKE '%"+ filtros.nombre + "%' ";
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
            " SELECT p.nombre, SUM(vd.precio * vd.cantidad) total FROM ventas_detalle vd " +
            " INNER JOIN productos p ON p.id = vd.idProducto " +
            " INNER JOIN ventas v ON v.id = vd.idVenta " +
            " WHERE v.idCaja = " + filtros.caja + 
            filtro +
            " GROUP BY vd.idProducto " +
            " ORDER BY total DESC " +
            paginado +
            endCount;
            return query;
            
    } catch (error) {
        throw error; 
    }
}

export const EstadisticasRepo = new EstadisticasRepository();

