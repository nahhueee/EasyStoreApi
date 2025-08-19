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

    async LineaTallesSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM lineas_talle');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async TallesSelector(idLinea){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM talles WHERE idLinea = ?', [idLinea]);
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion
}

export const MiscRepo = new MiscRepository();