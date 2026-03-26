import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import config from './conf/app.config';
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
console.log(base)
app.get(`${base}`, (req, res) => {
    res.status(200).send('Servidor funcionando CHAZAGOLF en este puerto.');
});
//404
app.use((_req, res) => {
    res.status(404).send('No se encontró el recurso solicitado.');
});


//Manejo y logs de errores
import { errorMiddleware } from './middlewares/errorMiddleware';
app.use(errorMiddleware);
  

