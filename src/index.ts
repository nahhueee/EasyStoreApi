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
app.use(morgan("dev"));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'upload')));

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
import cuentasRuta from './routes/cuentasCorsRoute';
import etiquetasRuta from './routes/etiquetasRoute';
import miscRuta from './routes/miscRoute';
import direccionesRuta from './routes/direccionesRoute';

app.use('/easystore/update', actualizacionRuta)
app.use('/easystore/usuarios', usuariosRuta);
app.use('/easystore/clientes', clientesRuta);
app.use('/easystore/rubros', rubrosRuta);
app.use('/easystore/productos', productosRuta);
app.use('/easystore/ventas', ventasRuta);
app.use('/easystore/movimientos', movimientosRuta);
app.use('/easystore/cajas', cajasRuta); 
app.use('/easystore/estadisticas', estadisticasRuta);
app.use('/easystore/parametros', parametrosRuta);
app.use('/easystore/logs', logsRuta);
app.use('/easystore/server', servidorRuta);
app.use('/easystore/cuentas', cuentasRuta);
app.use('/easystore/etiquetas', etiquetasRuta);
app.use('/easystore/misc', miscRuta);
app.use('/easystore/direcciones', direccionesRuta);

//AdminServer Route
import adminServerRuta from './routes/adminRoute';
app.use('/easystore/adminserver', adminServerRuta);

//Upload images Route
import imagenesRuta from './routes/imagenesRoute';
app.use('/easystore/imagenes', imagenesRuta);

//Files Route
import filesRoute from './routes/filesRoute';
app.use('/easystore/files', filesRoute);
//#endregion

//#region backups 
import backupRoute from './routes/backupRoute';
app.use('/easystore/backup', backupRoute);

import {BackupsServ} from './services/backupService';
if(!config.web)
    BackupsServ.IniciarCron();
//#endregion

import {ServidorServ} from './services/servidorService';
if(!config.web)
    ServidorServ.IniciarModoServidor();

//Index Route
app.get('/easystore', (req, res) => {
    res.status(200).send('Servidor de EasyStore funcionando en este puerto.');
});
 
//404
app.use((_req, res) => {
    res.status(404).send('No se encontró el recurso solicitado.');
});
  

