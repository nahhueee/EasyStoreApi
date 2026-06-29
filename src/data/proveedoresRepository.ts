import moment from 'moment';
import db from '../db';
import { DireccionesProveedor, Proveedor } from '../models/Proveedor';

class ProveedoresRepository{

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
            const proveedores:Proveedor[] = [];
                       
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    
                    let proveedor:Proveedor = new Proveedor();
                    proveedor = await this.CompletarObjeto(connection, row)
                    proveedores.push(proveedor);
                }
            }

            return {total:resultado[0][0].total, registros:proveedores};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerProveedor(filtros:any){
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
        let proveedor:Proveedor = new Proveedor();
        proveedor.id = row['id'];
        proveedor.razonSocial = row['razonSocial'];
        proveedor.telefono = row['telefono'];
        proveedor.celular = row['celular'];
        proveedor.contacto = row['contacto'];
        proveedor.email = row['email'];
        proveedor.idCondicionIva = row['idCondIva'];
        proveedor.condicionIva = row['condicion'];
        proveedor.idTipoDocumento = row['idTipoDocumento'];
        proveedor.tipoDocumento = row['tipoDocumento'];
        proveedor.documento = row['documento'];
        proveedor.fechaAlta = row['fechaAlta'];
        proveedor.direcciones = await ObtenerDireccionesProveedor(connection, row['id']);
        return proveedor;
    }

    async ProveedoresSelector(){
        const connection = await db.getConnection();

        try {
            let query = " SELECT p.id, p.razonSocial, p.documento, ci.descripcion AS condicionIva, td.descripcion AS tipoDocumento " +
                        " FROM proveedores p " +
                        " LEFT JOIN condiciones_iva ci ON ci.id = p.idCondIva " +
                        " LEFT JOIN tipos_documento td ON td.id = p.idTipoDocumento " +
                        " WHERE p.fechaBaja IS NULL ";
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
    async Agregar(proveedor:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos el proveedor
            let existe = await ValidarExistencia(connection, proveedor, false);
            if(existe)//Verificamos si ya existe un proveedor con la misma razon social
                return "Ya existe un proveedor con la misma razón social.";
            
            const consulta = "INSERT INTO proveedores(razonSocial,telefono,celular,contacto,email,idCondIva,idTipoDocumento,documento,fechaAlta) " + 
                             "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)";
            const parametros = [proveedor.razonSocial, proveedor.telefono, proveedor.celular, proveedor.contacto, proveedor.email, proveedor.idCondicionIva, proveedor.idTipoDocumento, proveedor.documento, moment().format('YYYY-MM-DD HH:mm:ss')];
            
            const [result]: any = await connection.query(consulta, parametros);
            const idProveedor = result.insertId;

            //Insertamos las direcciones del proveedor
            for (const element of  proveedor.direcciones) {
                element.idProveedor = idProveedor;
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

    async Modificar(proveedor:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {

            
            let existe = await ValidarExistencia(connection, proveedor, true);
            if(existe)//Verificamos si ya existe un proveedor con la misma razon social
                return "Ya existe un proveedor con la misma razón social.";

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Modificamos el proveedor
            const consulta = `UPDATE proveedores
                SET razonSocial = ?,
                    telefono = ?,
                    celular = ?,
                    contacto = ?,
                    email = ?,
                    idCondIva = ?,
                    idTipoDocumento = ?,
                    documento = ?
                WHERE id = ? `;

            const parametros = [proveedor.razonSocial, proveedor.telefono, proveedor.celular, proveedor.contacto, proveedor.email, proveedor.idCondicionIva, proveedor.idTipoDocumento, proveedor.documento, proveedor.id];
            await connection.query(consulta, parametros);
               
            //Borramos las direcciones del proveedor
            await connection.query("DELETE FROM direcciones_proveedor WHERE idProveedor = ?", [proveedor.id]);

            //Insertamos las direcciones del proveedor
            for (const element of  proveedor.direcciones) {
                element.idProveedor = proveedor.id;
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

    async Eliminar(id:string): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            await connection.query("UPDATE proveedores SET fechaBaja = ? WHERE id = ?", [new Date(), id]);
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
        if (filtros.razonSocial != null && filtros.razonSocial != "") 
            filtro += " AND c.razonSocial LIKE '%"+ filtros.razonSocial.toUpperCase().trim() + "%'";
        if (filtros.condicionIva != null && filtros.condicionIva != "") 
            filtro += " AND c.idCondIva = "+ filtros.condicionIva;
        if (filtros.documento != null && filtros.documento != 0) 
            filtro += " AND c.documento = " + filtros.documento;
        if (filtros.idProveedor != null && filtros.idProveedor != 0) 
            filtro += " AND c.id = "+ filtros.idProveedor;
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
            " SELECT p.*, ci.descripcion condicion, td.descripcion tipoDocumento " +
            " FROM proveedores p" +
            " LEFT JOIN condiciones_iva ci on ci.id = p.idCondIva " +
            " LEFT JOIN tipos_documento td on td.id = p.idTipoDocumento " +
            " WHERE fechaBaja IS NULL " +
            filtro +
            " ORDER BY p.id DESC" +
            paginado +
            endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ValidarExistencia(connection, data:any, modificando:boolean):Promise<boolean>{
    try {
        let consulta = " SELECT id FROM proveedores WHERE razonSocial = ? ";
        if(modificando) consulta += " AND id <> ? ";

        const parametros = [data.razonSocial.toUpperCase(), data.id];

        const rows = await connection.query(consulta,parametros);
        if(rows[0].length > 0) return true;

        return false;
    } catch (error) {
        throw error; 
    }
}

//#region DETALLE VENTA
async function ObtenerDireccionesProveedor(connection, idProveedor:number){
    try {
        const consulta = " SELECT * FROM direcciones_proveedor WHERE idProveedor = ?";
        const [rows] = await connection.query(consulta, [idProveedor]);

        const direcciones:DireccionesProveedor[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let aux:DireccionesProveedor = new DireccionesProveedor();
                aux.id = row.id;
                aux.idProveedor = row.idProveedor;
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

async function InsertDirecciones(connection, direccion):Promise<void>{
    try {
        const consulta = " INSERT INTO direcciones_proveedor(idProveedor, resumen, codPostal, calle, numero, localidad, provincia, observaciones) " +
                         " VALUES(?, ?, ?, ?, ?, ?, ?, ?) ";

        const parametros = [direccion.idProveedor, direccion.resumen, direccion.codPostal, direccion.calle, direccion.numero.toString().toUpperCase(), direccion.localidad, direccion.provincia, direccion.observaciones];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}
//#endregion

export const ProveedoresRepo = new ProveedoresRepository();





