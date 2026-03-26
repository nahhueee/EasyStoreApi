import moment from 'moment';
import db from '../db';
import { Cliente, DireccionesCliente, UltimoDescuentoCliente } from '../models/Cliente';
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

    async ObtenerOrden(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let consulta = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta);
           
            return await this.CompletarObjeto(connection, rows[0][0]);
        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async CompletarObjeto(connection, row){
        let orden:OrdenIngreso = new OrdenIngreso();
        orden.id = row['id'];
        orden.corte = row['corte'];
        orden.fecha = row['fecha'];
        orden.idProveedor = row['idProveedor'];
        orden.observaciones = row['observaciones'];
        orden.usuario = row['usuario'];
        orden.estado = row['estado'];
        
        orden.productos = await ObtenerProductosOrden(connection, row['id']);
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
                if (prod.estado === "Ingresado") {
                    await ProductosRepo.ActualizarInventario(connection, prod, "+");
                    prod.stockAplicado = 1;
                }

                prod.idOrden = orden.id;
                InsertProductoOrden(connection, prod);
            }
            
            //Mandamos la transaccion
            await connection.commit();
            return "OK";

        } catch (error:any) {
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
               
           
            //#region ACTUALIZAR DETALLE Y STOCK
            const productosDB = await ObtenerProductosOrden(connection, data.id!);
            const mapDB = new Map(productosDB.map(p => [p.id, p]));

            // Recorrer nuevos detalles
            for (const prod of data.productos) {
                const anterior = mapDB.get(prod.id);
                
                if (!anterior) {
                    // NUEVO

                    if (prod.estado === "Ingresado") {
                        await ProductosRepo.ActualizarInventario(connection, prod, "+");
                        prod.stockAplicado = 1;
                    } 
                    
                    prod.idOrden = data.id;
                    await InsertProductoOrden(connection, prod);
                }else{
                    // EXISTENTE

                    // transición a Ingresado
                    if (prod.estado === "Ingresado" && anterior.stockAplicado == 0) {
                        await ProductosRepo.ActualizarInventario(connection, prod, "+");
                        prod.stockAplicado = 1;
                    }

                    // reversión
                    else if (prod.estado !== "Ingresado" && anterior.stockAplicado == 1) {
                        await ProductosRepo.ActualizarInventario(connection, prod, "-");
                        prod.stockAplicado = 0;
                    } 
                    else {
                        prod.stockAplicado = anterior.stockAplicado;
                    }

                    prod.idOrden = data.id;
                    if(prod.estado === "Eliminado")
                        await connection.query("DELETE FROM ordenes_productos WHERE id = ?", [prod.id]);
                    else
                        await UpdateProductoOrden(connection, prod);
                }
            }
            //#endregion
                
            //Mandamos la transaccion
            await connection.commit();
            return "OK";

        } catch (error:any) {
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
        const consulta = " INSERT INTO ordenes_productos(idOrden, idProducto, idLineaTalle, cantidad, talles, estado, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

        const parametros = [producto.idOrden, producto.idProducto, producto.idLineaTalle, producto.cantidad, producto.tallesSeleccionados, producto.estado, producto.t1, producto.t2, producto.t3, producto.t4, producto.t5, producto.t6, producto.t7, producto.t8, producto.t9, producto.t10];
        await connection.query(consulta, parametros);
    } catch (error) {
        throw error; 
    }
}
async function UpdateProductoOrden(connection, producto): Promise<void> {
  const consulta = `
    UPDATE ordenes_productos SET
      cantidad = ?,
      talles = ?,
      estado = ?,
      t1 = ?, t2 = ?, t3 = ?, t4 = ?, t5 = ?,
      t6 = ?, t7 = ?, t8 = ?, t9 = ?, t10 = ?,
      stockAplicado = ?
    WHERE id = ?
  `;

  const parametros = [
    producto.cantidad,
    producto.tallesSeleccionados,
    producto.estado,
    producto.t1,
    producto.t2,
    producto.t3,
    producto.t4,
    producto.t5,
    producto.t6,
    producto.t7,
    producto.t8,
    producto.t9,
    producto.t10,
    producto.stockAplicado,
    producto.id
  ];

  await connection.query(consulta, parametros);
}

async function ObtenerProductosOrden(connection, idOrden:number){
    try {
        const consulta = "SELECT op.*, p.codigo, p.nombre, c.id idColor, c.descripcion color, c.hexa FROM ordenes_productos op " + 
                         "INNER JOIN productos p ON p.id = op.idProducto " + 
                         "INNER JOIN colores c ON c.id = p.idColor " +
                         "WHERE op.idOrden = ? ";
        const [rows] = await connection.query(consulta, [idOrden]);

        const productos:ProductoOrden[] = [];

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
                producto.estado = row['estado'];
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

                productos.push(producto);
            }
        }

        return productos;

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

//#endregion

export const OrdenesRepo = new OrdenIngresoRepository();





