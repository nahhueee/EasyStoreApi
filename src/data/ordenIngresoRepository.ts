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
        orden.actualizacion = row['actualizacion'];
        
        const resultadoProductos = await ObtenerProductosOrden(connection, row['id'], unico);
        orden.productos = resultadoProductos.productos;
        orden.estado = resultadoProductos.estado;

        return orden;
    }

    //#endregion

    //#region ABM
    async Agregar(orden:OrdenIngreso): Promise<string>{
        const connection = await db.getConnection();
        
        try {

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos la orden
            const consulta = "INSERT INTO ordenes_ingreso(idProveedor,corte,fecha,observaciones,usuario,estado,actualizacion) " + 
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

                if(prod.estado != "Eliminado"){
                    InsertProductoOrden(connection, prod);
                }
            }

            for (const rec of data.recepcionesRevertir) {

                const detalle = await ObtenerDetalleRecepcion(connection, rec);
                const nroTalle = parseInt(detalle.talle.replace('t', ''));
                await ProductosRepo.ActualizarInventarioOrden(connection, detalle.idProducto, nroTalle, detalle.cantidad, detalle.idLineaTalle, "-");

                await connection.query("DELETE FROM recepciones_talles_producto WHERE id = ?", [rec]);
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
                    rt.id,
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
                GROUP BY rt.id, rt.idProducto, rt.idLineaTalle, r.fecha, r.usuario
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
        query = count +
            " SELECT oi.* FROM ordenes_ingreso oi " +
            " WHERE 1 = 1 " +
            filtro +
            " ORDER BY fecha DESC" +
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

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let producto:ProductoOrden = new ProductoOrden();
                producto.id = row['id'];
                producto.idProducto = row['idProducto'];
                producto.codProducto = row['codigo'];
                producto.nomProducto = row['nombre'];
                producto.cantidad = row['cantidad'];
                producto.idLineaTalle = row['idLineaTalle'];
                producto.stockAplicado = row['stockAplicado'];
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
                producto.tallesSeleccionados = row['talles'];
                producto.color = row['color'];
                producto.hexa = row['hexa'];
                producto.codigosBarra = await ObtenerCodigosBarraProducto(connection, producto.idProducto!);
                
                let totalOriginal = 0;
                let totalRecibido = 0;

                for (let iTalle = 1; iTalle <= 10; iTalle++) {
                    const key = `t${iTalle}`;

                    const original = Number(row[key] ?? 0);
                    const recibido = Number(recepcionMap.get(`${producto.idProducto}_${key}`) ?? 0);

                    totalOriginal += original;
                    totalRecibido += recibido;

                    totalOrdenOriginal += totalOriginal;
                    totalOrdenRecibido += totalRecibido;

                    if(!unico)
                        producto[key] = original - recibido; 
                }

                if (totalRecibido === 0) producto.estado = 'Pendiente';
                else if (totalRecibido < totalOriginal) producto.estado = 'Parcial';
                else producto.estado = 'Ingresado';
                productos.push(producto);
            }
        }


        let estadoOrden = 'Nueva';
        if (totalOrdenRecibido === 0) {
            estadoOrden = 'Nueva';
        } else if (totalOrdenRecibido < totalOrdenOriginal) {
            estadoOrden = 'Pendiente';
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
        const consulta = "SELECT codigo_barra, t.descripcion talle FROM codigos_barra cb " + 
                         "INNER JOIN talles t ON t.id = CAST(SUBSTRING(cb.codigo_barra, 7, 3) AS UNSIGNED) " +
                         "WHERE idProducto = ? "
                         "ORDER BY t.posicion ASC ";
                         ;
        const [rows] = await connection.query(consulta, [idProducto]);
        return [rows][0]
        
    } catch (error) {
        throw error; 
    }
}

async function ObtenerDetalleRecepcion(connection, id:any){
    try {
        let consulta = `
            SELECT idProducto, talle, idLineaTalle, cantidad
            FROM recepciones_talles_producto
            WHERE id = ?
        `
        const rows = await connection.query(consulta, [id]);
        return rows[0][0];
    } catch (error:any) {
        throw error;
    } 
}

//#endregion

export const OrdenesRepo = new OrdenIngresoRepository();





