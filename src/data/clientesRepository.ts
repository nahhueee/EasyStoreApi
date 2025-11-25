import moment from 'moment';
import db from '../db';
import { Cliente, DireccionesCliente, UltimoDescuentoCliente } from '../models/Cliente';

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
        cliente.idCategoria = row['idCategoria'];
        cliente.fechaAlta = row['fechaAlta'];
        cliente.direcciones = await ObtenerDireccionesCliente(connection, row['id']);
        cliente.ultimoDescuento = await ObtenerUltimoDescuento(connection, row['id']);

        return cliente;
    }

    async ClientesSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT id, nombre, documento FROM clientes');
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

            //Obtenemos el proximo nro de cliente a insertar
            cliente.id = await ObtenerUltimoCliente(connection);

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos el cliente
            let existe = await ValidarExistencia(connection, cliente, false);
            if(existe)//Verificamos si ya existe un cliente con el mismo nombre 
                return "Ya existe un cliente con el mismo nombre.";
            
            const consulta = "INSERT INTO clientes(nombre,razonSocial,telefono,celular,contacto,email,idCondIva,idTipoDocumento,documento,idCondicionPago,idCategoria,fechaAlta) " + 
                             "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
            const parametros = [cliente.nombre.toUpperCase(), cliente.razonSocial, cliente.telefono, cliente.celular, cliente.contacto, cliente.email, cliente.idCondicionIva, cliente.idTipoDocumento, cliente.documento, cliente.idCondicionPago, cliente.idCategoria, moment().format('YYYY-MM-DD HH:mm:ss')];
            
            await connection.query(consulta, parametros);

            //Insertamos las direcciones del cliente
            for (const element of  cliente.direcciones) {
                element.idCliente = cliente.id;
                InsertDirecciones(connection, element);
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
                    fechaAlta = ?
                WHERE id = ? `;

            const parametros = [data.nombre.toUpperCase(), data.razonSocial, data.telefono, data.celular, data.contacto, data.email, data.idCondicionIva, data.idTipoDocumento, data.documento, data.idCondicionPago, data.idCategoria, moment().format('YYYY-MM-DD HH:mm:ss'), data.id];
            await connection.query(consulta, parametros);
               
            //Borramos las direcciones del cliente
            await connection.query("DELETE FROM direcciones_cliente WHERE idCliente = ?", [data.id]);

            //Insertamos las direcciones del cliente
            for (const element of  data.direcciones) {
                element.idCliente = data.id;
                InsertDirecciones(connection, element);
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

async function ObtenerUltimoCliente(connection):Promise<number>{
    try {
        const rows = await connection.query("SELECT id FROM clientes ORDER BY id DESC LIMIT 1");
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
        if (filtros.busqueda != null && filtros.busqueda != "") 
            filtro += " AND c.nombre LIKE '%"+ filtros.busqueda + "%' ";
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
            " WHERE c.id <> 1 AND fechaBaja IS NULL " +
            filtro +
            " ORDER BY c.id DESC" +
            paginado +
            endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ValidarExistencia(connection, data:any, modificando:boolean):Promise<boolean>{
    try {
        let consulta = " SELECT id FROM clientes WHERE nombre = ? ";
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
        const consulta = " SELECT descuento, idTDescuento, td.descripcion FROM ventas v " + 
                         " LEFT JOIN tipos_descuento td ON td.id = v.idTDescuento " +
                         " WHERE v.idCliente = ? AND v.descuento IS NOT NULL AND v.fechaBaja IS NULL " +
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





