import db from '../db';
import { PagosVenta, ProductosVenta, ServiciosVenta, Venta } from '../models/Venta';
import { ObjQR } from '../models/ObjQR';
import { FacturaVenta } from '../models/FacturaVenta';
import { MiscRepo } from './miscRepository';
import { ProductosRepo } from './productosRepository';
import { ResultSetHeader } from 'mysql2';
import { Cliente } from '../models/Cliente';
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
                    nroEditando: data.nroEditando
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
        venta.proceso = row['proceso'];
        venta.nroProceso = row['nroProceso'];
        venta.idPunto = row['idPunto'];
        venta.punto = row['punto'];
        venta.fecha = moment(row['fecha']).toDate();
        venta.hora = row['hora'];
        // venta.idCliente = row['idCliente'];
        // venta.cliente = row['cliente'];
        // venta.condCliente = row['condicionIva'];
        // venta.clienteRazonSocial = row['clienteRazonSocial'];  
        venta.idListaPrecio = row['idLista'];
        venta.idEmpresa = row['idEmpresa'];
        venta.empresa = row['empresa'];
        venta.idTipoComprobante = row['idTComprobante'];
        venta.tipoComprobante = row['tipoComprobante'];
        venta.idTipoDescuento = row['idTDescuento'];
        venta.tipoDescuento = row['tipoDescuento'];
        venta.descuento = parseInt(row['descuento']);
        venta.codPromocion = row['codPromocion'];
        venta.redondeo = parseFloat(row['redondeo']);
        venta.total = parseFloat(row['total']);
        venta.nroRelacionado = parseFloat(row['nroRelacionado']);
        venta.tipoRelacionado = row['tipoRelacionado'];
        venta.estado = row['estado'];
        venta.impaga = row['impaga'];
        venta.entregado = parseFloat(row['entregado'] ?? 0);
        venta.deuda = parseFloat(row['deuda']) ?? 0;

        venta.cliente = new Cliente();
        venta.cliente.id = row['idCliente'];
        venta.cliente.nombre = row['nombre'];
        venta.cliente.razonSocial = row['razonSocial'];
        venta.cliente.idCondicionIva = row['idCondIva'];
        venta.cliente.condicionIva = row['condicionIva'];
        venta.cliente.idTipoDocumento = row['idTipoDocumento'];
        venta.cliente.documento = row['documento'];

        venta.pagos = await ObtenerPagosVenta(connection, venta.id!);
        venta.servicios = await ObtenerServiciosVenta(connection, venta.id!);
        venta.productos = await ObtenerProductosVenta(connection, venta.id!, venta.idProceso!);
        venta.factura = await ObtenerFacturaVenta(connection, venta.id!);

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
            const rows = await connection.query(" SELECT id FROM ventas WHERE idProceso = 7 AND nroProceso = ? ORDER BY id DESC LIMIT 1 ", nroNota);
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
        
        try {
            //Obtenemos el proximo nro de venta a insertar
            venta.nroProceso = await ObtenerProximoNroProceso(connection, venta.idProceso);
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos la venta
            const consulta = " INSERT INTO ventas(idProceso,nroProceso,idPunto,fecha,hora,idCliente,idLista,idEmpresa,idTComprobante,idTDescuento,descuento,codPromocion,redondeo,total,nroRelacionado,tipoRelacionado,estado,impaga) " +
                             " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?) ";

            const parametros = [venta.idProceso, venta.nroProceso, venta.idPunto, moment(venta.fecha).format('YYYY-MM-DD'), moment().format('HH:mm'), venta.cliente?.id, venta.idListaPrecio, venta.idEmpresa, venta.idTipoComprobante, venta.idTipoDescuento, venta.descuento, venta.codPromocion, venta.redondeo, venta.total, venta.nroRelacionado, venta.tipoRelacionado, venta.estado, venta.impaga];
            const [resultado] = await connection.query<ResultSetHeader>(consulta, parametros);
            venta.id =  resultado.insertId;

            //Actualizamos el estado del relacionado
            if(venta.nroRelacionado != 0){
                let nroProceso = 0;
                let estado = "";

                switch (venta.tipoRelacionado) {
                    case "PRESUPUESTO":
                        nroProceso = 5;
                        estado = "Asociado"
                        break;
                    case "PEDIDO":
                        nroProceso = 6;
                        estado = "Asociado"
                        break;
                    case "NOTA DE EMPAQUE":
                        nroProceso = 7;
                        estado = "Asociada"
                        break;
                    default:
                        break;
                }

                await connection.query("UPDATE ventas SET estado = ? WHERE nroProceso = ? AND idProceso = ? ", ["Asociado", venta.nroRelacionado, nroProceso]);
            }

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
                    const finalizandoCotizacion = venta.idProceso == 2 && venta.estado == "Finalizada";

                    if(venta.factura || finalizandoCotizacion)
                        await ActualizarInventario(connection, element, "-")
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

                //Actualizamos el estado facturado de la venta relacionada
                if(venta.nroRelacionado != 0){
                    let nroProceso = 0;
                    let estado = "";

                    switch (venta.tipoRelacionado) {
                        case "PEDIDO":
                            nroProceso = 6;
                            estado = "Facturado"
                            break;
                        case "NOTA DE EMPAQUE":
                            nroProceso = 7;
                            estado = "Facturada"
                            break;
                        default:
                            break;
                    }

                    await connection.query("UPDATE ventas SET estado = ? WHERE nroProceso = ? AND idProceso = ? ", [estado, venta.nroRelacionado, nroProceso]);
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

            //Actualizamos el estado del relacionado
            if(venta.nroRelacionado != 0){
                let nroProceso = 0;
                let estado = "";

                switch (venta.tipoRelacionado) {
                    case "PRESUPUESTO":
                        nroProceso = 5;
                        estado = "Asociado"
                        break;
                    case "PEDIDO":
                        nroProceso = 6;
                        estado = "Asociado"
                        break;
                    case "NOTA DE EMPAQUE":
                        nroProceso = 7;
                        estado = "Asociada"
                        break;
                    default:
                        break;
                }

                await connection.query("UPDATE ventas SET estado = ? WHERE nroProceso = ? AND idProceso = ? ", ["Asociado", venta.nroRelacionado, nroProceso]);
            }

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

                    if(venta.factura)
                        await ActualizarInventario(connection, element, "-")
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

                //Actualizamos el estado facturado de la venta relacionada
                if(venta.nroRelacionado != 0){
                    let nroProceso = 0;
                    let estado = "";

                    switch (venta.tipoRelacionado) {
                        case "PEDIDO":
                            nroProceso = 6;
                            estado = "Facturado"
                            break;
                        case "NOTA DE EMPAQUE":
                            nroProceso = 7;
                            estado = "Facturada"
                            break;
                        default:
                            break;
                    }

                    await connection.query("UPDATE ventas SET estado = ? WHERE nroProceso = ? AND idProceso = ? ", [estado, venta.nroRelacionado, nroProceso]);
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

    async Aprobar(data:any){
        const connection = await db.getConnection();
        
        try {
            await connection.query("UPDATE ventas SET estado = 'Aprobada' WHERE id = ?", [data.idVenta]);
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

            if(filtros.desdeCuenta && filtros.desdeCuenta == false){
                filtro += " AND (estado <> 'Asociado' AND estado <> 'Asociada' AND estado <> 'Facturado' AND estado <> 'Facturada' AND estado <> 'Finalizado' AND estado <> 'Finalizada')";
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

        if (filtros.fechas?.length === 2) {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            filtro += ` AND v.fecha >= '${desde}' AND v.fecha < '${hasta}'`;
        }

        if(filtros.idCliente && filtros.idCliente != 0){
            filtro += " AND v.idCliente = " + filtros.idCliente;
        }

        if(filtros.impagas == 1){
            filtro += " AND v.impaga = " + filtros.impagas;
        }
        if(filtros.desdeCuenta && filtros.desdeCuenta == true){
            condicional += " ,p.entregado ,SUM(v.total - IFNULL(p.entregado, 0)) AS deuda "
            adicional += " LEFT JOIN (" +
                        " SELECT idVenta, SUM(monto) AS entregado" +
                        " FROM ventas_pagos " +
                        " GROUP BY idVenta " +
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
                " SELECT v.*, c.nombre, c.razonSocial, c.idCondIva, c.idTipoDocumento, c.documento, ci.descripcion AS condicionIva, pv.descripcion AS proceso, e.razonSocial AS empresa, tc.descripcion AS tipoComprobante, td.descripcion AS tipoDescuento " + 
                condicional + 
                " FROM ventas v " + 
                " LEFT JOIN clientes c ON c.id = v.idCliente " +
                " LEFT JOIN procesos_venta pv ON pv.id = v.idProceso " +
                " LEFT JOIN empresas e ON e.id = v.idEmpresa " +
                " LEFT JOIN tipos_comprobantes tc ON tc.id = v.idTComprobante " +
                " LEFT JOIN tipos_descuento td ON td.id = v.idTDescuento " +
                " LEFT JOIN condiciones_iva ci ON ci.id = c.idCondIva " +
                adicional +
                " WHERE 1 = 1 " +
                filtro +
                " GROUP BY v.id " +
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
                         "LEFT JOIN metodos_pago mp ON mp.id = vp.idMetodo " +
                         "WHERE vp.idVenta = ?"

        const [rows] = await connection.query(consulta, [idVenta]);
        const pagos:PagosVenta[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let pago:PagosVenta = new PagosVenta();
                pago.id = row['id'];
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
                servicios.push(servicio);
              }
        }

        return servicios;

    } catch (error) {
        throw error; 
    }
}

async function ObtenerProductosVenta(connection, idVenta:number, idProceso:number){
    try {
        let consulta = "";

        if(idProceso == 5){
            consulta = "SELECT vp.*, p.codigo, p.nombre FROM ventas_productos vp " + 
                       "INNER JOIN productos_presupuesto p ON p.id = vp.idProducto " + 
                       "WHERE vp.idVenta = ? ";
        }else{
            consulta = "SELECT vp.*, p.codigo, p.nombre, c.id idColor, c.descripcion color, c.hexa FROM ventas_productos vp " + 
                        "INNER JOIN productos p ON p.id = vp.idProducto " + 
                        "INNER JOIN colores c ON c.id = p.idColor " +
                        "WHERE vp.idVenta = ? ";
        }

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
                producto.precio = parseFloat(row['precio']);
                producto.unitario = parseFloat(row['precio']);
                producto.total = parseFloat(row['total']);
                producto.tallesSeleccionados = row['talles'];
                producto.color = row['color'];
                producto.hexa = row['hexa'];
                producto.talles = await ProductosRepo.ObtenerTallesProducto(producto.idProducto!);

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
        const consulta = "SELECT * FROM ventas_factura " + 
                         "WHERE idVenta = ?"

        const [rows] = await connection.query(consulta, [idVenta]);
        if(rows.length==0) return undefined;

        const row = rows[0];
        const factura:FacturaVenta = new FacturaVenta(
            {
                cae: row['cae'], 
                caeVto: row['caeVto'], 
                ticket: row['ticket'], 
                tipoFactura: row['tipoFactura'], 
                neto: parseFloat(row['neto']), 
                iva: parseFloat(row['iva']), 
                dni: row['dni'],
                tipoDni: row['tipoDni'],
                ptoVenta: row['ptoVenta'],
                condReceptor: row['condReceptor'],
            }
        );
        
        return factura;

    } catch (error) {
        throw error; 
    }
}

//#region INSERT
async function ObtenerProximoNroProceso(connection, idProceso):Promise<number>{
    try {
        const rows = await connection.query(" SELECT nroProceso FROM ventas WHERE idProceso = ? ORDER BY id DESC LIMIT 1 ", idProceso);
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
                         " impaga = ? " +
                         " WHERE id = ? ";

        const parametros = [venta.idProceso, venta.idPunto, moment(venta.fecha).format('YYYY-MM-DD'), moment().format('HH:mm'), venta.cliente.id, venta.idListaPrecio, venta.idEmpresa, venta.idTipoComprobante, venta.idTipoDescuento, venta.descuento, venta.codPromocion, venta.redondeo, venta.total, venta.nroRelacionado, venta.tipoRelacionado, venta.estado, venta.impaga, venta.id];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}

async function InsertProductoVenta(connection, producto):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_productos(idVenta, idProducto, idLineaTalle, cantidad, precio, total, talles, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

        const parametros = [producto.idVenta, producto.idProducto, producto.idLineaTalle, producto.cantidad, producto.unitario, producto.total, producto.tallesSeleccionados, producto.t1, producto.t2, producto.t3, producto.t4, producto.t5, producto.t6, producto.t7, producto.t8, producto.t9, producto.t10];
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

async function InsertHistorialVenta(connection, historial):Promise<void>{
    try {
        const consulta = " INSERT INTO ventas_historial(idVenta, procActual, procAnterior, fecha, hora) " +
                         " VALUES(?, ?, ?) ";

        const parametros = [historial.idVenta, historial.procActual, historial.procAnterior, moment().format('YYYY-MM-DD'), moment().format('HH:mm')];
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


async function ActualizarInventario(connection, detalle, operacion):Promise<void>{
    try {
        const seleccionados = detalle.tallesSeleccionados.split(",").map(t => t.trim());
        const lineaTalle = await MiscRepo.ObtenerLineaDeTalle(detalle.idLineaTalle);

        for (const talle of seleccionados) {
            const index = lineaTalle.talles.indexOf(talle);
            if (index === -1) continue;

            const campoTx = `t${index + 1}`;
            const cantDescontar = detalle[campoTx];
            
            const consulta = `UPDATE talles_producto SET cantidad = cantidad ${operacion} ? 
                              WHERE talle = ? AND idProducto = ?`;

            const parametros = [cantDescontar, talle, detalle.idProducto];
            await connection.query(consulta, parametros);
        } 
    } catch (error) {
        throw error; 
    }
}

export const VentasRepo = new VentasRepository();