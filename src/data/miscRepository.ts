import { RowDataPacket } from 'mysql2';
import db from '../db';
import { Color, Material } from '../models/Producto';

class MiscRepository{

    //#region OBTENER
    async MaterialesSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM materiales ORDER BY descripcion ASC');
            const materiales:Material[] = [];
            
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let material:Material = new Material();
                    material.id = row['id'];
                    material.descripcion = row['descripcion'];
                    material.colores = await ObtenerColoresMaterial(connection, material.id!);

                    materiales.push(material);
                }
            }
            return materiales;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ProcesosSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM procesos ORDER BY descripcion ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TiposProductoSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM tipos_producto ORDER BY descripcion ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async SubtiposProductoSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM subtipos_producto ORDER BY descripcion ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async GenerosSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM generos ORDER BY descripcion ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ColoresSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM colores ORDER BY descripcion ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async EmpresasSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM empresas');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerEmpresa(idEmpresa){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM empresas WHERE id = ?', [idEmpresa]);
           return [rows][0][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TemporadasSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM temporadas ORDER BY descripcion ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerLineasTalle(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.execute<RowDataPacket[]>('SELECT * FROM lineas_talle');

            const result = rows.map(row => ({
                id: row.id,
                talles: row.descripcion.split("-")
            }));

            return result;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

     async ObtenerLineaDeTalle(idLinea){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.execute<RowDataPacket[]>('SELECT * FROM lineas_talle WHERE id = ?', [idLinea]);
            const result = rows.map(row => ({
                id: row.id,
                talles: row.descripcion.split("-")
            }));

           return result[0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerTalles(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.execute<RowDataPacket[]>('SELECT * FROM talles');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async CondicionesIvaSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM condiciones_iva ORDER BY descripcion ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async MetodosPagoSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM metodos_pago ORDER BY descripcion ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ComprobanteSelector(empresa, condicionIva){
        const connection = await db.getConnection();
        
        try {
            const query = " SELECT DISTINCT tc.* FROM reglas_comprobante rc " +
                          " JOIN tipos_comprobantes tc ON tc.id = rc.idTipoComprobante " +
                          " WHERE rc.empresa_tipo = ? AND (rc.cliente_tipo = ? OR rc.cliente_tipo IS NULL) ";

            const [rows] = await connection.query(query, [empresa, condicionIva]);
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    
    async ProcesosVentaSelector(tipo:string){
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query('SELECT * FROM procesos_venta WHERE tipo = ? ORDER BY descripcion ASC', [tipo]);
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async PuntosVentaSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM puntos_venta ORDER BY descripcion ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TiposDescuentoSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM tipos_descuento ORDER BY descripcion ASC');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //#endregion
}

async function ObtenerColoresMaterial(connection, idMaterial:number){
    try {
        const consulta = " SELECT c.* FROM materiales_colores mc " +
                         " LEFT JOIN colores c on c.id = mc.idColor " +
                         " WHERE mc.idMaterial = ?";

        const [rows] = await connection.query(consulta, [idMaterial]);

        const colores:Color[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let color:Color = new Color();
                color.id = row['id'];
                color.descripcion = row['descripcion'];
                color.hexa = row['hexa'];
                
                colores.push(color)
              }
        }

        return colores;

    } catch (error) {
        throw error; 
    }
}


export const MiscRepo = new MiscRepository();