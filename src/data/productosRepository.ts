import db from '../db';
import { Color, ExcelProducto, Genero, Material, Producto, SubtipoProducto, TablaProducto, TallesProducto, Temporada, TipoProducto } from '../models/Producto';
import { ProductoPresupuesto } from '../models/ProductoPresupuesto';
import { MiscRepo } from './miscRepository';

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

            if (filtros.desdeFacturacion) {
                const productos: Producto[] = [];
                if (Array.isArray(rows)) {
                    for (const row of rows) {
                        const prod = await this.CompletarObjeto(row);
                        productos.push(prod);
                    }
                }
                return { total: resultado[0][0].total, registros: productos };
            } else {
                const productos: TablaProducto[] = [];
                if (Array.isArray(rows)) {
                    for (const row of rows) {
                        const prod = new TablaProducto(row);
                        productos.push(prod);
                    }
                }
                return { total: resultado[0][0].total, registros: productos };
            }

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //Busca los productos segun lo que digite el usuario
    //en la ventana de nueva venta
    async BuscarProductos(filtro:string){
        const connection = await db.getConnection();

        try {
            let consulta = await ObtenerQuery({busqueda: filtro},false);
            const [rows] = await connection.query(consulta);

            const productos:Producto[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    let producto:Producto = new Producto();
                    producto = await this.CompletarObjeto(row);
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

    async ObtenerUno(filtros:any){
        const connection = await db.getConnection();

        try {
            let consulta = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta);

            if (Array.isArray(rows)) {
                let resultado:Producto = new Producto();

                const row = rows[0][0];
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

    async ObtenerParaExcel(filtros:any){
       const connection = await db.getConnection();
        
        try {
             //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQuery(filtros,false,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);

            const productos:ExcelProducto[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    

                    let tablaProducto: ExcelProducto = new ExcelProducto();
                    tablaProducto.Codigo = row['codigo'],
                    tablaProducto.Nombre = row['nombre'],
                    tablaProducto.Proceso = row['proceso'];
                    tablaProducto.Material = row['material'];
                    tablaProducto.Genero = row['genero'];
                    tablaProducto.Color = row['color'];
                    tablaProducto.Producto = row['tipo'];
                    tablaProducto.Tipo = row['subtipo'];

                    const factor = tablaProducto.Proceso === "PEDIDOS APROBADOS" ? -1 : 1;

                    tablaProducto.XS   = parseInt(row['t1'])  * factor;
                    tablaProducto.S    = parseInt(row['t2'])  * factor;
                    tablaProducto.M    = parseInt(row['t3'])  * factor;
                    tablaProducto.L    = parseInt(row['t4'])  * factor;
                    tablaProducto.XL   = parseInt(row['t5'])  * factor;
                    tablaProducto.XXL  = parseInt(row['t6'])  * factor;
                    tablaProducto['3XL'] = parseInt(row['t7']) * factor;
                    tablaProducto['4XL'] = parseInt(row['t8']) * factor;
                    tablaProducto['5XL'] = parseInt(row['t9']) * factor;
                    tablaProducto['6XL'] = parseInt(row['t10']) * factor;

                    const columnas = ['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10'];
                    tablaProducto.Total = columnas.reduce((acc, col) => acc + parseInt(row[col] || '0') * factor, 0);

                    productos.push(tablaProducto);
                }
            }

            return productos;

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
        producto.empresa = row['empresa'],
        producto.cliente = row['idCliente'],
        producto.proceso = row['idProceso'];
        producto.moldeleria = row['moldeleria'];
        producto.imagen = row['imagen'];

        producto.tipo = new TipoProducto({
            id: row['idTipo'],
            descripcion: row['tipo']
        });
        producto.subtipo = new SubtipoProducto({
            id: row['idSubTipo'],
            descripcion: row['subtipo']
        })
        producto.genero = new Genero({
            id: row['idGenero'],
            descripcion: row['genero']
        })
        producto.temporada = new Temporada({
            id: row['idTemporada'],
            descripcion: row['temporada'],
            abreviatura: row['abrevTemporada']
        })
        producto.material = new Material({
            id: row['idMaterial'],
            descripcion: row['material']
        })
        producto.color = new Color({
            id: row['idColor'],
            descripcion: row['color'],
            hexa: row['hexa']
        })

        producto.talles = await ObtenerTallesProducto(producto.id);
        producto.colores = await ObtenerColoresProducto(producto.id);

        return producto;
    }

    async ObtenerProductosPresupuesto(filtros:any){
        const connection = await db.getConnection();
        
        try {
            //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQueryProdPresupuesto(filtros,false);
            let queryTotal = await ObtenerQueryProdPresupuesto(filtros,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            return {total:resultado[0][0].total, registros:[rows][0]};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async BuscarProductosPresupuesto(filtro:string){
        const connection = await db.getConnection();

        try {
            let consulta = await ObtenerQueryProdPresupuesto(filtro,false);
            const [rows] = await connection.query(consulta);

            const productos:ProductoPresupuesto[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    let producto:ProductoPresupuesto = new ProductoPresupuesto();
                    producto.id = row['id'];
                    producto.codigo = row['codigo'];
                    producto.nombre = row['nombre'];
                    producto.sugerido = row['sugerido'];
                    
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

    async ObtenerStockDisponiblePorProducto(idProducto) {
        const tallesProducto = await ObtenerTallesProducto(idProducto);

        // Traer todas las ventas del producto
        const [ventas] = await db.query(
            `SELECT t1, t2, t3, t4, t5, t6, t7, t8, t9, t10 
            FROM ventas_productos vp
            INNER JOIN ventas v ON vp.idVenta = v.id
            WHERE vp.idProducto = ? AND v.idProceso = 6`,
            [idProducto]
        );

        const lineaTalle = await MiscRepo.ObtenerLineaDeTalle(tallesProducto[0].idLineaTalle);
        
        const vendido: Record<string, number> = {};
        // Inicializar todos los talles de la línea en 0
        lineaTalle.talles.forEach((t: string) => vendido[t] = 0);

        // Recorrer cada venta (t1..t10)
        if (Array.isArray(ventas)) {
            for (const v of ventas) {
                for (let i = 0; i < lineaTalle.talles.length; i++) {
                    const talleReal = lineaTalle.talles[i];
                    const col = `t${i + 1}`;
                    const valor = Number(v[col] ?? 0);
                    vendido[talleReal] += valor;
                }
            }
        }

        // Actualizar los tallesProducto usando lo vendido
        const salida = tallesProducto.map(tp => {
            const talle = tp.talle;
            const cantVendida = vendido[talle] ?? 0;
            const disponible = tp.cantidad - cantVendida;

            return {
                ...tp,
                vendido: cantVendida,
                disponible: disponible < 0 ? 0 : disponible
            };
        });

        return salida;
    }
    //#endregion

    //#region ABM
    async Agregar(producto:Producto): Promise<string>{
        const connection = await db.getConnection();

        try {
            let existe = await ValidarExistencia(connection, producto, false);
            if(existe)//Verificamos si ya existe un producto con el mismo codigo
                return "Ya existe un producto con el mismo código.";

            //Obtenemos el proximo nro de producto a insertar
            producto.id = await ObtenerUltimoProducto(connection);

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //#region Insert Producto
            const consulta = `INSERT INTO productos(
                                codigo,nombre,empresa,idCliente,idProceso,idTipo,idSubtipo,
                                idGenero,idTemporada,idMaterial,idColor,moldeleria)
                              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`;

            const parametros = [producto.codigo!.toUpperCase(),
                                producto.nombre!.toUpperCase(),
                                producto.empresa,
                                producto.cliente,
                                producto.proceso,
                                producto.tipo,
                                producto.subtipo,
                                producto.genero,
                                producto.temporada,
                                producto.material,
                                producto.color?.id!,
                                producto.moldeleria
                            ];
            
            await connection.query(consulta, parametros);
            //#endregion

            //Insertamos los talles del producto
            for (const element of  producto.talles!) {
                element.idProducto = producto.id;
                InsertTalleProducto(connection, element);
            };

            //Insertamos los colores del producto
            for (const element of  producto.colores!) {
                InsertColorProducto(connection, element.id!, producto.id);
            };
            
            //Mandamos la transaccion
            await connection.commit();
            return "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }

    async Modificar(producto:Producto): Promise<string>{
        const connection = await db.getConnection();

        try {
            let existe = await ValidarExistencia(connection, producto, true);
            if(existe)//Verificamos si ya existe un producto con el mismo codigo
                return "Ya existe un producto con el mismo código.";

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //#region Insert Producto
            const consulta = `UPDATE productos SET
                                codigo = ?,
                                nombre = ?,
                                empresa = ?,
                                idTemporada = ?,
                                idCliente = ?,
                                idProceso = ?,
                                idTipo = ?,
                                idSubtipo = ?,
                                idGenero = ?,
                                idMaterial = ?,
                                idColor = ?,
                                moldeleria = ?
                                WHERE id = ?`;

            const parametros = [producto.codigo!.toUpperCase(),
                                producto.nombre!.toUpperCase(),
                                producto.empresa,
                                producto.temporada,
                                producto.cliente,
                                producto.proceso,
                                producto.tipo,
                                producto.subtipo,
                                producto.genero,
                                producto.material,
                                producto.color?.id,
                                producto.moldeleria,
                                producto.id
                            ];
            
            await connection.query(consulta, parametros);
            //#endregion

            //Borramos talles anteriores
            await connection.query("DELETE FROM talles_producto WHERE idProducto = ?", [producto.id]);

            //Insertamos los talles del producto
            for (const element of  producto.talles!) {
                element.idProducto = producto.id;
                InsertTalleProducto(connection, element);
            };

            //Borramos colores anteriores
            await connection.query("DELETE FROM colores_producto WHERE idProducto = ?", [producto.id]);

            //Insertamos los colores del producto
            for (const element of  producto.colores!) {
                InsertColorProducto(connection, element.id!, producto.id);
            };
            
            //Mandamos la transaccion
            await connection.commit();
            return "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
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

    //#region productos presupuesto
    async AgregarProductoPresupuesto(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            let existe = await ValidarExistencia(connection, data, false);
            if(existe)//Verificamos si ya existe 
                return "Ya existe un producto con el mismo nombre.";
            
            const consulta = "INSERT INTO productos_presupuesto(codigo, nombre, sugerido) VALUES (?,?,?)";
            const parametros = [data.codigo.toUpperCase(), data.nombre.toUpperCase(), data.sugerido];
            
            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ModificarProductoPresupuesto(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            let existe = await ValidarExistencia(connection, data, true);
            if(existe)//Verificamos si ya existe
                return "Ya existe un producto con el mismo nombre.";
            
            const consulta = `UPDATE productos_presupuesto SET 
            codigo = ?,
            nombre = ?,
            sugerido = ?
            WHERE id = ? `;

            const parametros = [data.codigo.toUpperCase(), data.nombre.toUpperCase(), data.sugerido, data.id];
            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async EliminarProductoPresupuesto(id:string): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            await connection.query("DELETE FROM productos_presupuesto WHERE id = ?", [id]);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

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

async function ObtenerQuery(filtros:any,esTotal:boolean,esExcel:boolean = false):Promise<string>{
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
        if (filtros.busqueda != null && filtros.busqueda != "") {
            filtro += " AND (p.nombre LIKE '%"+ filtros.busqueda + "%' OR p.codigo LIKE '%" + filtros.busqueda + "%')";
        }
        if(filtros.proceso != null && filtros.proceso != 0){
            filtro += " AND p.idProceso = " + filtros.proceso + " ";
        }
        if(filtros.tipo != null && filtros.tipo != 0){
            filtro += " AND p.idTipo = " + filtros.tipo + " ";
        }
        if(filtros.subtipo != null && filtros.subtipo != 0){
            filtro += " AND p.idSubtipo = " + filtros.subtipo + " ";
        }
        if(filtros.genero != null && filtros.genero != 0){
            filtro += " AND p.idGenero = " + filtros.genero + " ";
        }
        if(filtros.material != null && filtros.material != 0){
            filtro += " AND p.idMaterial = " + filtros.material + " ";
        }
        // if(filtros.color != null && filtros.color != 0){
        //     filtro += " AND p.idColor = " + filtros.color + " ";
        // }
        if(filtros.temporada != null && filtros.temporada != 0){
            filtro += " AND p.idTemporada = " + filtros.temporada + " ";
        }
        if (filtros.id != null && filtros.id != "") 
            filtro += " AND p.id = "+ filtros.id + "";
        // #endregion

        // #region ORDENAMIENTO
        if (filtros.orden != null && filtros.orden != ""){
            orden += " ORDER BY "+ filtros.orden + " " + filtros.direccion;
        }
        else{
            orden += " ORDER BY p.nombre DESC";
        }    
        // #endregion

        if (esTotal)
        {//Si esTotal agregamos para obtener un total de la consulta
            count = "SELECT COUNT(*) AS total FROM ( ";
            endCount = " ) as subquery";
        }
        else
        {//De lo contrario paginamos
            if(!esExcel){
                if (filtros.tamanioPagina != null)
                    paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
            }
        }
            
        //Arma la Query con el paginado y los filtros correspondientes
        query = count +
                " SELECT p.*, pro.descripcion proceso, pro.abreviatura abrevProceso, tp.descripcion tipo, stp.descripcion subtipo, " +
                " g.descripcion genero, g.abreviatura abrevGenero, m.descripcion material, t.descripcion temporada, t.abreviatura abrevTemporada, " +
                
                // PIVOT de talles
                "SUM(CASE WHEN pt.ubicacion = 0 THEN pt.cantidad ELSE 0 END) AS t1," +
                "SUM(CASE WHEN pt.ubicacion = 1  THEN pt.cantidad ELSE 0 END) AS t2," +
                "SUM(CASE WHEN pt.ubicacion = 2  THEN pt.cantidad ELSE 0 END) AS t3," +
                "SUM(CASE WHEN pt.ubicacion = 3  THEN pt.cantidad ELSE 0 END) AS t4," +
                "SUM(CASE WHEN pt.ubicacion = 4 THEN pt.cantidad ELSE 0 END) AS t5," +
                "SUM(CASE WHEN pt.ubicacion = 5 THEN pt.cantidad ELSE 0 END) AS t6," +
                "SUM(CASE WHEN pt.ubicacion = 6 THEN pt.cantidad ELSE 0 END) AS t7," +
                "SUM(CASE WHEN pt.ubicacion = 7 THEN pt.cantidad ELSE 0 END) AS t8," +
                "SUM(CASE WHEN pt.ubicacion = 8 THEN pt.cantidad ELSE 0 END) AS t9," +
                "SUM(CASE WHEN pt.ubicacion = 9 THEN pt.cantidad ELSE 0 END) AS t10" +

                " FROM productos p " +
                " LEFT JOIN procesos pro ON pro.id = p.idProceso " +
                " LEFT JOIN tipos_producto tp ON tp.id = p.idTipo " +
                " LEFT JOIN subtipos_producto stp ON stp.id = p.idSubtipo " +
                " LEFT JOIN generos g ON g.id = p.idGenero " +
                //" LEFT JOIN colores c ON c.id = p.idColor " +
                " LEFT JOIN materiales m ON m.id = p.idMaterial " +
                " LEFT JOIN talles_producto pt ON pt.idProducto = p.id " +
                " LEFT JOIN temporadas t ON t.id = p.idTemporada " +
                " WHERE p.fechaBaja IS NULL " +
                filtro +
                " GROUP BY p.id, p.nombre, p.codigo, p.idProceso, p.idTipo, " +
                " p.idSubtipo, p.idGenero, p.idColor, p.idMaterial, " +
                " pro.descripcion, tp.descripcion, stp.descripcion, " +
                " g.descripcion, g.abreviatura, m.descripcion, t.descripcion, t.abreviatura " +
                orden +
                paginado +
                endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ObtenerQueryProdPresupuesto(filtros:any,esTotal:boolean):Promise<string>{
    try {
        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

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
            " SELECT * FROM productos_presupuesto " +
            " ORDER BY id DESC" +
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
                         " WHERE tp.idProducto = ? " +
                         " ORDER BY tp.ubicacion ASC";

        const [rows] = await connection.query(consulta,[idProducto]);
        const tallesProducto:TallesProducto[] = [];
           
        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                tallesProducto.push(new TallesProducto({
                    cantidad: row['cantidad'],
                    costo:  parseInt(row['costo']),
                    precio: parseFloat(row['precio']),
                    talle: row['talle'],
                    ubicacion: row['ubicacion'],
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

async function ObtenerColoresProducto(idProducto:number):Promise<any>{
    const connection = await db.getConnection();
    try {
        const consulta = " SELECT cp.idColor, c.descripcion, c.hexa " +
                         " FROM colores_producto cp " +
                         " JOIN colores c ON c.id = cp.idColor " +
                         " WHERE cp.idProducto = ? ";

        const [rows] = await connection.query(consulta,[idProducto]);
        const coloresProducto:Color[] = [];
           
        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                coloresProducto.push(new Color({
                    id: row['idColor'],
                    descripcion: row['descripcion'],
                    hexa: row['hexa']
                }));
            }
        }

        return coloresProducto;

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

async function ValidarExistenciaProductoPresupuesto(connection, data:any, modificando:boolean):Promise<any>{
    try {
        let consulta = " SELECT id FROM productos_presupuesto WHERE nombre = ? ";
        if(modificando) consulta += " AND id <> ? ";
        const parametros = [data.nombre.toUpperCase(), data.id];
        const rows = await connection.query(consulta,parametros);

        if(rows[0].length > 0) return true;
        
        return false;
        
    } catch (error) {
        throw error; 
    }
}

async function ObtenerUltimoProducto(connection):Promise<number>{
    try {
        const rows = await connection.query(" SELECT id FROM productos ORDER BY id DESC LIMIT 1 ");
        let resultado:number = 0;

        if([rows][0][0].length==0){
            resultado = 1;
        }else{
            resultado = rows[0][0].id + 1;
        }

        return resultado;

    } catch (error) {
        throw error; 
    }
}

async function InsertTalleProducto(connection, elemento):Promise<void>{
    try {
        const consulta = " INSERT INTO talles_producto(idProducto, idLineaTalle, talle, ubicacion, cantidad, precio) " +
                         " VALUES(?, ?, ?, ?, ?, ?) ";

        const parametros = [elemento.idProducto, elemento.idLineaTalle, elemento.talle, elemento.ubicacion, elemento.cantidad, elemento.precio];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function InsertColorProducto(connection, idColor, idProducto):Promise<void>{
    try {
        const consulta = " INSERT INTO colores_producto(idColor, idProducto) " +
                         " VALUES(?, ?) ";

        const parametros = [idColor, idProducto];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

export const ProductosRepo = new ProductosRepository();