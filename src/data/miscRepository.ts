import { RowDataPacket } from 'mysql2';
import db from '../db';
import { Material } from '../models/Material';
import { Color } from '../models/Color';

class MiscRepository{

    //#region OBTENER
    async MaterialesSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM materiales');
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
            const [rows] = await connection.query('SELECT * FROM procesos');
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
            const [rows] = await connection.query('SELECT * FROM tipos_producto');
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
            const [rows] = await connection.query('SELECT * FROM subtipos_producto');
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
            const [rows] = await connection.query('SELECT * FROM generos');
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
            const [rows] = await connection.query('SELECT * FROM colores');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TemporadasSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM temporadas');
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