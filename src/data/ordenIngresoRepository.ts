import moment from 'moment';
import db from '../db';
import { OrdenIngreso, ProductoOrden } from '../models/OrdenIngreso';
import { ProductosRepo } from './productosRepository';

class OrdenIngresoRepository{

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
            const ordenes:OrdenIngreso[] = [];
                       
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    ordenes.push(await this.CompletarObjeto(connection, row));
                }
            }

            return {total:resultado[0][0].total, registros:ordenes};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerOrden(idOrden:any){
        const connection = await db.getConnection();
        
        try {
            let consulta = await ObtenerQuery({id: idOrden},false);
            const rows = await connection.query(consulta);
           
            return await this.CompletarObjeto(connection, rows[0][0], true);
        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async CompletarObjeto(connection, row, unico:boolean = false){
        let orden:OrdenIngreso = new OrdenIngreso();
        orden.id = row['id'];
        orden.corte = row['corte'];
        orden.fecha = row['fecha'];
        orden.idProveedor = row['idProveedor'];
        orden.observaciones = row['observaciones'];
        orden.usuario = row['usuario'];
        orden.alta = row['alta'];
        orden.actualizacion = row['actualizacion'];
       
        const resultadoProductos = await ObtenerProductosOrden(connection, row['id'], unico);
        orden.productos = resultadoProductos.productos;
        orden.estado = resultadoProductos.estado;

        return orden;
    }

    async ObtenerProximoNroOrden() {
        const connection = await db.getConnection();
        
        try {
            const consulta = `
                SELECT id FROM ordenes_ingreso
                ORDER BY id DESC
                LIMIT 1
            `;
            
            const [rows]: any = await connection.query(consulta);
            return rows[0].id + 1;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    async ObtenerDatosReporte(idOrden) {
        const connection = await db.getConnection();
        
        try {
            const consulta = `
                SELECT
                    r.idProducto,
                    p.codigo,
                    p.nombre AS nombreProducto,
                    c.descripcion AS color,
                    r.tipo,
                    DATE_FORMAT(r.fecha, '%d/%m/%Y') AS fecha,
                    r.usuario,
                    r.idRecepcion,
                    r.t1, r.t2, r.t3, r.t4, r.t5,
                    r.t6, r.t7, r.t8, r.t9, r.t10,
                    r.total
                FROM (

                    -- BLOQUE 1: PEDIDO original
                    SELECT
                        op.idProducto, op.idLineaTalle, op.talles,
                        1 AS orden_bloque,
                        'PEDIDO' AS tipo,
                        NULL AS fecha, NULL AS usuario, NULL AS idRecepcion,
                        op.t1, op.t2, op.t3, op.t4, op.t5,
                        op.t6, op.t7, op.t8, op.t9, op.t10,
                        COALESCE(op.t1,0)+COALESCE(op.t2,0)+COALESCE(op.t3,0)+
                        COALESCE(op.t4,0)+COALESCE(op.t5,0)+COALESCE(op.t6,0)+
                        COALESCE(op.t7,0)+COALESCE(op.t8,0)+COALESCE(op.t9,0)+
                        COALESCE(op.t10,0) AS total
                    FROM ordenes_productos op
                    WHERE op.idOrden = ?

                    UNION ALL

                    -- BLOQUE 2: RECIBIDO acumulado
                    SELECT
                        op.idProducto, op.idLineaTalle, op.talles,
                        2 AS orden_bloque,
                        'RECIBIDO' AS tipo,
                        NULL, NULL, NULL,
                        SUM(CASE WHEN rtp.talle='t1'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t2'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t3'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t4'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t5'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t6'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t7'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t8'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t9'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t10' THEN rtp.cantidad ELSE 0 END),
                        SUM(rtp.cantidad) AS total
                    FROM ordenes_productos op
                    JOIN recepciones r
                        ON r.idOrden = op.idOrden
                    JOIN recepciones_talles_producto rtp
                        ON  rtp.idRecepcion  = r.id
                        AND rtp.idProducto   = op.idProducto
                        AND rtp.idLineaTalle = op.idLineaTalle
                    WHERE op.idOrden = ?
                    GROUP BY op.idProducto, op.idLineaTalle, op.talles

                    UNION ALL

                    -- BLOQUE 3: PENDIENTE (pedido - recibido - bajas)
                    SELECT
                        op.idProducto, op.idLineaTalle, op.talles,
                        3 AS orden_bloque,
                        'PENDIENTE' AS tipo,
                        NULL, NULL, NULL,
                        GREATEST(0, COALESCE(op.t1,0)  - SUM(CASE WHEN rtp.talle='t1'  THEN rtp.cantidad ELSE 0 END) - COALESCE(MAX(baja.t1),0)),
                        GREATEST(0, COALESCE(op.t2,0)  - SUM(CASE WHEN rtp.talle='t2'  THEN rtp.cantidad ELSE 0 END) - COALESCE(MAX(baja.t2),0)),
                        GREATEST(0, COALESCE(op.t3,0)  - SUM(CASE WHEN rtp.talle='t3'  THEN rtp.cantidad ELSE 0 END) - COALESCE(MAX(baja.t3),0)),
                        GREATEST(0, COALESCE(op.t4,0)  - SUM(CASE WHEN rtp.talle='t4'  THEN rtp.cantidad ELSE 0 END) - COALESCE(MAX(baja.t4),0)),
                        GREATEST(0, COALESCE(op.t5,0)  - SUM(CASE WHEN rtp.talle='t5'  THEN rtp.cantidad ELSE 0 END) - COALESCE(MAX(baja.t5),0)),
                        GREATEST(0, COALESCE(op.t6,0)  - SUM(CASE WHEN rtp.talle='t6'  THEN rtp.cantidad ELSE 0 END) - COALESCE(MAX(baja.t6),0)),
                        GREATEST(0, COALESCE(op.t7,0)  - SUM(CASE WHEN rtp.talle='t7'  THEN rtp.cantidad ELSE 0 END) - COALESCE(MAX(baja.t7),0)),
                        GREATEST(0, COALESCE(op.t8,0)  - SUM(CASE WHEN rtp.talle='t8'  THEN rtp.cantidad ELSE 0 END) - COALESCE(MAX(baja.t8),0)),
                        GREATEST(0, COALESCE(op.t9,0)  - SUM(CASE WHEN rtp.talle='t9'  THEN rtp.cantidad ELSE 0 END) - COALESCE(MAX(baja.t9),0)),
                        GREATEST(0, COALESCE(op.t10,0) - SUM(CASE WHEN rtp.talle='t10' THEN rtp.cantidad ELSE 0 END) - COALESCE(MAX(baja.t10),0)),
                        GREATEST(0,
                            (COALESCE(op.t1,0)+COALESCE(op.t2,0)+COALESCE(op.t3,0)+
                            COALESCE(op.t4,0)+COALESCE(op.t5,0)+COALESCE(op.t6,0)+
                            COALESCE(op.t7,0)+COALESCE(op.t8,0)+COALESCE(op.t9,0)+
                            COALESCE(op.t10,0))
                            - SUM(rtp.cantidad)
                            - COALESCE(MAX(
                                COALESCE(baja.t1,0)+COALESCE(baja.t2,0)+COALESCE(baja.t3,0)+
                                COALESCE(baja.t4,0)+COALESCE(baja.t5,0)+COALESCE(baja.t6,0)+
                                COALESCE(baja.t7,0)+COALESCE(baja.t8,0)+COALESCE(baja.t9,0)+
                                COALESCE(baja.t10,0)
                            ),0)
                        ) AS total
                    FROM ordenes_productos op
                    JOIN recepciones r
                        ON r.idOrden = op.idOrden
                    JOIN recepciones_talles_producto rtp
                        ON  rtp.idRecepcion  = r.id
                        AND rtp.idProducto   = op.idProducto
                        AND rtp.idLineaTalle = op.idLineaTalle
                    LEFT JOIN ordenes_productos_bajas baja
                        ON  baja.idOrden      = op.idOrden
                        AND baja.idProducto   = op.idProducto
                        AND baja.idLineaTalle = op.idLineaTalle
                    WHERE op.idOrden = ?
                    GROUP BY
                        op.idProducto, op.idLineaTalle, op.talles,
                        op.t1, op.t2, op.t3, op.t4, op.t5,
                        op.t6, op.t7, op.t8, op.t9, op.t10

                    UNION ALL

                    -- BLOQUE 4: BAJAS (después del pendiente)
                    SELECT
                        opb.idProducto, opb.idLineaTalle, op.talles,
                        4 AS orden_bloque,
                        CONCAT('BAJA - ', COALESCE(opb.obs, '')) AS tipo,
                        opb.fechaBaja AS fecha,
                        opb.usuarioBaja AS usuario,
                        NULL AS idRecepcion,
                        opb.t1, opb.t2, opb.t3, opb.t4, opb.t5,
                        opb.t6, opb.t7, opb.t8, opb.t9, opb.t10,
                        COALESCE(opb.t1,0)+COALESCE(opb.t2,0)+COALESCE(opb.t3,0)+
                        COALESCE(opb.t4,0)+COALESCE(opb.t5,0)+COALESCE(opb.t6,0)+
                        COALESCE(opb.t7,0)+COALESCE(opb.t8,0)+COALESCE(opb.t9,0)+
                        COALESCE(opb.t10,0) AS total
                    FROM ordenes_productos_bajas opb
                    JOIN ordenes_productos op
                        ON  op.idOrden      = opb.idOrden
                        AND op.idProducto   = opb.idProducto
                        AND op.idLineaTalle = opb.idLineaTalle
                    WHERE opb.idOrden = ?

                    UNION ALL

                    -- BLOQUE 5: RECEPCIONES cronológicas
                    SELECT
                        op.idProducto, op.idLineaTalle, op.talles,
                        5 AS orden_bloque,
                        CONCAT('RECEPCION #', r.id) AS tipo,
                        r.fecha, r.usuario, r.id AS idRecepcion,
                        SUM(CASE WHEN rtp.talle='t1'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t2'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t3'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t4'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t5'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t6'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t7'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t8'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t9'  THEN rtp.cantidad ELSE 0 END),
                        SUM(CASE WHEN rtp.talle='t10' THEN rtp.cantidad ELSE 0 END),
                        SUM(rtp.cantidad) AS total
                    FROM ordenes_productos op
                    JOIN recepciones r
                        ON r.idOrden = op.idOrden
                    JOIN recepciones_talles_producto rtp
                        ON  rtp.idRecepcion  = r.id
                        AND rtp.idProducto   = op.idProducto
                        AND rtp.idLineaTalle = op.idLineaTalle
                    WHERE op.idOrden = ?
                    GROUP BY
                        op.idProducto, op.idLineaTalle, op.talles,
                        r.id, r.fecha, r.usuario

                ) AS r
                LEFT JOIN productos p 
                    ON p.id = r.idProducto 
                LEFT JOIN colores c 
                    ON c.id = p.idColor 
                ORDER BY
                    nombreProducto  ASC,
                    color           ASC,
                    orden_bloque    ASC,
                    fecha           ASC;
            `;
            
            const [rows]: any = await connection.query(
            consulta,
            [idOrden, idOrden, idOrden, idOrden, idOrden]
            );
            return rows;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    //#endregion

    //#region ABM
    async Agregar(orden:OrdenIngreso): Promise<string>{
        const connection = await db.getConnection();
        
        try {

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos la orden
            const consulta = "INSERT INTO ordenes_ingreso(idProveedor,corte,fecha,observaciones,usuario,estado,alta) " + 
                             "VALUES(?, ?, ?, ?, ?, ?, NOW())";
            const parametros = [orden.idProveedor, orden.corte, moment(orden.fecha).format('YYYY-MM-DD HH:mm:ss'), orden.observaciones, orden.usuario, orden.estado];
            
            const [result]: any = await connection.query(consulta, parametros);
            orden.id = result.insertId;
            
            //Insertamos los productos de la orden
            for (const prod of orden.productos) {
                prod.idOrden = orden.id;
                InsertProductoOrden(connection, prod);
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

    async Modificar(data:OrdenIngreso): Promise<string>{
        const connection = await db.getConnection();
        
        try {

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Modificamos el cliente
            const consulta = `
                UPDATE ordenes_ingreso 
                SET idProveedor = ?,
                    corte = ?,
                    fecha = ?,
                    observaciones = ?,
                    usuario = ?,
                    actualizacion = NOW(),
                    estado = ?
                WHERE id = ? 
                `;

            const parametros = [data.idProveedor, data.corte, moment(data.fecha).format('YYYY-MM-DD HH:mm:ss'), data.observaciones, data.usuario, data.estado, data.id];
            await connection.query(consulta, parametros);
               
            await connection.query("DELETE FROM ordenes_productos WHERE idOrden = ?", [data.id]);
            for (const prod of data.productos) {
                prod.idOrden = data.id;
                InsertProductoOrden(connection, prod);
            }

            for (const rec of data.recepcionesRevertir) {

                const detalles = await ObtenerDetallesRecepcion(connection, rec.idProducto, rec.idRecepcion);
                for (const det of detalles) {
                    const nroTalle = parseInt(det.talle.replace('t', ''));
                    await ProductosRepo.ActualizarInventarioOrden(connection, det.idProducto, nroTalle, det.cantidad, det.idLineaTalle, "-");
                }
               
                await connection.query("DELETE FROM recepciones_talles_producto WHERE idProducto = ? && idRecepcion = ?", [rec.idProducto, rec.idRecepcion]);
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

    async Eliminar(id:string): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            await connection.query("UPDATE clientes SET fechaBaja = ? WHERE id = ?", [new Date(), id]);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    async ObtenerHistorialRecepciones(idOrden) {
        const connection = await db.getConnection();
        
        try {
            const SQL = `
                SELECT 
                    rt.idRecepcion,
                    rt.idProducto,
                    rt.idLineaTalle,
                    r.fecha,
                    r.usuario,
                    

                    SUM(CASE WHEN rt.talle = 't1' THEN rt.cantidad ELSE 0 END) as XS,
                    SUM(CASE WHEN rt.talle = 't2' THEN rt.cantidad ELSE 0 END) as S,
                    SUM(CASE WHEN rt.talle = 't3' THEN rt.cantidad ELSE 0 END) as M,
                    SUM(CASE WHEN rt.talle = 't4' THEN rt.cantidad ELSE 0 END) as L,
                    SUM(CASE WHEN rt.talle = 't5' THEN rt.cantidad ELSE 0 END) as XL,
                    SUM(CASE WHEN rt.talle = 't6' THEN rt.cantidad ELSE 0 END) as XXL,
                    SUM(CASE WHEN rt.talle = 't7' THEN rt.cantidad ELSE 0 END) as 3XL,
                    SUM(CASE WHEN rt.talle = 't8' THEN rt.cantidad ELSE 0 END) as 4XL,
                    SUM(CASE WHEN rt.talle = 't9' THEN rt.cantidad ELSE 0 END) as 5XL,
                    SUM(CASE WHEN rt.talle = 't10' THEN rt.cantidad ELSE 0 END) as 6XL,

                    SUM(rt.cantidad) as total

                FROM recepciones r
                INNER JOIN recepciones_talles_producto rt ON rt.idRecepcion = r.id
                WHERE r.idOrden = ?
                GROUP BY rt.idRecepcion, rt.idProducto, rt.idLineaTalle, r.fecha, r.usuario
                ORDER BY fecha DESC;
            `;

            const [rows] = await connection.query(SQL, [idOrden]) as any;

            const map: { [idProducto: number]: any[] } = {};

            rows.forEach(r => {
                // Normalizar números
                Object.keys(r).forEach(k => {
                    if (!isNaN(Number(r[k]))) {
                    r[k] = Number(r[k]);
                    }
                });

                const idProducto = r.idProducto;
                // Inicializar array si no existe
                if (!map[idProducto]) {
                    map[idProducto] = [];
                }

                // Sacar idProducto del objeto interno
                const { idProducto: _, ...rest } = r;
                map[idProducto].push(rest);
            });


            // Ordenar por fecha DESC (más reciente primero)
            Object.keys(map).forEach(id => {
                map[Number(id)].sort((a, b) => 
                    new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
                );
            });

            return map;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async AgregarRecepcion(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos la cabecera
            const consulta = "INSERT INTO recepciones(usuario, idOrden) " + 
                             "VALUES(?, ?)";
            const parametros = [data.usuario, data.idOrden];
            const [result]: any = await connection.query(consulta, parametros);
            
            //Insertamos los detalles de la recepcion
            for (const item of data.detalles) {
                item.idRecepcion = result.insertId;
                InsertDetalleRecepcion(connection, item);

                const nroTalle = parseInt(item.talle.replace('t', ''));
                await ProductosRepo.ActualizarInventarioOrden(connection, item.idProducto, nroTalle, item.cantidad, item.idLineaTalle, "+");
            }

            //Marcamos las bajas
            for (const item of data.bajas) {
                const sql = `
                INSERT INTO ordenes_productos_bajas 
                    (idOrden, idProducto, idLineaTalle, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, talles, obs, usuarioBaja)
                VALUES 
                    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const parametros = [
                data.idOrden,
                item.idProducto,
                item.idLineaTalle ?? null,
                item.t1 ?? 0,
                item.t2 ?? 0,
                item.t3 ?? 0,
                item.t4 ?? 0,
                item.t5 ?? 0,
                item.t6 ?? 0,
                item.t7 ?? 0,
                item.t8 ?? 0,
                item.t9 ?? 0,
                item.t10 ?? 0,
                item.talles ?? null,
                item.obsBaja,
                data.usuario
                ];

                await connection.query(sql, parametros);
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
        if(filtros.id && filtros.id != 0){
            filtro += " AND oi.id = " + filtros.id;
        }
        if(filtros.nroOrden && filtros.nroOrden != 0){
            filtro += " AND oi.id = " + filtros.nroOrden;
        }

        if(filtros.nroCorte && filtros.nroCorte != 0){
            filtro += " AND oi.corte = " + filtros.nroCorte;
        }
        if(filtros.estado && filtros.estado != ''){
            filtro += " AND oi.estado = '" + filtros.estado + "'";
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
        query = 
            count +
            " SELECT oi.*, " +
            " (SELECT r.fecha FROM recepciones r WHERE r.idOrden = oi.id ORDER BY r.fecha DESC LIMIT 1) as actualizacion " +
            " FROM ordenes_ingreso oi " +
            " WHERE 1 = 1 " +
            filtro +
            " ORDER BY oi.id DESC " +
            paginado +
            endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

//#region DETALLE ORDEN
async function InsertProductoOrden(connection, producto):Promise<void>{
    try {
        const consulta = " INSERT INTO ordenes_productos(idOrden, idProducto, idLineaTalle, cantidad, talles, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

        const parametros = [producto.idOrden, producto.idProducto, producto.idLineaTalle, producto.cantidad, producto.tallesSeleccionados, producto.t1, producto.t2, producto.t3, producto.t4, producto.t5, producto.t6, producto.t7, producto.t8, producto.t9, producto.t10];
        await connection.query(consulta, parametros);
    } catch (error) {
        throw error; 
    }
}

async function InsertDetalleRecepcion(connection, detalle):Promise<void>{
    try {
        const consulta = " INSERT INTO recepciones_talles_producto(idRecepcion,idProducto,idLineaTalle,talle,cantidad,original) " +
                         " VALUES(?, ?, ?, ?, ?, ?)";

        const parametros = [detalle.idRecepcion, detalle.idProducto, detalle.idLineaTalle, detalle.talle, detalle.cantidad, detalle.original];
        await connection.query(consulta, parametros);
    } catch (error) {
        throw error; 
    }
}

async function ObtenerProductosOrden(connection, idOrden:number, unico:boolean = false){
    try {
        let totalOrdenOriginal = 0;
        let totalOrdenRecibido = 0;

        const consulta = "SELECT op.*, p.codigo, p.nombre, c.id idColor, c.descripcion color, c.hexa FROM ordenes_productos op " + 
                         "INNER JOIN productos p ON p.id = op.idProducto " + 
                         "INNER JOIN colores c ON c.id = p.idColor " +
                         "WHERE op.idOrden = ? ";
        const [rows] = await connection.query(consulta, [idOrden]);

        const productos:ProductoOrden[] = [];

        const [recepciones] = await connection.query(`
            SELECT 
                rt.idProducto,
                rt.talle,
                SUM(rt.cantidad) as recibido
            FROM recepciones_talles_producto rt
            INNER JOIN recepciones r ON r.id = rt.idRecepcion
            WHERE r.idOrden = ?
            GROUP BY rt.idProducto, rt.talle
        `, [idOrden]);

        const recepcionMap = new Map<string, number>();
        if (Array.isArray(recepciones)) {
            recepciones.forEach((r: any) => {
                const key = `${r.idProducto}_${r.talle}`;
                recepcionMap.set(key, r.recibido);
            });
        }

        const [bajas] = await connection.query(`
            SELECT 
                idProducto,
                t1, t2, t3, t4, t5, t6, t7, t8, t9, t10,
                obs, usuarioBaja, fechaBaja      
            FROM ordenes_productos_bajas
            WHERE idOrden = ?
        `, [idOrden]);

        const bajasMap = new Map<number, any>();
        if (Array.isArray(bajas)) {
            bajas.forEach((b: any) => {
                bajasMap.set(b.idProducto, b);
            });
        }

        
        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                const baja = bajasMap.get(row['idProducto']);

                const restar = (campo: string, valor: number) => {
                    const original = isNaN(valor) ? 0 : valor;
                    const bajaCantidad = baja?.[campo] ?? 0;
                    return Math.max(0, original - bajaCantidad);
                };

                let producto:ProductoOrden = new ProductoOrden();
                producto.id = row['id'];
                producto.idProducto = row['idProducto'];
                producto.codProducto = row['codigo'];
                producto.nomProducto = row['nombre'];
                producto.cantidad = row['cantidad'];
                producto.idLineaTalle = row['idLineaTalle'];
                producto.stockAplicado = row['stockAplicado'];
                producto.t1  = restar('t1',  parseInt(row['t1']) || 0);
                producto.t2  = restar('t2',  parseInt(row['t2']) || 0);
                producto.t3  = restar('t3',  parseInt(row['t3']) || 0);
                producto.t4  = restar('t4',  parseInt(row['t4']) || 0);
                producto.t5  = restar('t5',  parseInt(row['t5']) || 0);
                producto.t6  = restar('t6',  parseInt(row['t6']) || 0);
                producto.t7  = restar('t7',  parseInt(row['t7']) || 0);
                producto.t8  = restar('t8',  parseInt(row['t8']) || 0);
                producto.t9  = restar('t9',  parseInt(row['t9']) || 0);
                producto.t10 = restar('t10', parseInt(row['t10']) || 0);
                producto.tallesSeleccionados = row['talles'];
                producto.color = row['color'];
                producto.hexa = row['hexa'];

                if (baja) {
                    baja.total = [baja.t1, baja.t2, baja.t3, baja.t4, baja.t5,
                                baja.t6, baja.t7, baja.t8, baja.t9, baja.t10]
                                .reduce((acc, val) => acc + (val ?? 0), 0);
                }

                producto.baja = baja ?? null;

                producto.codigosBarra = await ObtenerCodigosBarraProducto(connection, producto.idProducto!);
                
                let totalOriginal = 0;
                let totalRecibido = 0;

                for (let iTalle = 1; iTalle <= 10; iTalle++) {
                    
                    const key = `t${iTalle}`;

                    const original = Number(row[key] ?? 0);
                    const recibido = Number(recepcionMap.get(`${producto.idProducto}_${key}`) ?? 0);
                    const bajaCantidad = baja?.[key] ?? 0;
                    const originalNeto = Math.max(0, original - bajaCantidad);

                    totalOriginal += originalNeto;
                    totalRecibido += recibido;

                    totalOrdenOriginal += originalNeto;
                    totalOrdenRecibido += recibido;

                    if(!unico){
                        const bajaCantidad = baja?.[key] ?? 0;
                        producto[key] = Math.max(0, original - recibido - bajaCantidad); 
                    }
                }

                const tieneBaja = bajasMap.has(producto.idProducto!);
                if (tieneBaja) producto.estado = 'Incompleto';
                else if (totalRecibido === 0) producto.estado = 'Pendiente';
                else if (totalRecibido < totalOriginal) producto.estado = 'Parcial';
                else producto.estado = 'Ingresado';

                productos.push(producto);
            }
        }

        let estadoOrden = 'Nueva';

        const hayBajas = bajas && Array.isArray(bajas) && (bajas as any[]).length > 0;

        if (totalOrdenRecibido === 0 && !hayBajas) {
            estadoOrden = 'Nueva';
        } else if (hayBajas && totalOrdenRecibido === 0) {
            estadoOrden = 'Incompleta';
        } else if (totalOrdenRecibido < totalOrdenOriginal) {
            estadoOrden = 'Pendiente';
        } else if (hayBajas) {
            estadoOrden = 'Incompleta';
        } else {
            estadoOrden = 'Finalizada';
        }
 
        return {
            productos,
            estado: estadoOrden,
            totalOriginal: totalOrdenOriginal,
            totalRecibido: totalOrdenRecibido
        };

    } catch (error) {
        throw error; 
    }
}
async function ObtenerCodigosBarraProducto(connection, idProducto:number){
    try {
        const consulta = "SELECT codigo_barra, t.descripcion talle FROM talles_producto tp " + 
                         "INNER JOIN talles t ON t.descripcion = tp.talle " +
                         "WHERE idProducto = ? "
                         "ORDER BY t.posicion ASC ";
                         ;
        const [rows] = await connection.query(consulta, [idProducto]);
        return [rows][0]
        
    } catch (error) {
        throw error; 
    }
}

async function ObtenerDetallesRecepcion(connection, idProducto:number, idRecepcion:number){
    try {
        let consulta = `
            SELECT idProducto, talle, idLineaTalle, cantidad
            FROM recepciones_talles_producto
            WHERE idProducto = ? AND idRecepcion = ?
        `
        const rows = await connection.query(consulta, [idProducto, idRecepcion]);
        return rows[0];
    } catch (error:any) {
        throw error;
    } 
}

//#endregion

export const OrdenesRepo = new OrdenIngresoRepository();





