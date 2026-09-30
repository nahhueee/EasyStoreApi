import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import config from './conf/app.config';
import { logger } from './logger/logger';
import { CodigoError } from './logger/CodigosError';
import { ParametrosRepo } from './data/parametrosRepository';
import { requestIdMiddleware } from './middlewares/requestIdMiddleware';
const http = require('http');
const path = require('path');

const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);

//setings
app.set('port', process.env.Port || config.port);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'upload')));
app.use(requestIdMiddleware);

if(!config.produccion){
    app.use(morgan("dev"));
}else{
    app.use(
        morgan("combined", {
        skip: (req, res) => res.statusCode < 400
        })
  );
}

//setings SocketIo
const io = socketIo(server, {
    cors: {
      origin: "*", 
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
});

//Starting the server
let host:string = "127.0.0.1";
if(config.esServer){
    host = "0.0.0.0";
}

server.listen(app.get('port'), host, () => {
    console.log('server ' + process.env.NODE_ENV + ' en puerto ' + app.get('port'));
});

//#region Log de arranque: entorno y estado de la facturacion (F0.3 - HANDOFF blindaje facturacion)
// Informativo: el bloqueo real de la facturacion pasa por VerificarEntorno() en
// facturacionService.ts en cada llamada, esto solo lo deja explicito en el log al arrancar.
(async () => {
    const nodeEnv = process.env.NODE_ENV;
    let entornoDb: string | null = null;
    let errorConsulta: string | undefined;

    try {
        entornoDb = await ParametrosRepo.ObtenerParametros('entorno');
    } catch (err: any) {
        errorConsulta = err?.message;
    }

    const entornoProduccionOk = config.produccion !== true || nodeEnv === 'prod';
    const entornoDbOk = !!entornoDb && entornoDb === nodeEnv;
    const facturacionHabilitada = entornoProduccionOk && entornoDbOk && !errorConsulta;

    // message explicito (F2 - antes este log solo tenia campos crudos sin `message`,
    // asi que en la pantalla de Errores aparecia una fila CRITICA sin texto: no es un
    // log mal armado, es este chequeo de arranque que no pasa por errorMiddleware
    // (no hay request, por eso tampoco tiene Ruta/Ref).
    const mensajeArranque = facturacionHabilitada
        ? `Chequeo de arranque: facturación habilitada (nodeEnv=${nodeEnv}, entornoDb=${entornoDb}).`
        : `Chequeo de arranque: facturación BLOQUEADA - nodeEnv=${nodeEnv}, entornoDb=${entornoDb ?? 'no cargado'}` +
          (errorConsulta ? `, error al consultar parametro 'entorno': ${errorConsulta}` : ', no coincide con NODE_ENV o no esta cargado') + '.';

    const datosArranque = {
        type: 'ARRANQUE',
        message: mensajeArranque,
        nodeEnv,
        produccion: config.produccion,
        entornoDb: entornoDb ?? null,
        database: config.db?.database,
        facturacion: facturacionHabilitada ? 'HABILITADA' : 'BLOQUEADA'
    };

    if (facturacionHabilitada) {
        logger.info(datosArranque);
    } else {
        logger.error({ ...datosArranque, code: CodigoError.ENTORNO_INVALIDO, errorConsulta });
    }
})();
//#endregion

//#region Rutas
import actualizacionRuta from './routes/actualizacionRoute';
import usuariosRuta from './routes/usuariosRoute';
import clientesRuta from './routes/clientesRoute';
import rubrosRuta from './routes/rubrosRoute';
import productosRuta from './routes/productosRoute';
import ventasRuta from './routes/ventasRoute';
import movimientosRuta from './routes/movimientosRoute';
import cajasRuta from './routes/cajasRoute';
import estadisticasRuta from './routes/estadisticasRoute';
import parametrosRuta from './routes/parametrosRoute';
import logsRuta from './routes/logsRoute';
import servidorRuta from './routes/servidorRoute';
import cuentasRuta from './routes/cuentasCorrientesRoute';
import etiquetasRuta from './routes/etiquetasRoute';
import miscRuta from './routes/miscRoute';
import direccionesRuta from './routes/direccionesRoute';
import serviciosRuta from './routes/serviciosRoute';
import ordenIngresoRuta from './routes/ordenIngresoRoute';
import fondosRuta from './routes/fondosRoute';
import valoresRuta from './routes/valoresRoute';
import proveedoresRuta from './routes/proveedoresRoute';
import comprasRuta from './routes/comprasRoute';
import comprasCuentasRuta from './routes/comprasCuentasRoute';
import stockRuta from './routes/stockRoute';
import feEmisionesRuta from './routes/feEmisionesRoute';

const base = config.servidor;
app.use(`${base}/update`, actualizacionRuta)
app.use(`${base}/usuarios`, usuariosRuta);
app.use(`${base}/clientes`, clientesRuta);
app.use(`${base}/rubros`, rubrosRuta);
app.use(`${base}/productos`, productosRuta);
app.use(`${base}/ventas`, ventasRuta);
app.use(`${base}/movimientos`, movimientosRuta);
app.use(`${base}/cajas`, cajasRuta); 
app.use(`${base}/estadisticas`, estadisticasRuta);
app.use(`${base}/parametros`, parametrosRuta);
app.use(`${base}/logs`, logsRuta);
app.use(`${base}/server`, servidorRuta);
app.use(`${base}/cuentas`, cuentasRuta);
app.use(`${base}/etiquetas`, etiquetasRuta);
app.use(`${base}/misc`, miscRuta);
app.use(`${base}/direcciones`, direccionesRuta);
app.use(`${base}/servicios`, serviciosRuta);
app.use(`${base}/orden-ingreso`, ordenIngresoRuta);
app.use(`${base}/fondos`, fondosRuta);
app.use(`${base}/valores`, valoresRuta);
app.use(`${base}/proveedores`, proveedoresRuta);
app.use(`${base}/compras`, comprasRuta);
app.use(`${base}/compras-cuentas`, comprasCuentasRuta);
app.use(`${base}/stock`, stockRuta);
app.use(`${base}/fe-emisiones`, feEmisionesRuta);

// AdminServer Route
import adminServerRuta from './routes/adminRoute';
app.use(`${base}/adminserver`, adminServerRuta);

// Upload images Route
import imagenesRuta from './routes/imagenesRoute';
app.use(`${base}/imagenes`, imagenesRuta);

// Files Route
import filesRoute from './routes/filesRoute';
app.use(`${base}/files`, filesRoute);

//#endregion

//#region backups 
// import backupRoute from './routes/backupRoute';
// app.use(`${base}/backup`, backupRoute);

// import {BackupsServ} from './services/backupService';
// if(!config.web)
//     BackupsServ.IniciarCron();
//#endregion

// Index Route
app.get(`${base}`, (req, res) => {
    res.status(200).send('Servidor CHAZAGOLF funcionando en este puerto.');
});
//404
app.use((_req, res) => {
    res.status(404).send('No se encontró el recurso solicitado.');
});


//Manejo y logs de errores
import { errorMiddleware } from './middlewares/errorMiddleware';
app.use(errorMiddleware);
