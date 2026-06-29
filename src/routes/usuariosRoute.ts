import {UsuariosRepo} from '../data/usuariosRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
import { SesionServ } from '../services/sesionService';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de usuarios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-usuario/:usuario', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.ObtenerUsuario({usuario: req.params.usuario }));

    } catch(error:any){
        let msg = "Error al obtener el usuario " + req.params.usuario + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/selector-cargos', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.CargosSelector());

    } catch(error:any){
        let msg = "Error al obtener el selector de cargos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/selector', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.UsuariosSelector());

    } catch(error:any){
        let msg = "Error al obtener el selector de usuarios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/validar/:usuario', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.ValidarNombreUsuario(req.params.usuario));

    } catch(error:any){
        let msg = "Error al obtener el usuario nro " + req.params.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/login', async (req:Request, res:Response) => {
    try{
        // 200 + null en credenciales inválidas (usuario inexistente o pass incorrecta):
        // mismo contrato que ya consumía el frontend, sin distinguir el motivo del rechazo.
        const usuario = await UsuariosRepo.Login(req.body.usuario, req.body.pass);
        res.json(usuario);

    } catch(error:any){
        let msg = "Error al intentar iniciar sesion.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/guardar-sesion', async (req:Request, res:Response) => {
    try{ 
        res.json(await SesionServ.GuardarSesion(req.body.id, req.body.usuario, req.body.nombre, req.body.cargo.nombre));

    } catch(error:any){
        let msg = "Error al intentar guardar la sesion.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el usuario.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar el usuario.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar el usuario.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 