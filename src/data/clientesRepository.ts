import moment from 'moment';
import db from '../db';
import { Cliente, DireccionesCliente, UltimoDescuentoCliente } from '../models/Cliente';

// Ver HANDOFF-dar-de-baja-cliente.md para el diseño completo de DarBajaCliente.
interface DarBajaClienteDTO {
  idCliente: number;
  motivo: string;
}

class ClientesRepository{

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
            const clientes:Cliente[] = [];
                       
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    
                    let cliente:Cliente = new Cliente();
                    cliente = await this.CompletarObjeto(connection, row)
                    clientes.push(cliente);
                }
            }

            return {total:resultado[0][0].total, registros:clientes};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerCliente(filtros:any){
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
        let cliente:Cliente = new Cliente();
        cliente.id = row['id'];
        cliente.nombre = row['nombre'];
        cliente.razonSocial = row['razonSocial'];
        cliente.telefono = row['telefono'];
        cliente.celular = row['celular'];
        cliente.contacto = row['contacto'];
        cliente.email = row['email'];
        cliente.idCondicionIva = row['idCondIva'];
        cliente.condicionIva = row['condicion'];
        cliente.idTipoDocumento = row['idTipoDocumento'];
        cliente.tipoDocumento = row['tipoDocumento'];
        cliente.documento = row['documento'];
        cliente.idCondicionPago = row['idCondicionPago'];
        cliente.condicionPago = row['condicionPago'];
        cliente.idListaPrecio = row['idListaPrecio'];
        cliente.idCategoria = row['idCategoria'];
        cliente.inicial = parseFloat(row['inicial']);
        cliente.fechaAlta = row['fechaAlta'];
        cliente.direcciones = await ObtenerDireccionesCliente(connection, row['id']);
        cliente.ultimoDescuento = await ObtenerUltimoDescuento(connection, row['id']);

        // Lista 3.5 (case 3) se eliminó ago-2026 - confirmado sin clientes asignados
        // antes de sacarla (ver Diagnostico impacto Lista 3.5 - ago-2026.sql).
        switch (cliente.idListaPrecio) {
            case 1:
                cliente.listaPrecio = "CONSUMIDOR FINAL"
                break;
            case 2:
                cliente.listaPrecio = "LISTA 3"
                break;
            case 4:
                cliente.listaPrecio = "LISTA 4"
                break;
            case 5:
                cliente.listaPrecio = "LISTA 4.5"
                break;
            case 6:
                cliente.listaPrecio = "LISTA 5"
                break;
        }

        return cliente;
    }

    // Query plana sin paginar, pensada para export masivo: a diferencia de Obtener(),
    // no dispara las sub-consultas de direcciones/ultimoDescuento por cliente (innecesarias
    // para un listado de datos maestros y costosas si no hay paginado de por medio).
    async ObtenerParaExcel(filtros:any){
        const connection = await db.getConnection();

        try {
            const query = await ObtenerQueryParaExcel(filtros);
            const [rows] = await connection.query(query);

            const clientes:any[] = [];

            if (Array.isArray(rows)) {
                for (const row of rows) {
                    clientes.push({
                        Codigo: row['id'],
                        Nombre: row['nombre'],
                        RazonSocial: row['razonSocial'],
                        Documento: row['documento'],
                        TipoDocumento: row['tipoDocumento'],
                        CondicionIva: row['condicion'],
                        CondicionPago: row['condicionPago'],
                        Categoria: row['categoria'],
                        ListaPrecio: MapearListaPrecio(row['idListaPrecio']),
                        Telefono: row['telefono'],
                        Celular: row['celular'],
                        Contacto: row['contacto'],
                        Email: row['email'],
                        FechaAlta: row['fechaAlta'] ? moment(row['fechaAlta']).format('DD/MM/YYYY') : ''
                    });
                }
            }

            return clientes;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ClientesSelector(cuentasCorriente){
        const connection = await db.getConnection();
        
        try {
            let query = "SELECT id, nombre, documento, razonSocial FROM clientes WHERE fechaBaja IS NULL ";
            if(cuentasCorriente == "true"){ query += "AND idCondicionPago = 2"}

            const [rows] = await connection.query(query);
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    async Agregar(cliente:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {

            //Verificamos si ya existe un cliente con el mismo nombre (antes de abrir transaccion,
            //para no dejar una transaccion colgada en el pool si se corta aca)
            let existe = await ValidarExistencia(connection, cliente, false);
            if(existe)
                return "Ya existe un cliente con el mismo nombre.";

            //Iniciamos una transaccion
            await connection.beginTransaction();

            const consulta = "INSERT INTO clientes(nombre,razonSocial,telefono,celular,contacto,email,idCondIva,idTipoDocumento,documento,idCondicionPago,idCategoria,inicial,inicialHistorico,idListaPrecio,fechaAlta) " +
                             "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
            const parametros = [cliente.nombre.toUpperCase(), cliente.razonSocial, cliente.telefono, cliente.celular, cliente.contacto, cliente.email, cliente.idCondicionIva, cliente.idTipoDocumento, cliente.documento, cliente.idCondicionPago, cliente.idCategoria, cliente.inicial, cliente.inicial, cliente.idListaPrecio, moment().format('YYYY-MM-DD HH:mm:ss')];

            const [result]: any = await connection.query(consulta, parametros);
            cliente.id = result.insertId;

            //Insertamos las direcciones del cliente
            for (const element of  cliente.direcciones) {
                element.idCliente = cliente.id;
                await InsertDirecciones(connection, element);
            };

            //Mandamos la transaccion
            await connection.commit();
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
            if(existe)//Verificamos si ya existe un cliente con el mismo nombre 
                return "Ya existe un cliente con el mismo nombre.";
            
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Modificamos el cliente
            const consulta = `UPDATE clientes 
                SET nombre = ?,
                    razonSocial = ?,
                    telefono = ?,
                    celular = ?,
                    contacto = ?,
                    email = ?,
                    idCondIva = ?,
                    idTipoDocumento = ?,
                    documento = ?,
                    idCondicionPago = ?,
                    idCategoria = ?,
                    idListaPrecio = ?,
                    fechaAlta = ?
                WHERE id = ? `;

            const parametros = [data.nombre.toUpperCase(), data.razonSocial, data.telefono, data.celular, data.contacto, data.email, data.idCondicionIva, data.idTipoDocumento, data.documento, data.idCondicionPago, data.idCategoria, data.idListaPrecio, moment().format('YYYY-MM-DD HH:mm:ss'), data.id];
            await connection.query(consulta, parametros);
               
            //Borramos las direcciones del cliente
            await connection.query("DELETE FROM direcciones_cliente WHERE idCliente = ?", [data.id]);

            //Insertamos las direcciones del cliente
            for (const element of  data.direcciones) {
                element.idCliente = data.id;
                await InsertDirecciones(connection, element);
            };
                
            //Mandamos la transaccion
            await connection.commit();
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    // Ver HANDOFF-dar-de-baja-cliente.md para el diseño completo.
    // Guard estricto: solo permite la baja si el cliente no tiene ningun movimiento
    // asociado (ventas, recibos, entregas, productos) ni saldo inicial cargado.
    async DarBajaCliente(data: DarBajaClienteDTO): Promise<string>{
        const { idCliente } = data;
        const motivo = (data.motivo || '').trim();
        if (!motivo) {
            throw { status: 400, message: 'El motivo de la baja es obligatorio.' };
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [[cliente]]: any = await connection.query(
                "SELECT id, fechaBaja, inicial, inicialHistorico FROM clientes WHERE id = ? FOR UPDATE",
                [idCliente]
            );
            if (!cliente) throw { status: 404, message: 'El cliente no existe.' };
            if (cliente.fechaBaja) throw { status: 400, message: 'El cliente ya fue dado de baja.' };

            const [[conteos]]: any = await connection.query(
                `SELECT
                    (SELECT COUNT(*) FROM ventas          WHERE idCliente = ?) AS ventas,
                    (SELECT COUNT(*) FROM recibos         WHERE idCliente = ?) AS recibos,
                    (SELECT COUNT(*) FROM ventas_entrega   WHERE idCliente = ?) AS entregas,
                    (SELECT COUNT(*) FROM productos       WHERE idCliente = ?) AS productos`,
                [idCliente, idCliente, idCliente, idCliente]
            );

            const bloqueos: string[] = [];
            if (conteos.ventas > 0) bloqueos.push(`${conteos.ventas} venta${conteos.ventas > 1 ? 's' : ''}`);
            if (conteos.recibos > 0) bloqueos.push(`${conteos.recibos} recibo${conteos.recibos > 1 ? 's' : ''}`);
            if (conteos.entregas > 0) bloqueos.push(`${conteos.entregas} entrega${conteos.entregas > 1 ? 's' : ''} de dinero`);
            if (conteos.productos > 0) bloqueos.push(`${conteos.productos} producto${conteos.productos > 1 ? 's' : ''}`);

            if (bloqueos.length > 0) {
                throw { status: 400, message: `No se puede dar de baja: el cliente tiene ${bloqueos.join(', ')} registrados.` };
            }
            if (parseFloat(cliente.inicial) !== 0 || parseFloat(cliente.inicialHistorico) !== 0) {
                throw { status: 400, message: 'No se puede dar de baja: el cliente tiene saldo inicial cargado.' };
            }

            await connection.query(
                "UPDATE clientes SET fechaBaja = ?, observacionBaja = ? WHERE id = ?",
                [new Date(), motivo, idCliente]
            );

            await connection.commit();
            return "OK";

        } catch (error:any) {
            await connection.rollback();
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
            " SELECT c.*, ci.descripcion condicion, td.descripcion tipoDocumento, cp.descripcion condicionPago " +
            " FROM clientes c" +
            " LEFT JOIN condiciones_iva ci on ci.id = c.idCondIva " +
            " LEFT JOIN tipos_documento td on td.id = c.idTipoDocumento " +
            " LEFT JOIN condiciones_pago cp on cp.id = c.idCondicionPago " +
            " WHERE fechaBaja IS NULL " +
            filtro +
            " ORDER BY c.id DESC" +
            paginado +
            endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

// Mismos filtros que ObtenerQuery (nombre, condicionIva, condicionPago, documento), para que
// el export siempre refleje exactamente lo que el listado tiene filtrado en pantalla.
async function ObtenerQueryParaExcel(filtros:any):Promise<string>{
    try {
        let filtro:string = "";

        if (filtros.nombre != null && filtros.nombre != "")
            filtro += " AND c.nombre LIKE '%"+ filtros.nombre.toUpperCase().trim() + "%'";
        if (filtros.condicionIva != null && filtros.condicionIva != "")
            filtro += " AND c.idCondIva = "+ filtros.condicionIva;
        if (filtros.condicionPago != null && filtros.condicionPago != "")
            filtro += " AND c.idCondicionPago = "+ filtros.condicionPago;
        if (filtros.documento != null && filtros.documento != 0)
            filtro += " AND c.documento = " + filtros.documento;

        return " SELECT c.id, c.nombre, c.razonSocial, c.documento, c.telefono, c.celular, c.contacto, c.email, " +
            " c.idListaPrecio, c.fechaAlta, ci.descripcion condicion, td.descripcion tipoDocumento, cp.descripcion condicionPago, cc.descripcion categoria " +
            " FROM clientes c" +
            " LEFT JOIN condiciones_iva ci on ci.id = c.idCondIva " +
            " LEFT JOIN tipos_documento td on td.id = c.idTipoDocumento " +
            " LEFT JOIN condiciones_pago cp on cp.id = c.idCondicionPago " +
            " LEFT JOIN categorias_cliente cc on cc.id = c.idCategoria " +
            " WHERE fechaBaja IS NULL " +
            filtro +
            " ORDER BY c.nombre ASC";

    } catch (error) {
        throw error;
    }
}

// Duplica intencionalmente el switch de CompletarObjeto (no hay tabla listas_precio en BD).
// Se mantiene local a este export para no tocar CompletarObjeto sin necesidad.
function MapearListaPrecio(idListaPrecio:number):string{
    // Lista 3.5 (case 3) se eliminó ago-2026 - confirmado sin clientes asignados antes
    // de sacarla (ver Diagnostico impacto Lista 3.5 - ago-2026.sql).
    switch (idListaPrecio) {
        case 1: return "CONSUMIDOR FINAL";
        case 2: return "LISTA 3";
        case 4: return "LISTA 4";
        case 5: return "LISTA 4.5";
        case 6: return "LISTA 5";
        default: return "";
    }
}

async function ValidarExistencia(connection, data:any, modificando:boolean):Promise<boolean>{
    try {
        let consulta = " SELECT id FROM clientes WHERE nombre = ? AND fechaBaja IS NULL ";
        if(modificando) consulta += " AND id <> ? ";

        const parametros = [data.nombre.toUpperCase(), data.id];

        const rows = await connection.query(consulta,parametros);
        if(rows[0].length > 0) return true;

        return false;
    } catch (error) {
        throw error; 
    }
}

//#region DETALLE VENTA
async function ObtenerDireccionesCliente(connection, idCliente:number){
    try {
        const consulta = " SELECT * FROM direcciones_cliente WHERE idCliente = ?";
        const [rows] = await connection.query(consulta, [idCliente]);

        const direcciones:DireccionesCliente[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let aux:DireccionesCliente = new DireccionesCliente();
                aux.id = row.id;
                aux.idCliente = row.idCliente;
                aux.resumen = row.resumen;
                aux.codPostal = row.codPostal;
                aux.calle = row.calle;
                aux.numero = row.numero;
                aux.localidad = row.localidad;
                aux.provincia = row.provincia;
                aux.observaciones = row.observaciones;

                direcciones.push(aux)
              }
        }

        return direcciones;

    } catch (error) {
        throw error; 
    }
}

async function ObtenerUltimoDescuento(connection, idCliente:number){
    try {
        // idProceso IN (1,2,3,4) = Factura/Cotización/Nota Crédito/Nota Débito - excluye
        // Presupuesto/Pedido/Nota de Empaque (5,6,7). Sin este filtro, si el movimiento
        // más reciente del cliente era un Presupuesto/Pedido, esta consulta devolvía su
        // descuento en vez del de la última Factura real (antes ago-2026 esos procesos
        // siempre grababan 0%, así que no se notaba - dejó de ser inofensivo al habilitar
        // descuento propio en Presupuesto/Pedido/Nota de Empaque).
        const consulta = " SELECT descuento, idTDescuento, td.descripcion FROM ventas v " +
                         " LEFT JOIN tipos_descuento td ON td.id = v.idTDescuento " +
                         " WHERE v.idCliente = ? AND v.descuento IS NOT NULL AND v.fechaBaja IS NULL " +
                         " AND v.idProceso IN (1,2,3,4) " +
                         " ORDER BY v.fecha DESC LIMIT 1";

        const rows = await connection.query(consulta, [idCliente]);

        const ultimoDescuento:UltimoDescuentoCliente = new UltimoDescuentoCliente();
        const row = rows[0][0];
        
        if (!row || row == undefined) return ultimoDescuento;

        ultimoDescuento.descuento = row["descuento"];
        ultimoDescuento.idTipoDescuento = row["idTDescuento"];
        ultimoDescuento.tipoDescuento = row["descripcion"];

        return ultimoDescuento;

    } catch (error) {
        throw error; 
    }
}

async function InsertDirecciones(connection, direccion):Promise<void>{
    try {
        const consulta = " INSERT INTO direcciones_cliente(idCliente, resumen, codPostal, calle, numero, localidad, provincia, observaciones) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?) ";

        const parametros = [direccion.idCliente, direccion.resumen, direccion.codPostal, direccion.calle, direccion.numero.toString().toUpperCase(), direccion.localidad, direccion.provincia, direccion.observaciones];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}
//#endregion

export const ClientesRepo = new ClientesRepository();





