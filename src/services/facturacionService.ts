import logger from "../log/loggerGeneral";
import loggerFacturacion from "../log/loggerFacturacion";
import {ParametrosRepo} from '../data/parametrosRepository';
import { Afip } from "afip.ts";
import fs from "fs";
import path from "path";
import { ObjFacturar, TipoComprobante } from "../models/objFacturar";
import config from '../conf/app.config';
import { VentasRepo } from '../data/ventasRepository';
import moment from "moment";
import { EmpresasRepo } from "../data/empresasRepository";
import { AppError } from "../logger/AppError";
import { CodigoError } from "../logger/CodigosError";
import db from '../db';
const QRCode = require('qrcode');

const afipInstances: Record<string, any> = {};


class FacturacionService{
    async Facturar(objFactura:ObjFacturar, requestId?: string){
        await VerificarEntorno();

        const datosFacturacion = await EmpresasRepo.ObtenerEmpresa(objFactura.idEmpresa!);
        const afip = await ObtenerInstanciaAfip(datosFacturacion.cuil);

        //Verificamos el estado del servidor ARCA
        const serverStatus = await afip.electronicBillingService.getServerStatus();
        if (
        !serverStatus ||
        serverStatus.FEDummyResult.AppServer !== 'OK' ||
        serverStatus.FEDummyResult.DbServer !== 'OK' ||
        serverStatus.FEDummyResult.AuthServer !== 'OK'
        ) {
            throw new AppError(
                CodigoError.AFIP_NO_DISPONIBLE,
                'Servicio de ARCA no disponible.',
                503
            );
        }

        //Tipos de comprobante
        // 1 → Factura A
        // 6 → Factura B
        // 11 → Factura C

        // Tipos de IVA
        // 3 → 0%
        // 4 → 10,5%
        // 5 → 21%
        // 6 → 27%
        
        const date = new Date(Date.now() - ((new Date()).getTimezoneOffset() * 60000)).toISOString().split('T')[0];

        if (requiereAsociacion(objFactura.tipoComprobante!) && !objFactura.comprobanteAsociado) {
            throw new AppError(CodigoError.VALIDACION, 'Las notas requieren comprobante asociado',400);
        }

        // Factura A discrimina IVA
        // Factura B no discrimina IVA pero es necesario pasar el IVA incluido en ImpIVA
        // Factura C no necesita de IVA en ningun sentido, neto será igual al total
        let neto = 0;
        let iva = 0;

        const discriminaIVA = [
            TipoComprobante.FACTURA_A,
            TipoComprobante.FACTURA_B,
            TipoComprobante.NC_A,
            TipoComprobante.NC_B,
            TipoComprobante.ND_A,
            TipoComprobante.ND_B
        ].includes(objFactura.tipoComprobante!);

        if(discriminaIVA){
            neto = Math.round((objFactura.total! / 1.21) * 100) / 100;
            iva = Math.round((objFactura.total! - neto) * 100) / 100;
        }else{
            neto = objFactura.total!;
        }

        let data : any = {
            CantReg: 1, // Cantidad de comprobantes a registrar
            PtoVta: datosFacturacion.puntoVta, // Punto de venta
            CbteTipo: objFactura.tipoComprobante, // Tipo de comprobante (ver tipos disponibles)
            Concepto: 1, // Concepto del Comprobante: (1)Productos, (2)Servicios, (3)Productos y Servicios
            DocTipo: objFactura.docTipo, // Tipo de documento del comprador (99 consumidor final, ver tipos disponibles)
            DocNro: objFactura.docNro, // Número de documento del comprador (0 consumidor final)
            CbteDesde: 1, // Número de comprobante o numero del primer comprobante en caso de ser mas de uno
            CbteHasta: 1, // Número de comprobante o numero del último comprobante en caso de ser mas de uno
            CbteFch: date.replace(/-/g, ""), // (Opcional) Fecha del comprobante (yyyymmdd) o fecha actual si es nulo
            ImpTotal: objFactura.total, // Importe total del comprobante
            ImpTotConc: 0, // Importe neto no gravado
            ImpNeto: neto, // Importe neto gravado
            ImpOpEx: 0, // Importe exento de IVA
            ImpIVA: iva, //Importe total de IVA
            CondicionIVAReceptorId: objFactura.condReceptor, //Condicion frente al iva del receptor
            ImpTrib: 0, //Importe total de tributos
            MonId: "PES", //Tipo de moneda usada en el comprobante (ver tipos disponibles)('PES' para pesos argentinos)
            MonCotiz: 1, // Cotización de la moneda usada (1 para pesos argentinos)
        };

        // Solo agregamos el campo `Iva` si es una Factura/Nota A o B
        if (discriminaIVA) {
            data.Iva = [
            {
                Id: 5, // 21%
                BaseImp: neto,
                Importe: iva
            }
            ];
        }

        //Si estamos haciendo Nota credito/debito
        if (objFactura.comprobanteAsociado) {
            data.CbtesAsoc = [
                {
                Tipo: objFactura.comprobanteAsociado.tipo,
                PtoVta: objFactura.comprobanteAsociado.puntoVenta,
                Nro: objFactura.comprobanteAsociado.numero
                }
            ];
        }

        const cuit = datosFacturacion.cuil!;
        const pto = datosFacturacion.puntoVta!;
        const tipo = objFactura.tipoComprobante!;

        // F1.3 - Serializacion por talonario (HANDOFF blindaje facturacion, sec. F1.3).
        // El nombre del lock incluye la base: GET_LOCK es global al SERVIDOR de MySQL,
        // asi que si testing y produccion comparten servidor se bloquearian entre si sin esto.
        const nombreLock = `fe_${config.db.database}_${cuit}_${pto}_${tipo}`;
        const lockConnection = await db.getConnection();
        let lockObtenido = false;

        try {
            const [lockRows]: any = await lockConnection.query('SELECT GET_LOCK(?, 15) AS obtenido', [nombreLock]);
            lockObtenido = Number(lockRows?.[0]?.obtenido) === 1;

            if (!lockObtenido) {
                throw new AppError(
                    CodigoError.FACTURACION_EN_CURSO,
                    'Hay otra facturación en curso para este punto de venta. Intente en unos segundos.',
                    409,
                    { modulo: 'FacturacionService', metodo: 'Facturar', cuit, pto, tipo }
                );
            }

            // F1.1 - numero explicito desde ARCA (createNextVoucher hace internamente
            // getLastVoucher + 1 y perdia el numero real con dos emisiones simultaneas).
            // F1.2 - mismo getLastVoucher sirve para la correlatividad contra la DB.
            const ultimoArca = (await afip.electronicBillingService.getLastVoucher(pto, tipo)).CbteNro;
            const ultimoLocal = await ObtenerUltimoTicketLocal(cuit, pto, tipo);

            if (ultimoArca !== ultimoLocal) {
                const correlatividadEstrictaTest = config.facturacion?.correlatividadEstricta === true;
                if (config.produccion === true || correlatividadEstrictaTest) {
                    throw new AppError(
                        CodigoError.CORRELATIVIDAD_ARCA,
                        `El último comprobante en ARCA (${ultimoArca}) no coincide con el último registrado (${ultimoLocal}) para PtoVta ${pto} tipo ${tipo}. No se emite.`,
                        409,
                        { modulo: 'FacturacionService', metodo: 'Facturar', cuit, pto, tipo, ultimoArca, ultimoLocal }
                    );
                }
                // En homologacion, sin el flag, la numeracion de ARCA no tiene relacion
                // con una DB de testing que puede ser un clon de produccion: solo se
                // loguea el descalce, no se bloquea (ver HANDOFF F1.2).
                logger.warn(
                    `[correlatividad ARCA] descalce en homologacion (no bloquea): cuit=${cuit} pto=${pto} tipo=${tipo} ultimoArca=${ultimoArca} ultimoLocal=${ultimoLocal}`
                );
            }

            const nro = ultimoArca + 1;
            data.CbteDesde = nro;
            data.CbteHasta = nro;

            let res: any;
            try {
                res = await afip.electronicBillingService.createVoucher(data);
            } catch (err: any) {
                const pareceTimeout = err?.code === 'ECONNRESET'
                    || err?.code === 'ETIMEDOUT'
                    || err?.message?.includes('socket')
                    || err?.message?.toLowerCase?.().includes('timeout');

                if (!pareceTimeout) {
                    throw new AppError(
                        CodigoError.AFIP_ERROR, 'Ocurrió un error al intentar generar el comprobante', 500,
                        { modulo: 'FacturacionService', metodo: 'Facturar', cuit, pto, tipo, nro },
                        err
                    );
                }

                // F1.4 - un timeout NO significa que el comprobante no se emitio: puede
                // haber quedado autorizado en ARCA. Reconciliar antes de decidir.
                await new Promise(resolve => setTimeout(resolve, 3000));

                let info: any = null;
                try {
                    info = await afip.electronicBillingService.getVoucherInfo(nro, pto, tipo);
                } catch {
                    info = null; // ARCA sigue sin responder, tratamos como si no hubiera info
                }

                if (info?.Resultado === 'A' && info?.CodAutorizacion) {
                    logger.warn({
                        code: CodigoError.COMPROBANTE_RECUPERADO,
                        message: `Comprobante recuperado tras timeout: CAE ${info.CodAutorizacion}, Nro ${info.CbteDesde}`,
                        cuit, pto, tipo, nro
                    });
                    return {
                        estado: 'Aprobado',
                        cae: info.CodAutorizacion,
                        caeVto: moment(info.FchVto, 'YYYYMMDD'),
                        ticket: info.CbteDesde,
                        ptoVenta: pto,
                        neto,
                        iva
                    };
                }

                let ultimoTrasTimeout: number | undefined;
                try {
                    ultimoTrasTimeout = (await afip.electronicBillingService.getLastVoucher(pto, tipo)).CbteNro;
                } catch {
                    ultimoTrasTimeout = undefined;
                }

                if (ultimoTrasTimeout === nro - 1) {
                    // Confirmado: el numero no se consumio, se puede reintentar.
                    throw new AppError(
                        CodigoError.AFIP_TIMEOUT,
                        'ARCA no respondió (timeout). El comprobante no se emitió, puede reintentar.',
                        504,
                        { modulo: 'FacturacionService', metodo: 'Facturar', cuit, pto, tipo, nro },
                        err
                    );
                }

                // Ni se pudo confirmar que existe ni que no existe: NO reintentar.
                throw new AppError(
                    CodigoError.COMPROBANTE_INCIERTO,
                    `ARCA no confirmó si el comprobante ${nro} se emitió. NO reintente: verifique en ARCA antes de volver a facturar.`,
                    504,
                    { modulo: 'FacturacionService', metodo: 'Facturar', cuit, pto, tipo, nro, payload: data },
                    err
                );
            }

            // F1.5 - solo diagnostico: no se toca el calculo de neto/iva que se manda a
            // ARCA. El campo neto/iva no esta tipado en el modelo backend de ObjFacturar
            // porque hoy no se usa para nada mas que este chequeo (lo manda el front,
            // ver ObjFacturar en el front y hallazgo 6 del handoff).
            const netoFront = (objFactura as any).neto;
            if (typeof netoFront === 'number' && Math.abs(netoFront - neto) > 0.01) {
                logger.warn({
                    code: CodigoError.NETO_DESCALCE,
                    message: `Neto enviado por la app (${netoFront}) difiere del neto calculado para ARCA (${neto})`,
                    idEmpresa: objFactura.idEmpresa, tipo, netoFront, netoCalculado: neto
                });
            }

            //Detalle de la respuesta
            const detalle = res.response?.FeDetResp?.FECAEDetResponse?.[0];

            //COMPROBANTE APROBADO
            if (detalle?.Resultado === 'A') {
                return {
                    estado: 'Aprobado',
                    cae: detalle.CAE,
                    caeVto: moment(detalle.CAEFchVto, 'YYYYMMDD'),
                    ticket: detalle.CbteDesde,
                    ptoVenta: pto,
                    neto,
                    iva
                };
            }

            //COMPROBANTE RECHAZADO
            const observacionesAfip = detalle?.Observaciones?.Obs ?? [];
            const erroresAfip = res.response?.Errors?.Err ?? [];

            const mensajes = [
            ...observacionesAfip.map(o => `OBS ${o.Code}: ${o.Msg}`),
            ...erroresAfip.map(e => `ERR ${e.Code}: ${e.Msg}`)
            ];

            if (mensajes.length === 0) {
                mensajes.push('ARCA rechazó el comprobante sin detalles');
            };

            //logeamos mensajes por separado
            mensajes.forEach(m => loggerFacturacion.error(`${requestId ? `[Ref: ${requestId}] ` : ''}${m}`));

            //Devolvemos y logeamos error tecnico
            throw new AppError(
                CodigoError.AFIP_RECHAZO, 'El comprobante fue rechazado por ARCA', 422,
                {
                    modulo: 'FacturacionService',
                    metodo: 'Facturar',
                    detallesAfip: mensajes,
                    resultadoAfip: detalle?.Resultado
                }
            );
        } finally {
            if (lockObtenido) {
                try {
                    await lockConnection.query('SELECT RELEASE_LOCK(?)', [nombreLock]);
                } catch (e: any) {
                    logger.warn(`No se pudo liberar el lock ${nombreLock}: ${e?.message}`);
                }
            }
            lockConnection.release();
        }
    }

    async ObtenerQRFactura(idVenta){
        try {

            let datosQR = await VentasRepo.ObtenerQRFactura(idVenta);
            const datosFacturacion = await EmpresasRepo.ObtenerEmpresa(datosQR.idEmpresa!);

            if(datosQR){
                datosQR.cuit = datosFacturacion.cuil;

                const jsonBase64 = Buffer.from(JSON.stringify(datosQR)).toString('base64');
                const url = `https://www.arca.gob.ar/fe/qr/?p=${jsonBase64}`;

                return await QRCode.toDataURL(url);
            }
          
            return null;

        } catch (error) {
            throw new AppError(
                CodigoError.QR_ERROR,
                'No se pudo generar el QR de la factura.', 500,
                { modulo: 'FacturacionService', metodo: 'ObtenerQRFactura' }
            );
        }
    }
}


async function ObtenerInstanciaAfip(cuilTitular): Promise<Afip> {
    await VerificarEntorno();

    // Reutilizar instancia
    if (afipInstances[cuilTitular]) {
        return afipInstances[cuilTitular];
    }

    console.log(`Obteniendo instancia de AFIP para CUIT ${cuilTitular}...`); // Log para seguimiento

    //#region Definir carpeta de certificados según entorno
    const certFolder = config.produccion
        ? path.resolve(__dirname, `../certs/${cuilTitular}`)
        : path.resolve(__dirname, `../certs/test`);

    if (!fs.existsSync(certFolder)) {
        throw new AppError(
            CodigoError.CERTIFICADOS,
            `No existe la carpeta de certificados: ${certFolder}`,
            400
        );
    }
    //#endregion

   //#region Certificados y Token TA
    const certPath = path.join(certFolder, 'cert');
    const keyPath  = path.join(certFolder, 'key');

    if (!fs.existsSync(certPath)) {
        throw new AppError(CodigoError.CERTIFICADOS, `No se encontró archivo cert en ${certFolder}`, 400);
    }

    if (!fs.existsSync(keyPath)) {
        throw new AppError(CodigoError.CERTIFICADOS, `No se encontró archivo key en ${certFolder}`, 400);
    }

    const cert = fs.readFileSync(certPath, 'utf8').trim();
    const key  = fs.readFileSync(keyPath, 'utf8').trim();

    const isProd = config.produccion;
    const cuilCertificado = isProd ? cuilTitular : config.cuilTest;

    console.log(`Certificados cargados para CUIT ${cuilTitular} (entorno: ${isProd ? 'producción' : 'test'})`); // Log para seguimiento

    // La lib afip.js usa ticketPath como directorio base, no como archivo
    // Estructura resultante: tokens/test/ o tokens/{cuit}/
    const ticketPath = isProd
        ? path.resolve(__dirname, `../tokens/${cuilTitular}`)
        : path.resolve(__dirname, `../tokens/test`);

    fs.mkdirSync(ticketPath, { recursive: true });

    const afip = new Afip({
        key,
        cert,
        cuit: cuilCertificado,
        production: isProd,
        ticketPath
    });
    //#endregion

    afipInstances[cuilTitular] = afip;
    return afip;
}

function requiereAsociacion(tipo: TipoComprobante): boolean {
  return [
    TipoComprobante.NC_A,
    TipoComprobante.NC_B,
    TipoComprobante.NC_C,
    TipoComprobante.ND_A,
    TipoComprobante.ND_B,
    TipoComprobante.ND_C
  ].includes(tipo);
}

export const FacturacionServ = new FacturacionService();


/**
 * Ultimo ticket registrado localmente para un talonario fiscal (F1.2 - HANDOFF
 * blindaje facturacion). La clave fiscal es CUIT emisor + ptoVenta + tipoFactura,
 * no idEmpresa (puede haber mas de una empresa con el mismo CUIT - verificar en la
 * DB real si esto pasa en produccion). ventas_factura todavia no tiene columna de
 * emisor (llega en F3), por eso el join contra ventas + empresas.
 *
 * A proposito NO se filtra por ventas.fechaBaja: DarBajaVenta es una baja logica,
 * el numero fiscal ya se consumio en ARCA. Se incluyen las filas con
 * regularizacionArca = 1 (son comprobantes reales, cuentan para la correlatividad).
 */
async function ObtenerUltimoTicketLocal(cuit: number, ptoVenta: number, tipoFactura: number): Promise<number> {
    const connection = await db.getConnection();
    try {
        const [rows]: any = await connection.query(
            `SELECT MAX(vf.ticket) AS ultimoTicket
             FROM ventas_factura vf
             JOIN ventas v ON v.id = vf.idVenta
             JOIN empresas e ON e.id = v.idEmpresa
             WHERE e.cuil = ? AND vf.ptoVenta = ? AND vf.tipoFactura = ?`,
            [cuit, ptoVenta, tipoFactura]
        );
        return Number(rows?.[0]?.ultimoTicket ?? 0);
    } finally {
        connection.release();
    }
}


/**
 * Chequeo de coherencia de entorno antes de tocar ARCA (F0.3 - HANDOFF blindaje facturacion).
 *
 * Fail-closed: si algo no se puede confirmar, bloquea la facturacion en vez de arriesgar
 * un comprobante real emitido desde el ambiente equivocado (ver Incidente B del handoff).
 * No tira el proceso: solo esta llamada (Facturar / ObtenerInstanciaAfip) queda bloqueada,
 * el resto del sistema sigue funcionando.
 */
async function VerificarEntorno(): Promise<void> {
    // 1) Si el build quedo marcado como produccion, el proceso tiene que correr con NODE_ENV=prod.
    if (config.produccion === true && process.env.NODE_ENV !== 'prod') {
        throw new AppError(
            CodigoError.ENTORNO_INVALIDO,
            'La configuracion de este build esta marcada como produccion pero el proceso no corre con NODE_ENV=prod. Facturacion bloqueada.',
            500,
            { modulo: 'FacturacionService', metodo: 'VerificarEntorno', nodeEnv: process.env.NODE_ENV, produccion: config.produccion }
        );
    }

    // 2) El parametro 'entorno' de la DB (seteado a mano por DB, ver F0.4) tiene que coincidir
    //    con NODE_ENV. Si no existe o no coincide, se bloquea (fail-closed): p.ej. un clon de
    //    produccion sobre testing sin volver a correr el seed de testing.
    const entornoDb = await ParametrosRepo.ObtenerParametros('entorno');
    if (!entornoDb || entornoDb !== process.env.NODE_ENV) {
        throw new AppError(
            CodigoError.ENTORNO_INVALIDO,
            `El parametro 'entorno' de la base de datos (${entornoDb ?? 'no cargado'}) no coincide con NODE_ENV (${process.env.NODE_ENV}). Facturacion bloqueada.`,
            500,
            { modulo: 'FacturacionService', metodo: 'VerificarEntorno', nodeEnv: process.env.NODE_ENV, entornoDb: entornoDb ?? null }
        );
    }
}
