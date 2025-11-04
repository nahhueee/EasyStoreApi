import db from '../db';
import { PagosVenta, ProductosVenta, ServiciosVenta, Venta } from '../models/Venta';
import { ObjQR } from '../models/ObjQR';
import { pagoVenta } from '../models/PagoVenta';
const moment = require('moment');

class VentasRepository{

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

    async ObtenerVenta(idVenta){
        const connection = await db.getConnection();

        try {
            let queryRegistros = await ObtenerQuery({idVenta},false);

            //Obtengo la lista de registros y el total
            const rows = await connection.query(queryRegistros);

            return await this.CompletarObjeto(connection, rows[0][0]);
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
        venta.proceso = row['proceso'];
        venta.nroNota = row['ticket'];
        venta.fecha = moment(row['fecha']).toDate();
        venta.hora = row['hora'];
        venta.idCliente = row['idCliente'];
        venta.cliente = row['cliente'];
        venta.idListaPrecio = row['idLista'];
        // venta.listaPrecio = row['listaPrecio'];
        venta.idEmpresa = row['idEmpresa'];
        // venta.empresa = row['empresa'];
        venta.idTipoComprobante = row['idTComprobante'];
        // venta.tipoComprobante = row['tipoComprobante'];
        venta.idTipoDescuento = row['idTDescuento'];
        // venta.tipoDescuento = row['tipoDescuento'];
        venta.descuento = parseInt(row['descuento']);
        venta.codPromocion = row['codPromocion'];
        venta.redondeo = parseFloat(row['redondeo']);
        venta.total = parseFloat(row['total']);

        venta.pagos = await ObtenerPagosVenta(connection, venta.id!);
        venta.servicios = await ObtenerServiciosVenta(connection, venta.id!);
        venta.productos = await ObtenerProductosVenta(connection, venta.id!);

        return venta;
    }
    //#endregion

    //#region ABM
    async Agregar(venta:Venta): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            //Obtenemos el proximo nro de venta a insertar
            venta.id = await ObtenerUltimaVenta(connection);

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos la venta
            await InsertVenta(connection,venta);

            //insertamos los datos del pago de la venta
            if(venta.pagos){
                for (const element of venta.pagos) {
                    element.idVenta = venta.id;
                    await InsertPagoVenta(connection, element);
                }
            }
           
            //insertamos los productos de la venta
            if(venta.productos){
                for (const element of venta.productos) {
                    element.idVenta = venta.id;
                    await InsertProductoVenta(connection, element);
                }
            }
         
            //insertamos los servicios de la venta
            if(venta.servicios){
                for (const element of venta.servicios) {
                    element.idVenta = venta.id;
                    await InsertServicioVenta(connection, element);
                }
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

    async Modificar(venta:Venta): Promise<string>{
        const connection = await db.getConnection();
        
        try {
           
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos la venta
            await UpdateVenta(connection,venta);

            await connection.query("DELETE FROM ventas_pagos WHERE idVenta = ?", [venta.id]);
            //insertamos los datos del pago de la venta
            if(venta.pagos){
                for (const element of venta.pagos) {
                    element.idVenta = venta.id;
                    await InsertPagoVenta(connection, element);
                }
            }
           
            await connection.query("DELETE FROM ventas_productos WHERE idVenta = ?", [venta.id]);
            //insertamos los productos de la venta
            if(venta.productos){
                for (const element of venta.productos) {
                    element.idVenta = venta.id;
                    await InsertProductoVenta(connection, element);
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

    async Eliminar(venta:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            await connection.query("UPDATE ventas SET fechaBaja = ? WHERE id = ?", [moment().format('YYYY-MM-DD HH:mm'), venta.id]);
                        
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
    //#endregion

    //#region OTROS
    async ObtenerQRFactura(idVenta:number){
        const connection = await db.getConnection();

        try {
            const consulta = " SELECT vf.cae, vf.ticket, vf.tipoFactura, vf.neto, vf.iva, vf.dni, vf.tipodni, vf.ptoVenta, v.fecha " +
                             " FROM ventas_factura vf " +
                             " INNER JOIN ventas v on v.id = vf.idVenta " +
                             " WHERE vf.idVenta = ? "

            const [resultado] = await connection.query(consulta, idVenta);
            const row = resultado[0];

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
                codAut : row['cae']
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
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.cliente && filtros.cliente != 0)
            filtro += " AND v.idCliente = " + filtros.cliente;

        if (filtros.idVenta && filtros.idVenta != 0)
            filtro += " AND v.id = " + filtros.idVenta;
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
                " SELECT v.*, c.nombre AS cliente, pv.descripcion AS proceso FROM ventas v " + 
                " LEFT JOIN clientes c ON c.id = v.idCliente " +
                " LEFT JOIN procesos_venta pv ON pv.id = v.idProceso " +
                " WHERE 1 = 1 " +
                filtro +
                " ORDER BY v.id DESC " +
                paginado +
                endCount;
        
        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ObtenerPagosVenta(connection, idVenta:number){
    try {
        const consulta = "SELECT vp.*, mp.descripcion FROM ventas_pagos vp " + 
                         "LEFT JOIN metodos_pago mp ON mp.id = vp.idMetodo "
                         "WHERE vp.idVenta = ?"

        const [rows] = await connection.query(consulta, [idVenta]);
        const pagos:PagosVenta[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let pago:PagosVenta = new PagosVenta();
                pago.idVenta = row['idVenta'];
                pago.idMetodo = row['idMetodo'];
                pago.metodo = row['descripcion'];
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
        const consulta = "SELECT vs.*, s.descripcion, s.codigo FROM ventas_servicios vs " + 
                         "LEFT JOIN servicios s ON s.id = vs.idServicio "
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
                servicios.push(servicio);
              }
        }

        return servicios;

    } catch (error) {
        throw error; 
    }
}

async function ObtenerProductosVenta(connection, idVenta:number){
    try {
        const consulta = "SELECT vp.*, p.codigo, p.nombre FROM ventas_productos vp " + 
                         "INNER JOIN productos p ON p.id = vp.idProducto WHERE vp.idVenta = ? "

        const [rows] = await connection.query(consulta, [idVenta]);

        const productos:ProductosVenta[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let producto:ProductosVenta = new ProductosVenta();
                producto.idVenta = row['idVenta'];
                producto.idProducto = row['idProducto'];
                producto.codProducto = row['codigo'];
                producto.nomProducto = row['nombre'];
                producto.cantidad = row['cantidad'];
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
                producto.unitario = parseFloat(row['precio']);
                producto.total = parseFloat(row['total']);
                producto.tallesSeleccionados = row['talles'];
                productos.push(producto);
              }
        }

        return productos;

    } catch (error) {
        throw error; 
    }
}

//#region INSERT
async function ObtenerUltimaVenta(connection):Promise<number>{
    try {
        const rows = await connection.query(" SELECT id FROM ventas ORDER BY id DESC LIMIT 1 ");
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

async function InsertVenta(connection, venta):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas(id,idProceso,nroNota,fecha,hora,idCliente,idLista,idEmpresa,idTComprobante,idTDescuento,descuento,codPromocion,redondeo,total) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ";

        const parametros = [venta.id, venta.idProceso, venta.nroNota, moment(venta.fecha).format('YYYY-MM-DD'), moment().format('HH:mm'), venta.idCliente, venta.idListaPrecio, venta.idEmpresa, venta.idTipoComprobante, venta.idTipoDescuento, venta.descuento, venta.codPromocion, venta.redondeo, venta.total];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function UpdateVenta(connection, venta):Promise<void>{
    try {
        const consulta = "UPDATE ventas SET " +
                         " idProceso = ?, " +
                         " nroNota = ?, " +
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
                         " total = ? " +
                         " WHERE id = ? ";

        const parametros = [venta.idProceso, venta.nroNota, moment(venta.fecha).format('YYYY-MM-DD'), moment().format('HH:mm'), venta.idCliente, venta.idListaPrecio, venta.idEmpresa, venta.idTipoComprobante, venta.idTipoDescuento, venta.descuento, venta.codPromocion, venta.redondeo, venta.total, venta.id];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function InsertProductoVenta(connection, producto):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_productos(idVenta, idProducto, cantidad, precio, total, talles, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

        const parametros = [producto.idVenta, producto.idProducto, producto.cantidad, producto.unitario, producto.total, producto.tallesSeleccionados, producto.t1, producto.t2, producto.t3, producto.t4, producto.t5, producto.t6, producto.t7, producto.t8, producto.t9, producto.t10];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function InsertServicioVenta(connection, pago):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_servicios(idVenta, idServicio, cantidad, precio, total) " +
                         " VALUES(?, ?, ?, ?, ?) ";

        const parametros = [pago.idVenta, pago.idServicio, pago.cantidad, pago.unitario, pago.total];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function InsertPagoVenta(connection, pago):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_pagos(idVenta, idMetodo, monto) " +
                         " VALUES(?, ?, ?) ";

        const parametros = [pago.idVenta, pago.idMetodo, pago.monto];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function InsertFacturaVenta(connection, factura):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_factura(idVenta, cae, caeVto, ticket, tipoFactura, neto, iva, dni, tipoDni, ptoVenta, condReceptor) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ";

        const parametros = [factura.idVenta, factura.cae, moment(factura.caeVto).format('YYYY-MM-DD'), factura.ticket, factura.tipoFactura, factura.neto, factura.iva, factura.dni, factura.tipoDni, factura.ptoVenta, factura.condReceptor];
        await connection.query(consulta, parametros);

    } catch (error) {
        throw error; 
    }
}
//#endregion

export const VentasRepo = new VentasRepository();