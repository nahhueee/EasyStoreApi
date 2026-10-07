import { logger } from "../logger/logger";
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
import { FeEmisionesRepo } from "../data/feEmisionesRepository";
import db from '../db';
import { PoolConnection } from 'mysql2/promise';
import { Venta } from '../models/Venta';
import { FacturaVenta } from '../models/FacturaVenta';
import { EstadoEmision } from '../models/EstadoEmision';
const QRCode = require('qrcode');

const afipInstances: Record<string, any> = {};


class FacturacionService{
    // F4.1 - HANDOFF blindaje facturacion y logs. Arma la instancia de ARCA y el payload
    // a enviar (data/neto/iva/cuit/pto/tipo), sin tocar lock/correlatividad/CAE todavia.
    // Extraido de Facturar() para que Emitir() (endpoint /ventas/emitir) lo comparta sin
    // duplicar la logica - el contenido es identico al que tenia Facturar() antes de F4.1.
    private async ConstruirDatosEmision(objFactura: ObjFacturar): Promise<{ afip: Afip, data: any, neto: number, iva: number, cuit: number, pto: number, tipo: number }> {
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

        // F4.3 - HANDOFF blindaje facturacion y logs. Extraido a CalcularNetoIva (mismo
        // calculo, sin cambios) para que Regularizar() pueda reproducirlo sin volver a
        // llamar a ARCA (a diferencia de este metodo, que si la llama mas abajo).
        const { neto, iva, discriminaIVA } = this.CalcularNetoIva(objFactura);

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

        return { afip, data, neto, iva, cuit, pto, tipo };
    }

    // F4.1 - Adquiere el GET_LOCK del talonario (F1.3). Si no se obtiene, tira
    // FACTURACION_EN_CURSO y libera la conexion (no hay nada que destrabar). Si se
    // obtiene, el caller es responsable de liberar con LiberarLockTalonario en su finally.
    private async LockTalonario(cuit: number, pto: number, tipo: number, metodo: string): Promise<{ lockConnection: PoolConnection, nombreLock: string }> {
        // F1.3 - Serializacion por talonario (HANDOFF blindaje facturacion, sec. F1.3).
        // El nombre del lock incluye la base: GET_LOCK es global al SERVIDOR de MySQL,
        // asi que si testing y produccion comparten servidor se bloquearian entre si sin esto.
        const nombreLock = `fe_${config.db.database}_${cuit}_${pto}_${tipo}`;
        const lockConnection = await db.getConnection();

        const [lockRows]: any = await lockConnection.query('SELECT GET_LOCK(?, 15) AS obtenido', [nombreLock]);
        const lockObtenido = Number(lockRows?.[0]?.obtenido) === 1;

        if (!lockObtenido) {
            lockConnection.release();
            throw new AppError(
                CodigoError.FACTURACION_EN_CURSO,
                'Hay otra facturación en curso para este punto de venta. Intente en unos segundos.',
                409,
                { modulo: 'FacturacionService', metodo, cuit, pto, tipo }
            );
        }

        return { lockConnection, nombreLock };
    }

    private async LiberarLockTalonario(lockConnection: PoolConnection, nombreLock: string): Promise<void> {
        try {
            await lockConnection.query('SELECT RELEASE_LOCK(?)', [nombreLock]);
        } catch (e: any) {
            logger.warn(`No se pudo liberar el lock ${nombreLock}: ${e?.message}`);
        }
        lockConnection.release();
    }

    // F4.1 - Reconciliacion de filas colgadas (F3.3) + correlatividad (F1.2) + calculo
    // del numero explicito. Debe correr con el lock del talonario ya tomado. Identico al
    // tramo que tenia Facturar() antes de F4.1.
    private async PrepararNumeroEmision(afip: Afip, cuit: number, pto: number, tipo: number, requestId: string | undefined, metodo: string): Promise<number> {
        // F3.3 - HANDOFF blindaje facturacion y logs. Un talonario con una fila
        // fe_emisiones PENDIENTE colgada (>2 min, seguramente un proceso que murio
        // antes de actualizar el estado) o INCIERTO (timeout sin confirmar, ver F1.4)
        // NO puede emitir de nuevo hasta reconciliarse: podria estar pidiendo un CAE
        // para un numero que en realidad ya tiene uno. Se corre ANTES de calcular
        // ultimoArca/ultimoLocal para esta emision, con el mismo talonario ya
        // serializado por el lock de arriba.
        await ReconciliarFilaBloqueante(afip, cuit, pto, tipo, requestId);

        // F1.1 - numero explicito desde ARCA (createNextVoucher hace internamente
        // getLastVoucher + 1 y perdia el numero real con dos emisiones simultaneas).
        // F1.2 - mismo getLastVoucher sirve para la correlatividad contra la DB.
        const ultimoArca = (await afip.electronicBillingService.getLastVoucher(pto, tipo)).CbteNro;

        // F3.3 - ultimoLocal ya no sale solo de ventas_factura (F1.2): fe_emisiones
        // es la fuente durable de "que numero se consumio de verdad" y puede ir un
        // paso adelante de ventas_factura (p.ej. un APROBADO todavia sin idVenta
        // vinculado porque /agregar no se llamo todavia). Se toma el mayor de los
        // dos y se loguea si difieren - una diferencia real ahi es señal de que algo
        // no esta sincronizado y amerita revision, no debe pasar desapercibida.
        const ultimoLocalFe = await FeEmisionesRepo.ObtenerUltimoNroLocal(cuit, pto, tipo);
        const ultimoLocalVf = await ObtenerUltimoTicketLocal(cuit, pto, tipo);
        const ultimoLocal = Math.max(ultimoLocalFe, ultimoLocalVf);

        if (ultimoLocalFe !== ultimoLocalVf) {
            logger.error({
                code: CodigoError.CORRELATIVIDAD_ARCA,
                message: `[correlatividad local] fe_emisiones (${ultimoLocalFe}) y ventas_factura (${ultimoLocalVf}) no coinciden para cuit=${cuit} pto=${pto} tipo=${tipo}. Se toma ${ultimoLocal}.`,
                requestId,
                context: { modulo: 'FacturacionService', metodo, cuit, pto, tipo, ultimoLocalFe, ultimoLocalVf }
            });
        }

        if (ultimoArca !== ultimoLocal) {
            const correlatividadEstrictaTest = config.facturacion?.correlatividadEstricta === true;
            if (config.produccion === true || correlatividadEstrictaTest) {
                throw new AppError(
                    CodigoError.CORRELATIVIDAD_ARCA,
                    `El último comprobante en ARCA (${ultimoArca}) no coincide con el último registrado (${ultimoLocal}) para PtoVta ${pto} tipo ${tipo}. No se emite.`,
                    409,
                    { modulo: 'FacturacionService', metodo, cuit, pto, tipo, ultimoArca, ultimoLocal }
                );
            }
            // En homologacion, sin el flag, la numeracion de ARCA no tiene relacion
            // con una DB de testing que puede ser un clon de produccion: solo se
            // loguea el descalce, no se bloquea (ver HANDOFF F1.2).
            // F2 - logueado como error (no solo warn) para que quede visible en la
            // pantalla de Errores con la severidad de CORRELATIVIDAD_ARCA (ver SEVERIDAD).
            // Sigue sin bloquear la emision: es diagnostico, no control.
            logger.error({
                code: CodigoError.CORRELATIVIDAD_ARCA,
                message: `[correlatividad ARCA] descalce en homologacion (no bloquea): cuit=${cuit} pto=${pto} tipo=${tipo} ultimoArca=${ultimoArca} ultimoLocal=${ultimoLocal}`,
                requestId,
                context: { modulo: 'FacturacionService', metodo, cuit, pto, tipo, ultimoArca, ultimoLocal }
            });
        }

        return ultimoArca + 1;
    }

    // F4.1 - Pide el CAE (createVoucher) con el numero ya reservado en fe_emisiones
    // (idEmision, fila PENDIENTE) y resuelve el resultado: aprueba, rechaza o deja
    // INCIERTO segun F1.4. Devuelve {cae, caeVto, ticket} si aprueba; en cualquier otro
    // caso tira (throw) el AppError correspondiente, igual que hacia Facturar() antes de
    // F4.1 - el llamador decide que hacer con eso (Facturar solo la propaga; Emitir hace
    // rollback de la venta).
    private async SolicitarCAE(afip: Afip, data: any, nro: number, idEmision: number, cuit: number, pto: number, tipo: number, requestId: string | undefined, objFactura: ObjFacturar, neto: number, iva: number, metodo: string): Promise<{ cae: string, caeVto: moment.Moment, ticket: number }> {
        let res: any;
        try {
            res = await afip.electronicBillingService.createVoucher(data);
        } catch (err: any) {
            const pareceTimeout = err?.code === 'ECONNRESET'
                || err?.code === 'ETIMEDOUT'
                || err?.message?.includes('socket')
                || err?.message?.toLowerCase?.().includes('timeout');

            if (!pareceTimeout) {
                // Error tecnico antes/durante el envio (no timeout): se asume que el
                // request nunca llego a ARCA, igual que hacia esta rama antes de F3
                // (comportamiento sin cambios). La fila fe_emisiones se marca
                // RECHAZADO (no INCIERTO): el numero no se consumio y el proximo
                // intento lo puede reutilizar, mismo criterio que un rechazo real
                // de ARCA - no es que ARCA lo haya rechazado, pero el efecto sobre
                // la correlatividad es el mismo (nro libre).
                await FeEmisionesRepo.MarcarRechazado(idEmision, {
                    payloadArca: data,
                    respuestaArca: { motivo: 'error tecnico antes de confirmar envio a ARCA (no timeout)', error: err?.message }
                });
                throw new AppError(
                    CodigoError.AFIP_ERROR, 'Ocurrió un error al intentar generar el comprobante', 500,
                    { modulo: 'FacturacionService', metodo, cuit, pto, tipo, nro },
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
                await FeEmisionesRepo.MarcarAprobado(idEmision, {
                    cae: info.CodAutorizacion,
                    caeVto: moment(info.FchVto, 'YYYYMMDD').format('YYYY-MM-DD'),
                    payloadArca: data,
                    respuestaArca: info
                });
                logger.error({
                    code: CodigoError.COMPROBANTE_RECUPERADO,
                    message: `Comprobante recuperado tras timeout: CAE ${info.CodAutorizacion}, Nro ${info.CbteDesde}`,
                    requestId,
                    context: { modulo: 'FacturacionService', metodo, cuit, pto, tipo, nro, cae: info.CodAutorizacion }
                });
                return {
                    cae: info.CodAutorizacion,
                    caeVto: moment(info.FchVto, 'YYYYMMDD'),
                    ticket: info.CbteDesde
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
                await FeEmisionesRepo.MarcarRechazado(idEmision, {
                    payloadArca: data,
                    respuestaArca: { motivo: 'timeout, ARCA confirmo que el comprobante no se emitio', ultimoTrasTimeout }
                });
                throw new AppError(
                    CodigoError.AFIP_TIMEOUT,
                    'ARCA no respondió (timeout). El comprobante no se emitió, puede reintentar.',
                    504,
                    { modulo: 'FacturacionService', metodo, cuit, pto, tipo, nro },
                    err
                );
            }

            // Ni se pudo confirmar que existe ni que no existe: NO reintentar. La
            // fila queda INCIERTO y bloquea el talonario (ver ReconciliarFilaBloqueante)
            // hasta que se resuelva sola en un proximo intento o a mano.
            await FeEmisionesRepo.MarcarIncierto(idEmision, {
                payloadArca: data,
                respuestaArca: { motivo: 'timeout, ARCA no confirmo ni existencia ni ausencia', error: err?.message }
            });
            throw new AppError(
                CodigoError.COMPROBANTE_INCIERTO,
                `ARCA no confirmó si el comprobante ${nro} se emitió. NO reintente: verifique en ARCA antes de volver a facturar.`,
                504,
                { modulo: 'FacturacionService', metodo, cuit, pto, tipo, nro, payload: data },
                err
            );
        }

        // F1.5 - solo diagnostico: no se toca el calculo de neto/iva que se manda a
        // ARCA. El campo neto/iva no esta tipado en el modelo backend de ObjFacturar
        // porque hoy no se usa para nada mas que este chequeo (lo manda el front,
        // ver ObjFacturar en el front y hallazgo 6 del handoff).
        const netoFront = (objFactura as any).neto;
        if (typeof netoFront === 'number' && Math.abs(netoFront - neto) > 0.01) {
            logger.error({
                code: CodigoError.NETO_DESCALCE,
                message: `Neto enviado por la app (${netoFront}) difiere del neto calculado para ARCA (${neto})`,
                requestId,
                context: { modulo: 'FacturacionService', metodo, idEmpresa: objFactura.idEmpresa, tipo, netoFront, netoCalculado: neto }
            });
        }

        //Detalle de la respuesta
        const detalle = res.response?.FeDetResp?.FECAEDetResponse?.[0];

        //COMPROBANTE APROBADO
        if (detalle?.Resultado === 'A') {
            await FeEmisionesRepo.MarcarAprobado(idEmision, {
                cae: detalle.CAE,
                caeVto: moment(detalle.CAEFchVto, 'YYYYMMDD').format('YYYY-MM-DD'),
                payloadArca: data,
                respuestaArca: res.response
            });
            return {
                cae: detalle.CAE,
                caeVto: moment(detalle.CAEFchVto, 'YYYYMMDD'),
                ticket: detalle.CbteDesde
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

        await FeEmisionesRepo.MarcarRechazado(idEmision, {
            payloadArca: data,
            respuestaArca: { observaciones: observacionesAfip, errores: erroresAfip, resultado: detalle?.Resultado }
        });

        //Devolvemos y logeamos error tecnico (detallesAfip queda en el context del
        //AppError de abajo; errorMiddleware lo loguea junto con requestId/ref)
        throw new AppError(
            CodigoError.AFIP_RECHAZO, 'El comprobante fue rechazado por ARCA', 422,
            {
                modulo: 'FacturacionService',
                metodo,
                detallesAfip: mensajes,
                resultadoAfip: detalle?.Resultado
            }
        );
    }

    async Facturar(objFactura:ObjFacturar, requestId?: string, usuario?: string){
        const { afip, data, neto, iva, cuit, pto, tipo } = await this.ConstruirDatosEmision(objFactura);

        const { lockConnection, nombreLock } = await this.LockTalonario(cuit, pto, tipo, 'Facturar');

        try {
            const nro = await this.PrepararNumeroEmision(afip, cuit, pto, tipo, requestId, 'Facturar');
            data.CbteDesde = nro;
            data.CbteHasta = nro;

            // F3.3 - se guarda la fila PENDIENTE ANTES de pedir el CAE (regla del
            // HANDOFF sec. 2: "nunca se pide un CAE a ARCA sin haber guardado antes, de
            // forma durable y fuera de la transaccion de la venta, que se va a pedir").
            // Conexion propia en autocommit dentro del repositorio, no la de este lock.
            const idEmision = await FeEmisionesRepo.InsertarOReintentarPendiente({
                idEmpresa: objFactura.idEmpresa!,
                cuitEmisor: cuit,
                ptoVenta: pto,
                tipoCbte: tipo,
                nro,
                payloadVenta: objFactura,
                entornoProduccion: config.produccion === true,
                usuario,
                requestId
            });

            const resultado = await this.SolicitarCAE(afip, data, nro, idEmision, cuit, pto, tipo, requestId, objFactura, neto, iva, 'Facturar');

            return {
                estado: 'Aprobado',
                cae: resultado.cae,
                caeVto: resultado.caeVto,
                ticket: resultado.ticket,
                ptoVenta: pto,
                neto,
                iva,
                idEmision
            };
        } finally {
            await this.LiberarLockTalonario(lockConnection, nombreLock);
        }
    }

    // F4.1 - HANDOFF blindaje facturacion y logs. Endpoint unificado POST /ventas/emitir:
    // valida -> lock+reconciliacion+correlatividad+numero -> persiste la venta (stock
    // incluido, FOR UPDATE) EN SU PROPIA TRANSACCION -> fila PENDIENTE -> pide el CAE ->
    // segun el resultado, completa la venta con la factura y comitea, o revierte todo.
    // A diferencia de Facturar() (que sigue existiendo para Cotizacion/NC X, ver F4.2),
    // aca la venta nunca se persiste sin que ARCA haya aprobado el comprobante (o, si el
    // guardado posterior falla, sin dejar registro en fe_emisiones para Regularizar).
    async Emitir(venta: Venta, objFactura: ObjFacturar, modificando: boolean, requestId?: string, usuario?: string): Promise<{ estado: string, cae?: string, caeVto?: moment.Moment, ticket?: number, idVenta?: string, idEmision?: number, neto?: number, iva?: number, ptoVenta?: number }> {
        // 1. Validaciones de negocio que ya existen en Agregar() (ValidarFacturacionDePresupuesto),
        // sin tocar ARCA. Conexion propia y corta, igual que Agregar().
        const conexionValidacion = await db.getConnection();
        let errorPresupuesto: string | null;
        try {
            errorPresupuesto = await VentasRepo.ValidarPresupuestoParaFacturar(conexionValidacion, venta);
        } finally {
            conexionValidacion.release();
        }
        if (errorPresupuesto) {
            throw new AppError(CodigoError.VALIDACION, errorPresupuesto, 400, { modulo: 'FacturacionService', metodo: 'Emitir' });
        }

        // Fix oct-2026 - el contrato de /emitir es que venta.factura llega VACIA: la arma
        // este metodo con lo que devuelve ARCA (paso 6.A). Si viene precargada,
        // PersistirVentaNueva/Existente (AgregarBody/ModificarBody) la insertaria tal cual
        // en ventas_factura ANTES de pedir el CAE. Caso real: notas-venta reutilizaba
        // nuevaVenta entre una NC y la siguiente y mandaba la factura de la NC anterior
        // (Duplicate entry en uq_vf_comprobante). Se descarta y se loguea para que el
        // bug del front quede visible en la pantalla de Errores sin bloquear al operador.
        if (venta.factura) {
            logger.error({
                code: CodigoError.VALIDACION,
                message: '/ventas/emitir recibio venta.factura precargada; se descarta (la factura la arma el backend con la respuesta de ARCA).',
                requestId,
                context: {
                    modulo: 'FacturacionService',
                    metodo: 'Emitir',
                    idEmpresa: objFactura.idEmpresa,
                    tipoComprobante: objFactura.tipoComprobante,
                    facturaDescartada: {
                        tipoComprobante: (venta.factura as any).tipoComprobante,
                        ptoVenta: (venta.factura as any).ptoVenta,
                        ticket: (venta.factura as any).ticket,
                        cae: (venta.factura as any).cae
                    }
                }
            });
            venta.factura = undefined;
        }

        // 2. Entorno + datos de emision + lock del talonario + reconciliacion +
        // correlatividad + numero explicito. Mismo tramo que usa Facturar().
        const { afip, data, neto, iva, cuit, pto, tipo } = await this.ConstruirDatosEmision(objFactura);
        const { lockConnection, nombreLock } = await this.LockTalonario(cuit, pto, tipo, 'Emitir');

        try {
            const nro = await this.PrepararNumeroEmision(afip, cuit, pto, tipo, requestId, 'Emitir');
            data.CbteDesde = nro;
            data.CbteHasta = nro;

            // 3. Persistir la venta (incluido el descuento de stock con FOR UPDATE, ver
            // ActualizarInventario) DENTRO de una transaccion propia, ANTES de llamar a
            // ARCA. Si falla (ej. STOCK_INSUFICIENTE), se aborta sin haber pedido nada.
            const connection = await db.getConnection();
            let transaccionCerrada = false;
            let idEmision: number | undefined;

            try {
                await connection.beginTransaction();

                if (modificando) {
                    await VentasRepo.PersistirVentaExistente(connection, venta, usuario ?? '');
                } else {
                    await VentasRepo.PersistirVentaNueva(connection, venta, usuario ?? '');
                }

                // 4. Fila PENDIENTE en fe_emisiones (conexion propia, autocommit, fuera
                // de la transaccion de la venta - regla del HANDOFF sec. 2).
                idEmision = await FeEmisionesRepo.InsertarOReintentarPendiente({
                    idEmpresa: objFactura.idEmpresa!,
                    cuitEmisor: cuit,
                    ptoVenta: pto,
                    tipoCbte: tipo,
                    nro,
                    // F4.3 - HANDOFF blindaje facturacion y logs. `modificando` viaja en
                    // el payload (antes solo venta/objFactura) para que Regularizar() sepa si
                    // tiene que insertar o actualizar al reconstruir esta venta.
                    payloadVenta: { venta, objFactura, modificando },
                    entornoProduccion: config.produccion === true,
                    usuario,
                    requestId
                });

                // 5. Pedir el CAE. Si rechaza/da timeout-rechazado/queda INCIERTO,
                // SolicitarCAE ya marco fe_emisiones acorde y tira: cae al catch de
                // abajo, que revierte la venta (nunca llego a existir de verdad).
                const resultado = await this.SolicitarCAE(afip, data, nro, idEmision, cuit, pto, tipo, requestId, objFactura, neto, iva, 'Emitir');

                // 6.A - Aprobado: completar la factura con el resultado y vincularla,
                // todavia dentro de la misma transaccion de la venta.
                venta.factura = new FacturaVenta({
                    idEmision,
                    cae: resultado.cae,
                    caeVto: resultado.caeVto,
                    ticket: resultado.ticket,
                    tipoComprobante: objFactura.tipoComprobante,
                    neto,
                    iva,
                    dni: objFactura.docNro,
                    tipoDni: objFactura.docTipo,
                    ptoVenta: pto,
                    condReceptor: objFactura.condReceptor,
                    comprobanteAsociado: objFactura.comprobanteAsociado
                });

                try {
                    await VentasRepo.VincularFacturaVenta(connection, venta);
                    await connection.commit();
                    transaccionCerrada = true;
                } catch (errorRegistro: any) {
                    // El CAE ya es real y esta aprobado en ARCA, pero el guardado de la
                    // venta fallo despues (ej. corte de DB). NO se reintenta ni se pierde:
                    // fe_emisiones pasa a APROBADO_SIN_REGISTRAR (con el mismo payloadVenta
                    // guardado en el paso 4) para Regularizar desde F4.3 sin volver a
                    // llamarle a ARCA (handoff F4.1 paso 6.A).
                    await connection.rollback();
                    transaccionCerrada = true;
                    await FeEmisionesRepo.MarcarAprobadoSinRegistrar(idEmision, {
                        cae: resultado.cae,
                        caeVto: resultado.caeVto.format('YYYY-MM-DD'),
                        respuestaArca: { motivo: 'CAE aprobado por ARCA pero fallo el guardado de la venta', error: errorRegistro?.message }
                    });
                    throw new AppError(
                        CodigoError.COMPROBANTE_SIN_REGISTRAR,
                        `El comprobante ${resultado.ticket} fue emitido en ARCA (CAE ${resultado.cae}) pero no se pudo registrar. NO vuelva a facturar esta venta. Quedó en Pendientes fiscales (Ref: ${idEmision}).`,
                        500,
                        { modulo: 'FacturacionService', metodo: 'Emitir', idEmision, cae: resultado.cae },
                        errorRegistro
                    );
                }

                return {
                    estado: 'Aprobado',
                    cae: resultado.cae,
                    caeVto: resultado.caeVto,
                    ticket: resultado.ticket,
                    idVenta: venta.id?.toString(),
                    idEmision,
                    // F4.2 - HANDOFF blindaje facturacion y logs. El front arma el
                    // FacturaVenta que persiste en pantalla con estos valores (antes
                    // usaba su propio calculo de neto/iva) y con ptoVenta para mostrarlo.
                    neto,
                    iva,
                    ptoVenta: pto
                };
            } catch (error: any) {
                if (!transaccionCerrada) {
                    try { await connection.rollback(); } catch { /* nada que revertir */ }
                }
                throw error;
            } finally {
                connection.release();
            }
        } finally {
            await this.LiberarLockTalonario(lockConnection, nombreLock);
        }
    }

    // Factura A discrimina IVA
    // Factura B no discrimina IVA pero es necesario pasar el IVA incluido en ImpIVA
    // Factura C no necesita de IVA en ningun sentido, neto será igual al total
    private CalcularNetoIva(objFactura: ObjFacturar): { neto: number; iva: number; discriminaIVA: boolean } {
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

        return { neto, iva, discriminaIVA };
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

    // F4.3 - HANDOFF blindaje facturacion y logs. "Verificar en ARCA" de la pantalla
    // Pendientes fiscales: corre la misma consulta que la reconciliacion previa a
    // emitir (F1.4/F3.3), pero sobre una fila INCIERTO puntual elegida por el admin,
    // no sobre la que este bloqueando el talonario ahora mismo.
    async VerificarEnArca(idEmision: number, requestId?: string): Promise<{ estado: string }> {
        const fila = await FeEmisionesRepo.ObtenerPorId(idEmision);
        if (!fila) {
            throw new AppError(CodigoError.NOT_FOUND, `No existe fe_emisiones #${idEmision}.`, 404, { modulo: 'FacturacionService', metodo: 'VerificarEnArca', idEmision });
        }
        if (fila.estado !== EstadoEmision.INCIERTO) {
            throw new AppError(CodigoError.VALIDACION, `El comprobante #${idEmision} no está en estado INCIERTO (está en ${fila.estado}).`, 400, { modulo: 'FacturacionService', metodo: 'VerificarEnArca', idEmision });
        }

        const afip = await ObtenerInstanciaAfip(fila.cuitEmisor);
        const resultado = await ResolverFilaIncierta(afip, fila, fila.cuitEmisor, fila.ptoVenta, fila.tipoCbte, requestId, false);
        return { estado: resultado.estado };
    }

    // F4.3 - HANDOFF blindaje facturacion y logs. "Regularizar": persiste la venta desde
    // el `payloadVenta` guardado, con el CAE ya real, SIN volver a llamar a ARCA (regla
    // de negocio: el comprobante fiscal manda). Deja fe_emisiones en REGULARIZADO recien
    // DESPUES de que la venta este confirmada en la base - si algo falla, la fila queda
    // tal cual estaba (APROBADO_SIN_REGISTRAR/APROBADO sin idVenta) para reintentar.
    async Regularizar(idEmision: number, motivo: string, usuario: string, requestId?: string): Promise<{ estado: string; idVenta: string }> {
        if (!motivo || !motivo.trim()) {
            throw new AppError(CodigoError.VALIDACION, 'El motivo es obligatorio para regularizar.', 400, { modulo: 'FacturacionService', metodo: 'Regularizar', idEmision });
        }

        const fila = await FeEmisionesRepo.ObtenerPorId(idEmision);
        if (!fila) {
            throw new AppError(CodigoError.NOT_FOUND, `No existe fe_emisiones #${idEmision}.`, 404, { modulo: 'FacturacionService', metodo: 'Regularizar', idEmision });
        }

        // Mismo criterio que ObtenerPendientes(): APROBADO_SIN_REGISTRAR, o un APROBADO
        // cuyo idVenta quedo NULL (ver comentario en feEmisionesRepository.VincularVenta).
        const esRegularizable = fila.estado === EstadoEmision.APROBADO_SIN_REGISTRAR
            || (fila.estado === EstadoEmision.APROBADO && !fila.idVenta);
        if (!esRegularizable) {
            throw new AppError(CodigoError.VALIDACION, `El comprobante #${idEmision} no está pendiente de regularizar (está en ${fila.estado}).`, 400, { modulo: 'FacturacionService', metodo: 'Regularizar', idEmision });
        }
        if (!fila.payloadVenta) {
            throw new AppError(CodigoError.VALIDACION, `El comprobante #${idEmision} no tiene el payload de la venta guardado - no se puede regularizar automáticamente.`, 400, { modulo: 'FacturacionService', metodo: 'Regularizar', idEmision });
        }

        const payload = typeof fila.payloadVenta === 'string' ? JSON.parse(fila.payloadVenta) : fila.payloadVenta;
        const venta: Venta = payload.venta;
        const objFactura: ObjFacturar = payload.objFactura;
        const modificando: boolean = !!payload.modificando;
        const { neto, iva } = this.CalcularNetoIva(objFactura);

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            await VentasRepo.PersistirVentaRegularizada(connection, venta, usuario, modificando);

            venta.factura = new FacturaVenta({
                idEmision: fila.id,
                cae: fila.cae,
                caeVto: fila.caeVto,
                ticket: fila.nro,
                tipoComprobante: objFactura?.tipoComprobante,
                neto,
                iva,
                dni: objFactura?.docNro,
                tipoDni: objFactura?.docTipo,
                ptoVenta: fila.ptoVenta,
                condReceptor: objFactura?.condReceptor,
                comprobanteAsociado: objFactura?.comprobanteAsociado
            });

            await VentasRepo.VincularFacturaVenta(connection, venta);
            await connection.commit();
        } catch (error: any) {
            try { await connection.rollback(); } catch { /* nada que revertir */ }
            throw new AppError(
                CodigoError.INTERNAL_ERROR,
                `No se pudo regularizar el comprobante #${idEmision}: ${error?.message ?? 'error desconocido'}. La fila sigue pendiente, se puede reintentar.`,
                500,
                { modulo: 'FacturacionService', metodo: 'Regularizar', idEmision },
                error
            );
        } finally {
            connection.release();
        }

        // Fuera de la transaccion de la venta a proposito, mismo criterio que el resto
        // de fe_emisiones (ver comentario de la clase en feEmisionesRepository.ts):
        // si esto fallara despues de un commit exitoso, la venta ya quedo bien y esto
        // se puede reintentar sin duplicar nada (MarcarRegularizado es idempotente).
        await FeEmisionesRepo.MarcarRegularizado(fila.id, usuario, motivo.trim());

        return { estado: EstadoEmision.REGULARIZADO, idVenta: venta.id!.toString() };
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
 *
 * F3.3: sigue existiendo como piso minimo/cruce de F3.3 (ver ultimoLocalVf en
 * Facturar()), pero fe_emisiones (FeEmisionesRepo.ObtenerUltimoNroLocal) es ahora
 * la fuente principal.
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
 * F3.3 - HANDOFF blindaje facturacion y logs. Reconcilia la fila de fe_emisiones que
 * este bloqueando el talonario (INCIERTO, o PENDIENTE de mas de 2 minutos) ANTES de
 * dejar avanzar una nueva emision. Mismo mecanismo de consulta que F1.4 (getVoucherInfo
 * + getLastVoucher) pero disparado al INICIO de Facturar() en vez de en el catch de
 * createVoucher, porque la fila puede venir de un intento anterior (otro request, o el
 * mismo proceso que se cayo).
 *
 * Si no puede resolverse, tira COMPROBANTE_INCIERTO y dejar la fila en ese estado: el
 * talonario sigue bloqueado hasta el proximo intento (o resolucion manual en F4).
 */
/**
 * F4.3 - HANDOFF blindaje facturacion y logs. Cuerpo de la reconciliacion (F1.4/F3.3),
 * extraido de ReconciliarFilaBloqueante para poder correrlo tambien sobre una fila
 * puntual elegida por el admin ("Verificar en ARCA" en Pendientes fiscales), no solo
 * sobre la que este bloqueando el talonario. Logica identica a la que tenia
 * ReconciliarFilaBloqueante - solo se movio, no se reescribio.
 *
 * `lanzarSiSigueIncierto` preserva el comportamiento original (bloquear con
 * COMPROBANTE_INCIERTO) para el caso "previo a una nueva emision"; en false (uso desde
 * Pendientes fiscales) devuelve el estado resultante en vez de tirar error.
 */
async function ResolverFilaIncierta(afip: Afip, fila: any, cuit: number, pto: number, tipo: number, requestId: string | undefined, lanzarSiSigueIncierto: boolean): Promise<{ estado: EstadoEmision }> {
    let info: any = null;
    try {
        info = await afip.electronicBillingService.getVoucherInfo(fila.nro, pto, tipo);
    } catch {
        info = null;
    }

    if (info?.Resultado === 'A' && info?.CodAutorizacion) {
        await FeEmisionesRepo.MarcarAprobado(fila.id, {
            cae: info.CodAutorizacion,
            caeVto: moment(info.FchVto, 'YYYYMMDD').format('YYYY-MM-DD'),
            respuestaArca: info
        });
        logger.error({
            code: CodigoError.COMPROBANTE_RECUPERADO,
            message: `[reconciliacion] fe_emisiones #${fila.id} (nro ${fila.nro}): comprobante existe en ARCA, CAE ${info.CodAutorizacion}.`,
            requestId,
            context: { modulo: 'FacturacionService', metodo: 'ResolverFilaIncierta', cuit, pto, tipo, idEmision: fila.id, nro: fila.nro, cae: info.CodAutorizacion }
        });
        return { estado: EstadoEmision.APROBADO };
    }

    let ultimoArcaCheck: number | undefined;
    try {
        ultimoArcaCheck = (await afip.electronicBillingService.getLastVoucher(pto, tipo)).CbteNro;
    } catch {
        ultimoArcaCheck = undefined;
    }

    if (ultimoArcaCheck === fila.nro - 1) {
        await FeEmisionesRepo.MarcarRechazado(fila.id, {
            respuestaArca: { motivo: 'reconciliacion: ARCA confirmo que no se emitio', ultimoArcaCheck }
        });
        logger.error({
            code: CodigoError.COMPROBANTE_RECUPERADO,
            message: `[reconciliacion] fe_emisiones #${fila.id} (nro ${fila.nro}): ARCA confirmo que no se emitio.`,
            requestId,
            context: { modulo: 'FacturacionService', metodo: 'ResolverFilaIncierta', cuit, pto, tipo, idEmision: fila.id, nro: fila.nro }
        });
        return { estado: EstadoEmision.RECHAZADO };
    }

    await FeEmisionesRepo.MarcarIncierto(fila.id, {
        respuestaArca: { motivo: 'reconciliacion: ARCA sigue sin confirmar', reintentoEn: new Date().toISOString() }
    });

    if (lanzarSiSigueIncierto) {
        throw new AppError(
            CodigoError.COMPROBANTE_INCIERTO,
            `Hay un comprobante (nro ${fila.nro}, PtoVta ${pto}, tipo ${tipo}) sin confirmar en ARCA. NO se puede emitir hasta resolverlo manualmente.`,
            504,
            { modulo: 'FacturacionService', metodo: 'ResolverFilaIncierta', cuit, pto, tipo, idEmision: fila.id, nro: fila.nro }
        );
    }
    return { estado: EstadoEmision.INCIERTO };
}

async function ReconciliarFilaBloqueante(afip: Afip, cuit: number, pto: number, tipo: number, requestId?: string): Promise<void> {
    const fila = await FeEmisionesRepo.ObtenerFilaBloqueante(cuit, pto, tipo);
    if (!fila) return;
    await ResolverFilaIncierta(afip, fila, cuit, pto, tipo, requestId, true);
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
