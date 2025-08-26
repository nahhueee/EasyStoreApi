import moment from 'moment';
import db from '../db';
import { Producto, TablaProducto } from '../models/Producto';
import { Proceso } from '../models/Proceso';
import { Material } from '../models/Material';
import { Genero } from '../models/Genero';
import { Color } from '../models/Color';
import { TipoProducto } from '../models/TipoProducto';
import { SubtipoProducto } from '../models/SubtipoProducto';
import { TallesProducto } from '../models/TallesProducto';

class ProductosRepository{

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

            const productos:TablaProducto[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let tablaProducto: TablaProducto = new TablaProducto();
                    tablaProducto.id = row['id'],
                    tablaProducto.codigo = row['codigo'],
                    tablaProducto.nombre = row['nombre'],
                    tablaProducto.moldeleria = row['moldeleria'],
                    tablaProducto.imagen = row['imagen'],
                    tablaProducto.proceso = row['proceso'];
                    tablaProducto.abrevProceso = row['abrevProceso'];
                    tablaProducto.material = row['material'];
                    tablaProducto.genero = row['genero'];
                    tablaProducto.color = row['color'];
                    tablaProducto.hexa = row['hexa'];
                    tablaProducto.tipo = row['tipo'];
                    tablaProducto.subtipo = row['subtipo'];
                    tablaProducto.t1 = row['t1'];
                    tablaProducto.t2 = row['t2'];
                    tablaProducto.t3 = row['t3'];
                    tablaProducto.t4 = row['t4'];
                    tablaProducto.t5 = row['t5'];
                    tablaProducto.t6 = row['t6'];
                    tablaProducto.t7 = row['t7'];
                    tablaProducto.t8 = row['t8'];
                    tablaProducto.t9 = row['t9'];
                    tablaProducto.t10 = row['t10'];

                    tablaProducto.total = parseInt(tablaProducto.t1) + parseInt(tablaProducto.t2) +
                                          parseInt(tablaProducto.t3) + parseInt(tablaProducto.t4) +
                                          parseInt(tablaProducto.t5) + parseInt(tablaProducto.t6) +
                                          parseInt(tablaProducto.t7) + parseInt(tablaProducto.t8) +
                                          parseInt(tablaProducto.t9) + parseInt(tablaProducto.t10);


                    productos.push(tablaProducto);
                }
            }

            return {total:resultado[0][0].total, registros:productos};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerUno(filtros:any){
        const connection = await db.getConnection();

        try {
            let consulta = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta);

            if (Array.isArray(rows)) {
                let resultado:Producto = new Producto();

                const row = rows[0];
                resultado = await this.CompletarObjeto(row);
                return resultado;
            }

            return null;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async CompletarObjeto(row){
        let producto:Producto = new Producto();
        producto.id = row['id'],
        producto.codigo = row['codigo'],
        producto.nombre = row['nombre'],
        producto.moldeleria = row['moldeleria'],
        producto.imagen = row['imagen'],
        producto.proceso = new Proceso({id: row['idProceso'], descripcion: row['proceso']});
        producto.material = new Material({id: row['idMaterial'], descripcion: row['material']});
        producto.genero = new Genero({id: row['idGenero'], descripcion: row['genero'], abreviatura: row['abreviatura']});
        producto.color = new Color({id: row['idColor'], descripcion: row['color'], hexa: row['hexa']});
        producto.tipo = new TipoProducto({id: row['idTipo'], descripcion: row['tipo']});
        producto.subtipo = new SubtipoProducto({id: row['idSubtipo'], descripcion: row['subtipo']});
        producto.talles = await ObtenerTallesProducto(producto.id);

        return producto;
    }

    //Busca los productos segun lo que digite el usuario
    //en la ventana de nueva venta
    async BuscarProductos(filtro:any){
        const connection = await db.getConnection();

        try {
            let consulta = 'SELECT id, codigo, nombre, costo, precio, unidad FROM productos WHERE id <> 1 AND soloPrecio = 0 ';

            if (filtro.metodo == 'codigo')
                consulta += " AND codigo = '" + filtro.valor + "'";

            if (filtro.metodo == 'nombre')
                consulta += " AND LOWER(nombre) LIKE '%" + filtro.valor + "%'";

            const [rows] = await connection.query(consulta);

            const productos:Producto[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let producto:Producto = new Producto();
                    
                    productos.push(producto);
                  }
            }

            return productos;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    async Agregar(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            let existe = await ValidarExistencia(connection, data, false);
            if(existe)//Verificamos si ya existe un producto con el mismo codigo
                return "Ya existe un producto con el mismo código.";
            
            const consulta = `INSERT INTO productos(
                                codigo,nombre,idProceso,idTipo,idSubtipo,
                                idGenero,idMaterial,idColor,moldeleria,imagen)
                              VALUES(?,?,?,?,?,?,?,?,?,?)`;

            const parametros = [data.codigo.toUpperCase(),
                                data.nombre.toUpperCase(),
                                data.proceso.id,
                                data.tipo.id,
                                data.subtipo.id,
                                data.genero.id,
                                data.material.id,
                                data.color.id,
                                data.moldeleria,
                                data.imagen
                            ];
            
            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Modificar(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            let existe = await ValidarExistencia(connection, data, true);
            if(existe)//Verificamos si ya existe un producto con el mismo codigo
                return "Ya existe un producto con el mismo código.";
            
            const consulta = `UPDATE productos SET
                                codigo = ?,
                                nombre = ?,
                                idProceso = ?,
                                idTipo = ?,
                                idSubtipo = ?,
                                idGenero = ?,
                                idMaterial = ?,
                                idColor = ?,
                                moldeleria = ?,
                                imagen = ?
                                WHERE id = ?`;

            const parametros = [data.codigo.toUpperCase(),
                                data.nombre.toUpperCase(),
                                data.proceso.id,
                                data.tipo.id,
                                data.subtipo.id,
                                data.genero.id,
                                data.material.id,
                                data.color.id,
                                data.moldeleria,
                                data.imagen,
                                data.id];

            await connection.query(consulta, parametros);
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
            let consulta = " UPDATE productos " +
                           " SET fechaBaja = ? " +
                           " WHERE id = ?";

            await connection.query(consulta, [new Date(), id]);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async AniadirCantidad(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            const consulta = `UPDATE productos SET
                              cantidad = ?
                              WHERE id = ?`;

            const parametros = [data.cant,data.idProducto];

            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ActualizarImagen(data:any): Promise<string>{
        const connection = await db.getConnection();
        try {
            const consulta = `UPDATE productos SET
                              imagen = ?
                              WHERE id = ?`;

            const parametros = [data.imagen, data.idProducto];

            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //#endregion

    //#region ACTUALIZAR PRECIOS
    async ActualizarPrecioPorcentaje(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            const consulta = " UPDATE productos " +
                             " SET " +
                             "     costo = ?, " +
                             "     precio = ?, " +
                             "     redondeo = ?, " +
                             "     porcentaje = ?, " +
                             "     tipoPrecio = '%' " +
                             " WHERE id = ?";

            const parametros = [data.costo,
                                data.precio,
                                data.redondeo,
                                data.porcentaje,
                                data.id];

            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ActualizarPrecioFijo(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            const consulta = " UPDATE productos " +
                             " SET " +
                             "     costo = ?, " +
                             "     precio = ?, " +
                             "     tipoPrecio = '$' " +
                             " WHERE id = ?";

            const parametros = [data.costo,
                                data.precio,
                                data.id];

            await connection.query(consulta, parametros);
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
        let orden:string = "";
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.busqueda != null && filtros.busqueda != "") 
            filtro += " AND (p.nombre LIKE '%"+ filtros.busqueda + "%' OR p.codigo LIKE '%" + filtros.busqueda + "%')";
        if (filtros.codigo != null && filtros.codigo != "") 
            filtro += " AND (p.codigo = "+ filtros.codigo + ")";
        // #endregion

        // #region ORDENAMIENTO
        if (filtros.orden != null && filtros.orden != ""){
            orden += " ORDER BY p."+ filtros.orden + " " + filtros.direccion;
        }
        else{
            orden += " ORDER BY p.id DESC";
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
                " SELECT p.*, pro.descripcion proceso, pro.abreviatura abrevProceso, tp.descripcion tipo, stp.descripcion subtipo, " +
                " g.abreviatura genero, g.abreviatura, c.descripcion color, c.hexa, m.descripcion material, " +
                
                // PIVOT de talles
                "SUM(CASE WHEN pt.talle = 't1' THEN pt.cantidad ELSE 0 END) AS t1," +
                "SUM(CASE WHEN pt.talle = 't2'  THEN pt.cantidad ELSE 0 END) AS t2," +
                "SUM(CASE WHEN pt.talle = 't3'  THEN pt.cantidad ELSE 0 END) AS t3," +
                "SUM(CASE WHEN pt.talle = 't4'  THEN pt.cantidad ELSE 0 END) AS t4," +
                "SUM(CASE WHEN pt.talle = 't5' THEN pt.cantidad ELSE 0 END) AS t5," +
                "SUM(CASE WHEN pt.talle = 't6' THEN pt.cantidad ELSE 0 END) AS t6," +
                "SUM(CASE WHEN pt.talle = 't7' THEN pt.cantidad ELSE 0 END) AS t7," +
                "SUM(CASE WHEN pt.talle = 't8' THEN pt.cantidad ELSE 0 END) AS t8," +
                "SUM(CASE WHEN pt.talle = 't9' THEN pt.cantidad ELSE 0 END) AS t9," +
                "SUM(CASE WHEN pt.talle = 't10' THEN pt.cantidad ELSE 0 END) AS t10" +

                " FROM productos p " +
                " LEFT JOIN procesos pro ON pro.id = p.idProceso " +
                " LEFT JOIN tipos_producto tp ON tp.id = p.idTipo " +
                " LEFT JOIN subtipos_producto stp ON stp.id = p.idSubtipo " +
                " LEFT JOIN generos g ON g.id = p.idGenero " +
                " LEFT JOIN colores c ON c.id = p.idColor " +
                " LEFT JOIN materiales m ON m.id = p.idMaterial " +
                " LEFT JOIN talles_producto pt ON pt.idProducto = p.id " +
                " WHERE p.fechaBaja IS NULL AND p.id <> 1 " +
                " GROUP BY p.id, p.nombre, p.codigo, p.idProceso, p.idTipo, " +
                " p.idSubtipo, p.idGenero, p.idColor, p.idMaterial, " +
                " pro.descripcion, tp.descripcion, stp.descripcion, " +
                " g.descripcion, g.abreviatura, c.descripcion, c.hexa, m.descripcion " +
                filtro +
                orden +
                paginado +
                endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ObtenerTallesProducto(idProducto:number):Promise<any>{
    const connection = await db.getConnection();
    try {
        const consulta = " SELECT tp.cantidad, tp.costo, tp.precio, tp.talle, tp.idLineaTalle  " +
                         " FROM talles_producto tp " +
                         " WHERE tp.id = ? ";

        const [rows] = await connection.query(consulta,[idProducto]);
       
        const tallesProducto:TallesProducto[] = [];
           
        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                tallesProducto.push(new TallesProducto({
                    cantidad: row['cantidad'],
                    costo: row['costo'],
                    precio: row['precio'],
                    talle: row['talle'],
                    idLineaTalle: row['idLineaTalle']
                }));
            }
        }

        return tallesProducto;

    } catch (error) {
        throw error; 
    } finally{
        connection.release();
    }
    
}

async function ValidarExistencia(connection, data:any, modificando:boolean):Promise<any>{
    try {
        let consulta = " SELECT id FROM productos WHERE fechaBaja IS NOT NULL AND codigo = ? ";
        if(modificando) consulta += " AND id <> ? ";
        const parametros = [data.codigo.toUpperCase(), data.id];
        const rows = await connection.query(consulta,parametros);

        if(rows[0].length > 0) return true;
        
        return false;
        
    } catch (error) {
        throw error; 
    }
}

export const ProductosRepo = new ProductosRepository();