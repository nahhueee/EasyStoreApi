import db from '../db';
import bcrypt from 'bcryptjs';

class UsuariosRepository{

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();
        
        try {
            //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQuery(filtros,false);
            let queryTotal = await ObtenerQuery(filtros,true);

            //Obtengo la lista de registros y el total
            const rows = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            return {total:resultado[0][0].total, registros:rows[0]};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerUsuario(filtros:any){
        const connection = await db.getConnection();

        try {
            let consulta = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta);
            const usuario = rows[0][0];

            if (usuario) delete usuario.pass; // No exponer el hash fuera del login
            return usuario;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    // Usado exclusivamente por el endpoint de login. Devuelve el usuario (sin pass) si las
    // credenciales son válidas, o null si no existe o la contraseña no coincide.
    async Login(usuario:string, pass:string){
        const connection = await db.getConnection();

        try {
            const rows = await connection.query(
                "SELECT u.*, c.nombre cargo FROM usuarios u LEFT JOIN cargos c ON c.id = u.idCargo WHERE u.usuario = ?",
                [usuario]
            );
            const usuarioDb = rows[0][0];
            if (!usuarioDb) return null;

            const passwordOk = await bcrypt.compare(pass, usuarioDb.pass);
            if (!passwordOk) return null;

            delete usuarioDb.pass;
            return usuarioDb;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async UsuariosSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT id, usuario, nombre FROM usuarios');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ValidarNombreUsuario(usuario:string){
        const connection = await db.getConnection();
        
        try {
            const rows = await connection.query("SELECT usuario FROM usuarios WHERE usuario = ?", [usuario]);
            if (rows[0][0] != undefined) {
                return true  // existe
            } else {
                return false  // no existe
            }

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async CargosSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT id, nombre FROM cargos');
            return [rows][0];

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
            // let existe = await ValidarExistencia(connection, data, false);
            // if(existe)//Verificamos si ya existe un usuario con el mismo nombre o correo
            //     return "Ya existe un usuario con el mismo nombre o correo.";
            
            const hash = await bcrypt.hash(data.pass, 10);
            const consulta = "INSERT INTO usuarios(usuario, nombre, email, pass, idCargo) VALUES (?, ?, ?, ?, ?)";
            const parametros = [data.usuario, data.nombre.toUpperCase(), data.email, hash, data.cargo.id];

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
            // let existe = await ValidarExistencia(connection, data, true);

            // if(existe)//Verificamos si ya existe un usuario con el mismo nombre o correo
            //     return "Ya existe un usuario con el mismo nombre o correo.";
            
            // Solo se rehashea y actualiza la columna pass si llega una contraseña nueva
            // (evita pisar el hash existente con un valor vacío)
            let consulta:string;
            let parametros:any[];

            if (data.pass) {
                const hash = await bcrypt.hash(data.pass, 10);
                consulta = `UPDATE usuarios
                              SET
                              usuario = ?,
                              nombre = ?,
                              email = ?,
                              pass = ?,
                              idCargo = ?
                              WHERE id = ? `;
                parametros = [data.usuario, data.nombre.toUpperCase(), data.email, hash, data.cargo.id, data.id];
            } else {
                consulta = `UPDATE usuarios
                              SET
                              usuario = ?,
                              nombre = ?,
                              email = ?,
                              idCargo = ?
                              WHERE id = ? `;
                parametros = [data.usuario, data.nombre.toUpperCase(), data.email, data.cargo.id, data.id];
            }

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
            await connection.query("DELETE FROM usuarios WHERE id = ?", [id]);
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
        if (filtros.busqueda != null && filtros.busqueda != "") 
            filtro += " AND u.nombre LIKE '%"+ filtros.busqueda + "%' ";
        
        if(filtros.usuario != null && filtros.usuario != 0)
            filtro += " AND u.usuario = '" + filtros.usuario + "'";

        if(filtros.idUsuario != null && filtros.idUsuario != 0)
            filtro += " AND u.id = " + filtros.idUsuario + "";
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
            " SELECT u.*, c.nombre cargo " +
            " FROM usuarios u " +
            " LEFT JOIN cargos c on c.id = u.idCargo " +
            " WHERE 1 = 1 " +
            filtro +
            " ORDER BY u.id DESC" +
            paginado +
            endCount;
        
        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ValidarExistencia(connection, data:any, modificando:boolean):Promise<boolean>{
    try {
        let consulta = " SELECT * FROM usuarios WHERE nombre = ? ";
        if(modificando) consulta += " AND id <> ? ";

        const parametros = [data.nombre.toUpperCase(), data.id];

        const rows = await connection.query(consulta,parametros);
        if(rows[0].length > 0) return true;

        return false;
    } catch (error) {
        throw error; 
    }
}

export const UsuariosRepo = new UsuariosRepository();