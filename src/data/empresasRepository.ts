import db from '../db';
import { Empresa } from '../models/Empresa';

class EmpresasRepository{

    //#region OBTENER
    async EmpresasSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT id, razonSocial FROM empresas');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerEmpresa(id:number){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT * FROM empresas WHERE id = ?', [id]);
            return new Empresa([rows][0][0]);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion
}


export const EmpresasRepo = new EmpresasRepository();