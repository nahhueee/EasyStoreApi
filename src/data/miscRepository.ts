import { RowDataPacket } from 'mysql2';
import db from '../db';

class MiscRepository{

    //#region OBTENER
    async MaterialesSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM materiales');
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

export const MiscRepo = new MiscRepository();