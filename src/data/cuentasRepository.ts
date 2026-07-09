import moment from 'moment';
import db from '../db';
import { ResultSetHeader } from 'mysql2';
import { CuentaCorriente, VentasClienteCuenta } from '../models/CuentaCorriente';
import { MovimientoFondo } from '../models/MovimientoFondo';
import { SesionServ } from '../services/sesionService';
import { GetMetodoPago, GetIdFondoValoresAcreditar, GetIdFondoRetenciones, InsertValorAcreditar, InsertCheque, InsertRetencion } from './ventasRepository';

// Retención sufrida (Ganancias/IIBB/SUSS) al cobrar. Hoy solo se habilita en la UI
// para el método CHEQUE, pero vive desacoplada de `cheque` a propósito: es un
// atributo del pago/cobro, no del instrumento - el día que se habilite para otro
// método, este mismo campo se reutiliza sin tocar el modelo. Ver
// 20260705120000_create_retenciones.js.
interface RetencionDTO {
  tipo: string;    // 'GANANCIAS' | 'IIBB' | 'SUSS'
  importe: number;
}

interface pagoDTO {
  idMetodo: number;
  monto: number;
  cheque?: any; // datos del cheque cuando el método es de tipo CHEQUE
  retencion?: RetencionDTO;
}

interface EntregaDineroVentaDTO {
  idCaja:number;
  idCliente: number;
  idVenta: number;
  totalDeuda: number;
  pagos: pagoDTO[]
}

interface EntregaDineroDTO {
  idCaja:number;
  idCliente: number;
  idEmpresa: number;
  idMetodo: number;
  monto: number;
  observaciones: string;
  cheque?: any; // datos del cheque cuando el método es de tipo CHEQUE
  retencion?: RetencionDTO;
}


class CuentasRepository{

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();
        
        try {
            //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQuery(filtros,false);
            let queryTotal = await ObtenerQuery(filtros,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            const cuentas:CuentaCorriente[] = [];
    
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    
                    let cuenta:CuentaCorriente = new CuentaCorriente();
                    cuenta.cliente = row['cliente'];
                    cuenta.idCliente = row['idCliente'];
                    cuenta.debe = parseFloat(row['debe']);
                    cuenta.haber = parseFloat(row['haber']);
                    cuenta.saldo = parseFloat(row['saldo']);
                    cuenta.estado = row['estado'];
                    cuenta.ultimoMovimiento = row['ultimoMovimiento'];                   
                    cuentas.push(cuenta);
                }
            }
    
            return {total:resultado[0][0].total, registros:cuentas};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    // Export a Excel: mismos filtros que Obtener() (nombre, condicionIva,
    // condicionPago, documento), sin paginado, y solo cuentas que NO están al
    // día (Debe o A Favor) - ver HAVING saldo <> 0 en ObtenerQueryParaExcel.
    async ObtenerParaExcel(filtros:any){
        const connection = await db.getConnection();

        try {
            const query = await ObtenerQueryParaExcel(filtros);
            const [rows] = await connection.query(query);

            const cuentas:any[] = [];

            if (Array.isArray(rows)) {
                for (const row of rows as any[]) {
                    cuentas.push({
                        CodCliente: row['idCliente'],
                        Cliente: row['cliente'],
                        Debe: parseFloat(row['debe']),
                        Haber: parseFloat(row['haber']),
                        Saldo: parseFloat(row['saldo']),
                        Estado: row['estado'],
                        UltimoMovimiento: row['ultimoMovimiento']
                    });
                }
            }

            return cuentas;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerVentasCliente(filtros:any){
        const connection = await db.getConnection();
        
        try {
            //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQueryVentasCliente(filtros,false);
            let queryTotal = await ObtenerQueryVentasCliente(filtros,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            const ventas:VentasClienteCuenta[] = [];
    
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    
                    let venta:VentasClienteCuenta = new VentasClienteCuenta();
                    venta.id = row['id'];
                    venta.nroProceso = row['nroProceso'];
                    venta.proceso = row['proceso'];
                    venta.fecha = row['fecha'];
                    venta.comprobante = row['comprobante'];
                    venta.tipo = row['tipo'];
                    venta.debe = parseFloat(row['debe']);
                    venta.haber = parseFloat(row['haber']);
                    venta.saldo = parseFloat(row['saldo']);
                    venta.estado = row['estado'];     
                    venta.referencia = row['referencia'];
                    venta.observaciones = row['observaciones'];
                   
                    ventas.push(venta);
                }
            }

            return {total:resultado[0][0].total, registros:ventas};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerVentasClienteReporte(filtros:any){
        const connection = await db.getConnection();
        
        try {
            //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQueryVentasCliente(filtros,false,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);
            const ventas:VentasClienteCuenta[] = [];
    
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];
                    
                    let venta:VentasClienteCuenta = new VentasClienteCuenta();
                    venta.id = row['id'];
                    venta.nroProceso = row['nroProceso'];
                    venta.proceso = row['proceso'];
                    venta.fecha = row['fecha'];
                    venta.comprobante = row['comprobante'];
                    venta.tipo = row['tipo'];
                    venta.debe = parseFloat(row['debe']);
                    venta.haber = parseFloat(row['haber']);
                    venta.saldo = parseFloat(row['saldo']);
                    venta.estado = row['estado'];     
                    venta.referencia = row['referencia'];
                   
                    ventas.push(venta);
                }
            }

            return ventas;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerRecibo(idRecibo){
        const connection = await db.getConnection();
        
        try {
            const consulta = `
                SELECT
                    r.id,
                    r.fecha,
                    r.hora,
                    c.nombre AS cliente,

                    CASE
                        WHEN mp.tipo = 'CREDITO'
                            THEN CONCAT(f.nombre, ' - Crédito')

                        WHEN mp.tipo = 'DEBITO'
                            THEN CONCAT(f.nombre, ' - Débito')

                        WHEN mp.tipo = 'TRANSFERENCIA'
                            THEN CONCAT(f.nombre, ' - Transferencia')

                        ELSE mp.nombre
                    END AS metodoPago,

                    vp.monto AS montoPago,

                    ved.montoAplicado,
                    ved.tipoAplicacion,

                    v.id AS idVenta,
                    v.nroProceso,
                    pv.descripcion AS proceso,

                    r.total

                FROM recibos r
                JOIN clientes c ON c.id = r.idCliente

                LEFT JOIN ventas_entrega_detalle ved 
                    ON ved.idRecibo = r.id

                LEFT JOIN ventas_pagos vp 
                    ON vp.idRecibo = r.id

                LEFT JOIN metodos_pago mp 
                    ON mp.id = COALESCE(ved.idMetodoAplicado, vp.idMetodo)

            INNER JOIN fondos f ON f.id = mp.idFondo

                LEFT JOIN ventas v 
                    ON v.id = COALESCE(ved.idVenta, vp.idVenta)

                LEFT JOIN procesos_venta pv 
                    ON pv.id = v.idProceso

                WHERE r.id = ?
            `;
            
            const [rows]: any = await connection.query(consulta, [idRecibo]);
            console.log(`Recibo #${idRecibo} obtenido con ${rows.length} filas de detalle.`);
            const recibo = {
                id: rows[0].id,
                cliente: rows[0].cliente,
                fecha: rows[0].fecha,
                hora: rows[0].hora,
                total: Number(rows[0].total),

                pagos: Object.values(
                    rows.reduce((acc, r) => {
                        if (!r.metodoPago) return acc;

                        if (!acc[r.metodoPago]) {
                            acc[r.metodoPago] = {
                                metodo: r.metodoPago,
                                monto: 0
                            };
                        }

                        acc[r.metodoPago].monto += Number(
                            r.montoPago ?? r.montoAplicado ?? 0
                        );
                        return acc;
                    }, {})
                ),

                detalles: Object.values(
                    rows.reduce((acc, r, index) => {

                        const key = `${r.tipoAplicacion}_${r.idVenta || index}`;

                        if (!r.tipoAplicacion) return acc;

                        if (!acc[key]) {
                            acc[key] = {
                                tipoAplicacion: r.tipoAplicacion,
                                montoAplicado: Number(r.montoAplicado),

                                idVenta: r.idVenta || null,
                                nroProceso: r.nroProceso || null,
                                proceso: r.proceso || null
                            };
                        }

                        return acc;

                    }, {})
                ),
                ventas: Object.values(
                    rows.reduce((acc, r) => {
                        if (!r.idVenta) return acc;

                        if (!acc[r.idVenta]) {
                            acc[r.idVenta] = {
                                id: r.idVenta,
                                nroProceso: r.nroProceso,
                                proceso: r.proceso
                            };
                        }

                        return acc;
                    }, {})
                )
            };

            return recibo;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    async ObtenerSaldoCliente(idCliente){
        const connection = await db.getConnection();
        
        try {
            const [rows]: any = await connection.query(
                `
                SELECT 
                (
                    COALESCE(c.inicial, 0)

                    + COALESCE((
                        SELECT 
                            SUM(
                                CASE 
                                    WHEN v.idTComprobante NOT IN (3, 8, 13, 100)
                                    THEN v.total
                                    ELSE -v.total
                                END
                            )
                        FROM ventas v
                        WHERE v.fechaBaja IS NULL
                        AND v.idProceso NOT IN (5, 6, 7)
                        AND v.idCliente = c.id
                    ), 0)

                    - COALESCE((
                        SELECT SUM(vp.monto)
                        FROM ventas_pagos vp
                        JOIN recibos r ON r.id = vp.idRecibo
                        JOIN metodos_pago mp ON mp.id = vp.idMetodo
                        -- Por tipo, no por id fijo (13 solo es "Saldo a favor" en la
                        -- empresa 1) - mismo criterio que ObtenerQuery().
                        WHERE r.fechaBaja IS NULL
                        AND r.idCliente = c.id
                        AND mp.tipo <> 'SALDO_FAVOR'
                        -- Excluye la fila-ancla de cancelación de Saldo Inicial (cuando
                        -- el método necesita ancla: CHEQUE/CREDITO/retención). Esa plata
                        -- ya está reflejada en clientes.inicial (mutado a 0/menos), así
                        -- que sumarla acá de nuevo la restaba dos veces - mismo bug que
                        -- en la CTE entregas de ObtenerQuery(), corregido 07/2026.
                        AND NOT EXISTS (
                            SELECT 1 FROM ventas_entrega_detalle ved
                            WHERE ved.idRecibo = vp.idRecibo
                            AND ved.idVenta IS NULL
                            AND ved.montoAplicado = vp.monto
                            AND ved.tipoAplicacion = 'SALDO_INICIAL'
                        )
                    ), 0)

                ) AS saldoFinal

                FROM clientes c
                WHERE c.id = ?
                AND c.fechaBaja IS NULL;
                `,
                [idCliente]
            );

            return parseFloat(rows[0].saldoFinal);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //#endregion

    async EntregaDinero(data: EntregaDineroDTO): Promise<string> {
        const connection = await db.getConnection();

        //Obtengo el inicial del cliente para cancelarlo primero
        const [[cliente]]: any = await connection.query(
            `
            SELECT inicial
            FROM clientes
            WHERE id = ?
            `,
            [data.idCliente]
        );

        try {
            await connection.beginTransaction();

            // Obtener ventas a cancelar
            let ventasImpagas = await ObtenerVentasImpagas(connection, data.idCliente);
            const usuarioActivo = SesionServ.LeerSesion().usuario;

            // Se resuelve una sola vez: toda la entrega usa el mismo método de pago.
            // Si es Cheque/Crédito, la plata no es real todavía y va a "Valores a
            // Acreditar" (igual que en una venta normal, ver RegistrarMovimientosVenta
            // en ventasRepository.ts) en vez de entrar directo al fondo del método.
            // Se registra UN solo valores_acreditar por el monto total de la entrega
            // (no uno por cada venta que cancela) porque operativamente es un único
            // cheque/cupón físico, aunque internamente se reparta entre varias ventas.
            const { idFondo: idFondoDestino, tipo } = await GetMetodoPago(connection, data.idMetodo);
            const esValorAcreditar = ['CHEQUE', 'CREDITO'].includes(tipo);
            const idFondoValores = esValorAcreditar ? await GetIdFondoValoresAcreditar(connection) : null;

            // Retención sufrida (Ganancias/IIBB/SUSS): cancela deuda del cliente igual
            // que el resto de la entrega, pero no es plata real - se descuenta
            // proporcionalmente de cada fragmento que se aplica (saldo inicial, cada
            // venta, remanente a saldo a favor) y va a un fondo virtual aparte en vez
            // de a "Valores a Acreditar" o al fondo del método. Independiente de
            // esValorAcreditar a propósito: hoy solo llega desde el front para CHEQUE,
            // pero el backend no lo asume (ver RetencionDTO).
            const montoRetencion = data.retencion?.importe || 0;
            const montoTotalAplicar = data.monto + montoRetencion;
            const ratioCheque = montoTotalAplicar > 0 ? data.monto / montoTotalAplicar : 1;
            const idFondoRetenciones = montoRetencion > 0 ? await GetIdFondoRetenciones(connection) : null;
            // Ancla para valores_acreditar.idVentaPago / retenciones.idVentaPago (ambas
            // NOT NULL): se toma el primer ventas_pagos que se genere en esta entrega,
            // sea por saldo inicial, por una venta impaga, o por saldo a favor.
            const necesitaAncla = esValorAcreditar || montoRetencion > 0;
            let idVentaPagoAncla: number | null = null;

            // Registro de la Cabecera de entrega (monto total incluyendo retención: es
            // lo que efectivamente cancela/acredita la cuenta del cliente)
            const [res] = await connection.query<ResultSetHeader>(
                `
                INSERT INTO ventas_entrega (idCliente, monto, fecha)
                VALUES (?, ?, NOW())
                `,
                [data.idCliente, montoTotalAplicar]
            );
            const idEntrega = res.insertId;
            //=====================================

            // Registro del recibo (mismo criterio: total incluye retención, para que
            // coincida con la suma de ventas_pagos y no descuadre el extracto de cuenta)
            const [resRecibo] = await connection.query<ResultSetHeader>(
                `
                INSERT INTO recibos
                (idCliente, fecha, hora, total, observaciones)
                VALUES (?, CURRENT_DATE, CURRENT_TIME, ?, ?)
                `,
                [data.idCliente, montoTotalAplicar, data.observaciones]
            );
            const idRecibo = resRecibo.insertId;
            //=====================================

            //Definicion del monto
            let montoRestante = montoTotalAplicar;

            //Cancelación de deuda inicial
            if (cliente.inicial > 0 && montoRestante > 0) {

                const aplicadoInicial = Math.min(
                    cliente.inicial,
                    montoRestante
                );

                await connection.query(
                    `
                    UPDATE clientes
                    SET inicial = inicial - ?
                    WHERE id = ?
                    `,
                    [aplicadoInicial, data.idCliente]
                );

                //Agregamos un registro de detalle
                await connection.query(
                    `
                    INSERT INTO ventas_entrega_detalle
                    (
                        idEntrega,
                        idRecibo,
                        idVenta,
                        idMetodoAplicado,
                        montoAplicado,
                        tipoAplicacion
                    )
                    VALUES (?, ?, NULL, ?, ?, 'SALDO_INICIAL')
                    `,
                    [
                        idEntrega,
                        idRecibo,
                        data.idMetodo,
                        aplicadoInicial
                    ]
                );

                // La cancelación de saldo inicial no genera su propio ventas_pagos
                // (comportamiento previo sin cambios). Si esta entrega necesita ancla
                // (Cheque/Crédito o retención) y todavía no hay una, se crea acá un
                // ventas_pagos con idVenta NULL (mismo patrón que ya se usa para el
                // remanente de saldo a favor, más abajo).
                if (necesitaAncla && idVentaPagoAncla === null) {
                    const [pagoAncla] = await connection.query<ResultSetHeader>(
                        `
                        INSERT INTO ventas_pagos (idVenta, idMetodo, monto, idEntrega, idRecibo)
                        VALUES (NULL, ?, ?, ?, ?)
                        `,
                        [data.idMetodo, aplicadoInicial, idEntrega, idRecibo]
                    );
                    idVentaPagoAncla = pagoAncla.insertId;
                }

                // Sale de cuenta corriente
                await InsertMovimientoFondo(connection, {
                    idCaja: data.idCaja,
                    idFondo: 4,
                    tipo: 'EGRESO',
                    origen: 'COBRO_CC',
                    idReferencia: null,
                    monto: aplicadoInicial,
                    descripcion: `Cancelación saldo inicial cliente ${data.idCliente}`,
                    usuario: usuarioActivo
                });

                // Entra al fondo real / Valores a Acreditar (porción cheque) y al fondo
                // de Retenciones (porción retención), proporcional a este fragmento.
                const { cheque: chequeInicial, retencion: retencionInicial } = SplitFragmento(aplicadoInicial, ratioCheque);

                if (chequeInicial > 0) {
                    await InsertMovimientoFondo(connection, {
                        idCaja: data.idCaja,
                        idFondo: esValorAcreditar ? idFondoValores! : idFondoDestino,
                        tipo: 'INGRESO',
                        origen: 'COBRO_CC',
                        idReferencia: null,
                        monto: chequeInicial,
                        descripcion: esValorAcreditar
                            ? `Cobro saldo inicial cliente ${data.idCliente} - ${tipo} pendiente`
                            : `Cobro saldo inicial cliente ${data.idCliente}`,
                        usuario: usuarioActivo
                    });
                }

                if (retencionInicial > 0) {
                    await InsertMovimientoFondo(connection, {
                        idCaja: data.idCaja,
                        idFondo: idFondoRetenciones!,
                        tipo: 'INGRESO',
                        origen: 'COBRO_CC',
                        idReferencia: null,
                        monto: retencionInicial,
                        descripcion: `Retención ${data.retencion!.tipo} sufrida - saldo inicial cliente ${data.idCliente}`,
                        usuario: usuarioActivo
                    });
                }

                montoRestante -= aplicadoInicial;
            }

            // Recorrer ventas impagas para cancelarlas
            for (const venta of ventasImpagas) {
                if (montoRestante <= 0) break;

                const deuda = venta.total - venta.pagado;
                if (deuda <= 0) continue;

                const montoAplicado = Math.min(deuda, montoRestante);

                // Registro del Pago
                const [pagoResult] = await connection.query<ResultSetHeader>(
                    `
                    INSERT INTO ventas_pagos (idVenta, idMetodo, monto, idEntrega, idRecibo)
                    VALUES (?, ?, ?, ?, ?)
                    `,
                    [venta.id, data.idMetodo, montoAplicado, idEntrega, idRecibo]
                );
                if (idVentaPagoAncla === null) idVentaPagoAncla = pagoResult.insertId;

                // Detalle entrega
                await connection.query(
                    `
                    INSERT INTO ventas_entrega_detalle
                    (idEntrega, idRecibo, idVenta, idMetodoAplicado, montoAplicado)
                    VALUES (?, ?, ?, ?, ?)
                    `,
                    [idEntrega, idRecibo, venta.id, data.idMetodo, montoAplicado]
                );

                // ¿Quedó saldada?
                if (montoAplicado === deuda) {
                    await connection.query(
                    `UPDATE ventas SET impaga = 0 WHERE id = ?`,
                    [venta.id]
                    );
                }

                // Sale de cuenta corriente
                await InsertMovimientoFondo(connection, {
                    idCaja: data.idCaja,
                    idFondo: 4,
                    tipo: 'EGRESO',
                    origen: 'COBRO_CC',
                    idReferencia: venta.id,
                    monto: montoAplicado,
                    descripcion: `Cancelación deuda venta #${venta.id}`,
                    usuario: usuarioActivo
                });

                // Entra al fondo real / Valores a Acreditar (porción cheque) y al fondo
                // de Retenciones (porción retención), proporcional a este fragmento.
                const { cheque: chequeVenta, retencion: retencionVenta } = SplitFragmento(montoAplicado, ratioCheque);

                if (chequeVenta > 0) {
                    await InsertMovimientoFondo(connection, {
                        idCaja: data.idCaja,
                        idFondo: esValorAcreditar ? idFondoValores! : idFondoDestino,
                        tipo: 'INGRESO',
                        origen: 'COBRO_CC',
                        idReferencia: venta.id,
                        monto: chequeVenta,
                        descripcion: esValorAcreditar
                            ? `Cobro deuda venta #${venta.id} - ${tipo} pendiente`
                            : `Cobro deuda venta #${venta.id}`,
                        usuario: usuarioActivo
                    });
                }

                if (retencionVenta > 0) {
                    await InsertMovimientoFondo(connection, {
                        idCaja: data.idCaja,
                        idFondo: idFondoRetenciones!,
                        tipo: 'INGRESO',
                        origen: 'COBRO_CC',
                        idReferencia: venta.id,
                        monto: retencionVenta,
                        descripcion: `Retención ${data.retencion!.tipo} sufrida - venta #${venta.id}`,
                        usuario: usuarioActivo
                    });
                }

                montoRestante -= montoAplicado;
            }

            //Queda saldo pendiente?
            //Se guarda en saldo a favor del cliente
            if (montoRestante > 0) {
                const [pagoResult] = await connection.query<ResultSetHeader>(
                    `
                    INSERT INTO ventas_pagos (idVenta, idMetodo, monto, idEntrega, idRecibo)
                    VALUES (NULL, ?, ?, ?, ?)
                    `,
                    [data.idMetodo, montoRestante, idEntrega, idRecibo]
                );
                if (idVentaPagoAncla === null) idVentaPagoAncla = pagoResult.insertId;

                //Insertamos un registro de detalle
                await connection.query(
                    `
                    INSERT INTO ventas_entrega_detalle
                    (
                        idEntrega,
                        idRecibo,
                        idVenta,
                        idMetodoAplicado,
                        montoAplicado,
                        tipoAplicacion
                    )
                    VALUES (?, ?, NULL, ?, ?, 'SALDO_A_FAVOR')
                    `,
                    [
                        idEntrega,
                        idRecibo,
                        data.idMetodo,
                        montoRestante
                    ]
                );

                // Ingresa plata real / "Valores a Acreditar" (porción cheque) y fondo de
                // Retenciones (porción retención), proporcional a este remanente.
                const { cheque: chequeExcedente, retencion: retencionExcedente } = SplitFragmento(montoRestante, ratioCheque);

                if (chequeExcedente > 0) {
                    await InsertMovimientoFondo(connection, {
                        idCaja: data.idCaja,
                        idFondo: esValorAcreditar ? idFondoValores! : idFondoDestino,
                        tipo: 'INGRESO',
                        origen: 'INGRESO_MANUAL',
                        idReferencia: idEntrega,
                        monto: chequeExcedente,
                        descripcion: esValorAcreditar
                            ? `Entrega excedente cliente ${data.idCliente} - ${tipo} pendiente`
                            : `Entrega excedente cliente ${data.idCliente}`,
                        usuario: usuarioActivo
                    });
                }

                if (retencionExcedente > 0) {
                    await InsertMovimientoFondo(connection, {
                        idCaja: data.idCaja,
                        idFondo: idFondoRetenciones!,
                        tipo: 'INGRESO',
                        origen: 'INGRESO_MANUAL',
                        idReferencia: idEntrega,
                        monto: retencionExcedente,
                        descripcion: `Retención ${data.retencion!.tipo} sufrida - excedente cliente ${data.idCliente}`,
                        usuario: usuarioActivo
                    });
                }

                // Genera saldo a favor (reconocimiento contable de la deuda del cliente
                // hacia nosotros; no representa movimiento de fondo real, así que no se
                // ve afectado por si el método es Cheque/Crédito)
                await InsertMovimientoFondo(connection, {
                    idCaja: data.idCaja,
                    idFondo: 5,
                    tipo: 'INGRESO',
                    origen: 'AJUSTE',
                    idReferencia: idEntrega,
                    monto: montoRestante,
                    descripcion: `Saldo a favor cliente ${data.idCliente}`,
                    usuario: usuarioActivo
                });
            }

            // Cheque/Crédito: se registra UNA vez, por el monto total de la entrega,
            // el "valor a acreditar" pendiente de decidir a qué fondo real impacta.
            if (esValorAcreditar) {
                const idValor = await InsertValorAcreditar(connection, {
                    idEmpresa: data.idEmpresa,
                    idVentaPago: idVentaPagoAncla,
                    tipo: tipo === 'CREDITO' ? 'TARJETA_CREDITO' : 'CHEQUE',
                    monto: data.monto,
                    // CRÉDITO: el fondo destino es el banco real del método
                    // CHEQUE: null, se elige al momento de acreditar
                    idFondoDestino: tipo === 'CREDITO' ? idFondoDestino : null,
                    usuarioAlta: usuarioActivo
                });

                if (tipo === 'CHEQUE' && data.cheque) {
                    await InsertCheque(connection, idValor, data.cheque);
                }
            }

            // Retención: un solo registro por el monto total retenido de la entrega,
            // mismo criterio que valores_acreditar para el cheque (aunque el monto se
            // haya repartido en fragmentos entre varias ventas más arriba).
            if (montoRetencion > 0 && data.retencion) {
                await InsertRetencion(connection, idVentaPagoAncla!, data.retencion, usuarioActivo);
            }

            await connection.commit();
            return "OK";

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }


    async RevertirEntrega(idEntrega: number): Promise<string> {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // 1️⃣ Obtener detalle
            const [detalles] = await connection.query<any[]>(
                `
                SELECT idVenta, idMetodoAplicado, montoAplicado
                FROM ventas_entrega_detalle
                WHERE idEntrega = ?
                `,
                [idEntrega]
            );

            if (!detalles.length) {
                throw new Error("No se encontró la entrega");
            }

            // 2️⃣ Revertir pagos
            for (const d of detalles) {
                await connection.query(
                    `
                    DELETE FROM ventas_pagos
                    WHERE idVenta = ?
                    AND idEntrega = ?`,
                    [d.idVenta, idEntrega]
                );

                // 3️⃣ Recalcular estado de la venta (excluye CUENTA_CORRIENTE del
                // "pagado real" - mismo criterio que ObtenerVentasImpagas más abajo,
                // si no una venta financiada a CC recalculaba impaga=0 al revertir
                // cualquier otro pago suyo, aunque la deuda CC siga en pie).
                const [[venta]] = await connection.query<any[]>(
                    `
                    SELECT
                        v.total,
                        IFNULL(SUM(p.monto), 0) AS pagado
                    FROM ventas v
                    LEFT JOIN ventas_pagos p
                        ON p.idVenta = v.id
                        AND p.idMetodo NOT IN (SELECT id FROM metodos_pago WHERE tipo = 'CUENTA_CORRIENTE')
                    WHERE v.id = ?
                    GROUP BY v.id
                    `,
                    [d.idVenta]
                );

                const impaga = venta.pagado < venta.total ? 1 : 0;

                await connection.query(
                    `UPDATE ventas SET impaga = ? WHERE id = ?`,
                    [impaga, d.idVenta]
                );
            }

            // 4️⃣ Eliminar historial
            await connection.query(
                `DELETE FROM ventas_entrega_detalle WHERE idEntrega = ?`,
                [idEntrega]
            );

            await connection.query(
                `DELETE FROM ventas_entrega WHERE id = ?`,
                [idEntrega]
            );

            await connection.commit();
            return "OK";

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }


    async ActualizarPagosVenta(entrega:EntregaDineroVentaDTO): Promise<string>{
        const connection = await db.getConnection();
        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            if (!entrega.pagos || entrega.pagos.length === 0) {
                throw new Error("No hay pagos para aplicar");
            }
            
            // La deuda cancelada incluye tanto el monto del método (cheque, efectivo, etc.)
            // como cualquier retención sufrida: para el cliente, ambos cancelan su cuenta
            // corriente por igual (ver InsertRetencion más abajo para el porqué de la
            // separación contable entre uno y otro).
            let deudaCancelada:number = entrega.pagos?.reduce((acc, i) => acc + (i.monto || 0) + (i.retencion?.importe || 0), 0) || 0;
             if (deudaCancelada > entrega.totalDeuda) {
                throw new Error("El monto entregado supera la deuda");
            }

            //Insertamos la cabecera del registro de historial
            const [res] = await connection.query<ResultSetHeader>(
                `
                INSERT INTO ventas_entrega (idCliente, monto, fecha)
                VALUES (?, ?, NOW())
                `,
                [entrega.idCliente, deudaCancelada]
            );
            const idEntrega = res.insertId;

            //Creamos el recibo
            const [reciboRes] = await connection.query<ResultSetHeader>(
                `
                INSERT INTO recibos 
                (idCliente, fecha, hora, total)
                VALUES (?, CURRENT_DATE, CURRENT_TIME, ?)
                `,
                [
                    entrega.idCliente,
                    deudaCancelada
                ]
            );
            const idRecibo = reciboRes.insertId;
            const usuarioActivo = SesionServ.LeerSesion().usuario;

            // Necesario para poder registrar en valores_acreditar los pagos con
            // Cheque/Crédito (ver comentario más abajo).
            const [[ventaRow]]: any = await connection.query(
                "SELECT idEmpresa FROM ventas WHERE id = ?",
                [entrega.idVenta]
            );

            for (const element of entrega.pagos) {
                // El monto que cancela la venta incluye la retención (si hay): para el
                // cliente es plata que "puso" igual, aunque una parte no la vayamos a
                // cobrar nunca en efectivo/banco.
                const montoRetencion = element.retencion?.importe || 0;
                const montoTotalPago = element.monto + montoRetencion;

                //Insertamos los nuevos pagos
                const insertar = " INSERT INTO ventas_pagos(idVenta, idMetodo, idRecibo, monto, idEntrega) " +
                                " VALUES(?, ?, ?, ?, ?) ";
                const parametrosInsert = [entrega.idVenta, element.idMetodo, idRecibo, montoTotalPago, idEntrega];
                const [pagoResult] = await connection.query<ResultSetHeader>(insertar, parametrosInsert);
                const idVentaPago = pagoResult.insertId;

                //Insertamos los detalle de registro
                await connection.query(
                    `
                    INSERT INTO ventas_entrega_detalle
                    (idEntrega, idVenta, idMetodoAplicado, montoAplicado)
                    VALUES (?, ?, ?, ?)
                    `,
                    [idEntrega, entrega.idVenta, element.idMetodo, montoTotalPago]
                );

                const { idFondo: idFondoDestino, tipo } = await GetMetodoPago(connection, element.idMetodo);

                // Sale de cuenta corriente (esto pasa siempre, sea cual sea el método,
                // por el total incluyendo la retención)
                await InsertMovimientoFondo(connection, {
                    idCaja: entrega.idCaja,
                    idFondo: 4,
                    tipo: 'EGRESO',
                    origen: 'COBRO_CC',
                    idReferencia: entrega.idVenta,
                    monto: montoTotalPago,
                    descripcion: `Cancelación deuda venta #${entrega.idVenta}`,
                    usuario: usuarioActivo
                });

                // Cheque/Crédito: no es plata real todavía, va a "Valores a Acreditar"
                // en vez de entrar directo al fondo del método (igual que en una venta
                // normal, ver RegistrarMovimientosVenta en ventasRepository.ts).
                // Importante: usa element.monto (SIN la retención) - eso es lo único
                // que representa plata/valor real en tránsito.
                const esValorAcreditar = ['CHEQUE', 'CREDITO'].includes(tipo);

                if (esValorAcreditar) {
                    const idFondoValores = await GetIdFondoValoresAcreditar(connection);

                    await InsertMovimientoFondo(connection, {
                        idCaja: entrega.idCaja,
                        idFondo: idFondoValores,
                        tipo: 'INGRESO',
                        origen: 'COBRO_CC',
                        idReferencia: entrega.idVenta,
                        monto: element.monto,
                        descripcion: `Cobro deuda venta #${entrega.idVenta} - ${tipo} pendiente`,
                        usuario: usuarioActivo
                    });

                    const idValor = await InsertValorAcreditar(connection, {
                        idEmpresa: ventaRow?.idEmpresa,
                        idVentaPago,
                        tipo: tipo === 'CREDITO' ? 'TARJETA_CREDITO' : 'CHEQUE',
                        monto: element.monto,
                        // CRÉDITO: el fondo destino es el banco real del método
                        // CHEQUE: null, se elige al momento de acreditar
                        idFondoDestino: tipo === 'CREDITO' ? idFondoDestino : null,
                        usuarioAlta: usuarioActivo
                    });

                    if (tipo === 'CHEQUE' && element.cheque) {
                        await InsertCheque(connection, idValor, element.cheque);
                    }
                } else {
                    // Entra al fondo real
                    await InsertMovimientoFondo(connection, {
                        idCaja: entrega.idCaja,
                        idFondo: idFondoDestino,
                        tipo: 'INGRESO',
                        origen: 'COBRO_CC',
                        idReferencia: entrega.idVenta,
                        monto: element.monto,
                        descripcion: `Cobro deuda venta #${entrega.idVenta}`,
                        usuario: usuarioActivo
                    });
                }

                // Retención sufrida (independiente del método - hoy solo llega desde el
                // front cuando el método es CHEQUE, pero el backend no lo asume). No es
                // plata real: va al fondo virtual "Retenciones Sufridas" en vez de a
                // Valores a Acreditar o al fondo del método.
                if (montoRetencion > 0 && element.retencion) {
                    const idFondoRetenciones = await GetIdFondoRetenciones(connection);

                    await InsertMovimientoFondo(connection, {
                        idCaja: entrega.idCaja,
                        idFondo: idFondoRetenciones,
                        tipo: 'INGRESO',
                        origen: 'COBRO_CC',
                        idReferencia: entrega.idVenta,
                        monto: montoRetencion,
                        descripcion: `Retención ${element.retencion.tipo} sufrida - venta #${entrega.idVenta}`,
                        usuario: usuarioActivo
                    });

                    await InsertRetencion(connection, idVentaPago, element.retencion, usuarioActivo);
                }
            };

           
            if(entrega.totalDeuda == deudaCancelada){
                 //Actualizamos el estado de la venta
                const actualizar = " UPDATE ventas SET " +
                                " impaga = 0 WHERE id = ? ";
                const parametrosUpdate = [entrega.idVenta];
                await connection.query(actualizar, parametrosUpdate);
            }
           
            //Mandamos la transaccion
            await connection.commit();

            return "OK";

        } catch (error:any) {
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }
}

async function InsertMovimientoFondo(connection, movimiento:MovimientoFondo): Promise<void> {
    try {
        const consulta = `
            INSERT INTO movimientos_fondos
            (
                idCaja,
                idFondo,
                tipo,
                origen,
                idReferencia,
                monto,
                descripcion,
                usuario
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const parametros = [
            movimiento.idCaja,
            movimiento.idFondo,
            movimiento.tipo,
            movimiento.origen,
            movimiento.idReferencia ?? null,
            movimiento.monto,
            movimiento.descripcion ?? null,
            movimiento.usuario ?? null
        ];

        await connection.query(consulta, parametros);

    } catch (error) {
        throw error;
    }
}

// Reparte un fragmento (aplicadoInicial, montoAplicado por venta, o remanente a
// saldo a favor) en su porción "cheque" (plata/valor real) y su porción "retención"
// (crédito fiscal, no entra a ningún fondo real), según el ratio global de la
// entrega. Se redondea la porción cheque y la retención se calcula como la
// diferencia, para garantizar que ambas sumen exactamente el fragmento original
// (evita descuadres de centavos por redondeo independiente de cada lado).
function SplitFragmento(fragmento: number, ratioCheque: number): { cheque: number; retencion: number } {
    const cheque = Math.round(fragmento * ratioCheque * 100) / 100;
    const retencion = Math.round((fragmento - cheque) * 100) / 100;
    return { cheque, retencion };
}

async function ObtenerQuery(filtros:any,esTotal:boolean):Promise<string>{
    try {
        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.nombre != null && filtros.nombre != "") 
            filtro += " AND c.nombre LIKE '%"+ filtros.nombre.toUpperCase().trim() + "%'";
        if (filtros.condicionIva != null && filtros.condicionIva != "") 
            filtro += " AND c.idCondIva = "+ filtros.condicionIva;
        if (filtros.condicionPago != null && filtros.condicionPago != "") 
            filtro += " AND c.idCondicionPago = "+ filtros.condicionPago;
        if (filtros.documento != null && filtros.documento != 0) 
            filtro += " AND c.documento = " + filtros.documento;
        if (filtros.idCliente != null && filtros.idCliente != 0) 
            filtro += " AND c.id = "+ filtros.idCliente;
        // #endregion

        if (esTotal)
        {//Si esTotal agregamos para obtener un total de la consulta
            count = "SELECT COUNT(*) AS total FROM ( ";
            endCount = " ) as subquery";
        }
        else
        {//De lo contrario paginamos
            if (filtros.tamanioPagina != null)
                paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
        }
            
        //Arma la Query con el paginado y los filtros correspondientes
        query = count +
            `WITH
                -- 🟥 Ventas (deuda real)
                ventas_totales AS (
                    SELECT
                        idCliente,
                        SUM(total) AS totalVentas
                    FROM ventas
                    WHERE fechaBaja IS NULL
                    AND idTComprobante NOT IN (3,8,13,100)
                    -- Excluye Presupuesto/Pedido/Nota de Empaque (sin idTComprobante
                    -- todavía): no son deuda real hasta que se facturan - mismo
                    -- criterio que ObtenerSaldoCliente().
                    AND idProceso NOT IN (5,6,7)
                    GROUP BY idCliente
                ),

                -- 🟦 Notas de crédito
                notas_credito AS (
                    SELECT 
                        idCliente,
                        SUM(total) AS totalNC
                    FROM ventas
                    WHERE fechaBaja IS NULL
                    AND idTComprobante IN (3,8,13,100)
                    GROUP BY idCliente
                ),

                -- 💰 Pagos reales (EXCLUYE saldo a favor)
                pagos_ventas AS (
                    SELECT
                        v.idCliente,
                        SUM(vp.monto) AS totalPagos
                    FROM ventas_pagos vp
                    JOIN ventas v ON v.id = vp.idVenta
                    JOIN recibos r ON r.id = vp.idRecibo
                    JOIN metodos_pago mp ON mp.id = vp.idMetodo
                    -- Por tipo, no por id fijo (13 solo es "Saldo a favor" en la
                    -- empresa 1). En la práctica el JOIN con recibos ya deja afuera
                    -- los pagos de saldo a favor (siempre tienen idVenta NULL), así
                    -- que esto es consistencia con el resto de las queries, no un
                    -- bug activo conocido.
                    WHERE mp.tipo <> 'SALDO_FAVOR'
                    AND r.fechaBaja IS NULL
                    GROUP BY v.idCliente
                ),

                -- 💚 Entregas (saldo a favor generado)
                -- Se deriva de ventas_entrega_detalle (tipoAplicacion='SALDO_A_FAVOR'),
                -- no de "ventas_pagos con idVenta NULL": ese criterio también capturaba
                -- la fila-ancla que EntregaDinero genera para cancelar el Saldo Inicial
                -- cuando el método necesita ancla (CHEQUE/CREDITO/retención) - esa plata
                -- ya está reflejada en clientes.inicial (se mutó a 0/menos ahí), así que
                -- contarla de nuevo acá restaba dos veces la misma cancelación, dejando
                -- un crédito fantasma permanente. Tampoco captura ya el Saldo a Favor de
                -- Notas de Crédito (idMetodo=13, sin ventas_entrega): ese se cuenta aparte
                -- vía nc.totalNC, y con el criterio viejo también se duplicaba. Bug real:
                -- Venta #109 / cliente Club Náutico San Isidro, corregido 07/2026.
                entregas AS (
                    SELECT
                        ve.idCliente,
                        SUM(ved.montoAplicado) AS totalEntregas
                    FROM ventas_entrega_detalle ved
                    JOIN ventas_entrega ve ON ve.id = ved.idEntrega
                    JOIN recibos r ON r.id = ved.idRecibo
                    WHERE ved.tipoAplicacion = 'SALDO_A_FAVOR'
                    AND r.fechaBaja IS NULL
                    GROUP BY ve.idCliente
                ),

                -- 📅 Últimos movimientos
                ult_ventas AS (
                    SELECT 
                        idCliente,
                        MAX(TIMESTAMP(fecha, hora)) AS fechaVenta
                    FROM ventas
                    WHERE fechaBaja IS NULL
                    GROUP BY idCliente
                ),

                ult_recibos AS (
                    SELECT 
                        idCliente,
                        MAX(TIMESTAMP(fecha, hora)) AS fechaRecibo
                    FROM recibos
                    WHERE fechaBaja IS NULL
                    GROUP BY idCliente
                )

                SELECT
                    c.id AS idCliente,
                    c.nombre AS cliente,

                    -- 🧾 DEBE
                    (
                        COALESCE(v.totalVentas, 0)
                        + CASE 
                            WHEN COALESCE(c.inicial, 0) > 0 
                            THEN c.inicial 
                            ELSE 0 
                        END
                    ) AS debe,

                    -- 💰 HABER
                    (
                        COALESCE(pv.totalPagos, 0)
                        + COALESCE(e.totalEntregas, 0)
                        + COALESCE(nc.totalNC, 0)
                        + CASE 
                            WHEN COALESCE(c.inicial, 0) < 0 
                            THEN ABS(c.inicial) 
                            ELSE 0 
                        END
                    ) AS haber,

                    -- 💥 SALDO FINAL (CORREGIDO)
                    (
                        COALESCE(c.inicial, 0)
                        + COALESCE(v.totalVentas, 0)
                        - COALESCE(nc.totalNC, 0)
                        - COALESCE(pv.totalPagos, 0)
                        - COALESCE(e.totalEntregas, 0)
                    ) AS saldo,

                    -- 🟢 ESTADO
                    CASE
                        WHEN (
                            COALESCE(c.inicial, 0)
                            + COALESCE(v.totalVentas, 0)
                            - COALESCE(nc.totalNC, 0)
                            - COALESCE(pv.totalPagos, 0)
                            - COALESCE(e.totalEntregas, 0)
                        ) > 0 THEN 'Debe'

                        WHEN (
                            COALESCE(c.inicial, 0)
                            + COALESCE(v.totalVentas, 0)
                            - COALESCE(nc.totalNC, 0)
                            - COALESCE(pv.totalPagos, 0)
                            - COALESCE(e.totalEntregas, 0)
                        ) < 0 THEN 'A Favor'

                        ELSE 'Al Día'
                    END AS estado,

                    -- 📅 Último movimiento
                    GREATEST(
                        COALESCE(uv.fechaVenta, '1900-01-01'),
                        COALESCE(ur.fechaRecibo, '1900-01-01')
                    ) AS ultimoMovimiento

                FROM clientes c

                LEFT JOIN ventas_totales v ON v.idCliente = c.id
                LEFT JOIN notas_credito nc ON nc.idCliente = c.id
                LEFT JOIN pagos_ventas pv ON pv.idCliente = c.id
                LEFT JOIN entregas e ON e.idCliente = c.id
                LEFT JOIN ult_ventas uv ON uv.idCliente = c.id
                LEFT JOIN ult_recibos ur ON ur.idCliente = c.id

                WHERE c.fechaBaja IS NULL
                ${filtro}

                GROUP BY 
                    c.id,
                    c.nombre,
                    c.inicial,
                    v.totalVentas,
                    nc.totalNC,
                    pv.totalPagos,
                    e.totalEntregas,
                    uv.fechaVenta,
                    ur.fechaRecibo

                ORDER BY c.nombre ASC
            ` +
            paginado +
            endCount;
        
        return query;
            
    } catch (error) {
        throw error; 
    }
}

// Mismo query base que ObtenerQuery (mismas CTEs, mismo cálculo de debe/haber/
// saldo/estado), pero sin paginado y agregando HAVING saldo <> 0 para excluir
// las cuentas "Al Día". Se filtra por saldo (numérico) y no por el string
// 'estado' porque HAVING puede referenciar el alias del SELECT y es exactamente
// el mismo criterio que ya determina 'Debe'/'A Favor'/'Al Día' más abajo.
async function ObtenerQueryParaExcel(filtros:any):Promise<string>{
    try {
        let filtro:string = "";

        if (filtros.nombre != null && filtros.nombre != "")
            filtro += " AND c.nombre LIKE '%"+ filtros.nombre.toUpperCase().trim() + "%'";
        if (filtros.condicionIva != null && filtros.condicionIva != "")
            filtro += " AND c.idCondIva = "+ filtros.condicionIva;
        if (filtros.condicionPago != null && filtros.condicionPago != "")
            filtro += " AND c.idCondicionPago = "+ filtros.condicionPago;
        if (filtros.documento != null && filtros.documento != 0)
            filtro += " AND c.documento = " + filtros.documento;
        if (filtros.idCliente != null && filtros.idCliente != 0)
            filtro += " AND c.id = "+ filtros.idCliente;

        return `WITH
                ventas_totales AS (
                    SELECT
                        idCliente,
                        SUM(total) AS totalVentas
                    FROM ventas
                    WHERE fechaBaja IS NULL
                    AND idTComprobante NOT IN (3,8,13,100)
                    -- Excluye Presupuesto/Pedido/Nota de Empaque (sin idTComprobante
                    -- todavía): no son deuda real hasta que se facturan - mismo
                    -- criterio que ObtenerSaldoCliente().
                    AND idProceso NOT IN (5,6,7)
                    GROUP BY idCliente
                ),

                notas_credito AS (
                    SELECT
                        idCliente,
                        SUM(total) AS totalNC
                    FROM ventas
                    WHERE fechaBaja IS NULL
                    AND idTComprobante IN (3,8,13,100)
                    GROUP BY idCliente
                ),

                pagos_ventas AS (
                    SELECT
                        v.idCliente,
                        SUM(vp.monto) AS totalPagos
                    FROM ventas_pagos vp
                    JOIN ventas v ON v.id = vp.idVenta
                    JOIN recibos r ON r.id = vp.idRecibo
                    JOIN metodos_pago mp ON mp.id = vp.idMetodo
                    -- Por tipo, no por id fijo - ver mismo comentario en ObtenerQuery().
                    WHERE mp.tipo <> 'SALDO_FAVOR'
                    AND r.fechaBaja IS NULL
                    GROUP BY v.idCliente
                ),

                -- Ver comentario en ObtenerQuery() sobre por qué se deriva de
                -- ventas_entrega_detalle y no de "ventas_pagos con idVenta NULL".
                entregas AS (
                    SELECT
                        ve.idCliente,
                        SUM(ved.montoAplicado) AS totalEntregas
                    FROM ventas_entrega_detalle ved
                    JOIN ventas_entrega ve ON ve.id = ved.idEntrega
                    JOIN recibos r ON r.id = ved.idRecibo
                    WHERE ved.tipoAplicacion = 'SALDO_A_FAVOR'
                    AND r.fechaBaja IS NULL
                    GROUP BY ve.idCliente
                ),

                ult_ventas AS (
                    SELECT
                        idCliente,
                        MAX(TIMESTAMP(fecha, hora)) AS fechaVenta
                    FROM ventas
                    WHERE fechaBaja IS NULL
                    GROUP BY idCliente
                ),

                ult_recibos AS (
                    SELECT
                        idCliente,
                        MAX(TIMESTAMP(fecha, hora)) AS fechaRecibo
                    FROM recibos
                    WHERE fechaBaja IS NULL
                    GROUP BY idCliente
                )

                SELECT
                    c.id AS idCliente,
                    c.nombre AS cliente,

                    (
                        COALESCE(v.totalVentas, 0)
                        + CASE
                            WHEN COALESCE(c.inicial, 0) > 0
                            THEN c.inicial
                            ELSE 0
                        END
                    ) AS debe,

                    (
                        COALESCE(pv.totalPagos, 0)
                        + COALESCE(e.totalEntregas, 0)
                        + COALESCE(nc.totalNC, 0)
                        + CASE
                            WHEN COALESCE(c.inicial, 0) < 0
                            THEN ABS(c.inicial)
                            ELSE 0
                        END
                    ) AS haber,

                    (
                        COALESCE(c.inicial, 0)
                        + COALESCE(v.totalVentas, 0)
                        - COALESCE(nc.totalNC, 0)
                        - COALESCE(pv.totalPagos, 0)
                        - COALESCE(e.totalEntregas, 0)
                    ) AS saldo,

                    CASE
                        WHEN (
                            COALESCE(c.inicial, 0)
                            + COALESCE(v.totalVentas, 0)
                            - COALESCE(nc.totalNC, 0)
                            - COALESCE(pv.totalPagos, 0)
                            - COALESCE(e.totalEntregas, 0)
                        ) > 0 THEN 'Debe'

                        WHEN (
                            COALESCE(c.inicial, 0)
                            + COALESCE(v.totalVentas, 0)
                            - COALESCE(nc.totalNC, 0)
                            - COALESCE(pv.totalPagos, 0)
                            - COALESCE(e.totalEntregas, 0)
                        ) < 0 THEN 'A Favor'

                        ELSE 'Al Día'
                    END AS estado,

                    GREATEST(
                        COALESCE(uv.fechaVenta, '1900-01-01'),
                        COALESCE(ur.fechaRecibo, '1900-01-01')
                    ) AS ultimoMovimiento

                FROM clientes c

                LEFT JOIN ventas_totales v ON v.idCliente = c.id
                LEFT JOIN notas_credito nc ON nc.idCliente = c.id
                LEFT JOIN pagos_ventas pv ON pv.idCliente = c.id
                LEFT JOIN entregas e ON e.idCliente = c.id
                LEFT JOIN ult_ventas uv ON uv.idCliente = c.id
                LEFT JOIN ult_recibos ur ON ur.idCliente = c.id

                WHERE c.fechaBaja IS NULL
                ${filtro}

                GROUP BY
                    c.id,
                    c.nombre,
                    c.inicial,
                    v.totalVentas,
                    nc.totalNC,
                    pv.totalPagos,
                    e.totalEntregas,
                    uv.fechaVenta,
                    ur.fechaRecibo

                HAVING saldo <> 0

                ORDER BY c.nombre ASC
            `;

    } catch (error) {
        throw error;
    }
}

async function ObtenerQueryVentasCliente(filtros:any,esTotal:boolean,esReporte:boolean=false):Promise<string>{
    try {
        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.proceso != null && filtros.proceso != '') 
            filtro += " AND proceso = '" + filtros.proceso + "'";
        if (filtros.fechas?.length === 2) {
            const desde = moment.utc(filtros.fechas[0]).format('YYYY-MM-DD');
            const hasta = moment.utc(filtros.fechas[1]).add(1, 'day').format('YYYY-MM-DD');

            filtro += ` AND fecha >= '${desde}' AND fecha < '${hasta}'`;
        }
        // #endregion

        if(!esReporte){
            if (esTotal)
            {//Si esTotal agregamos para obtener un total de la consulta
                count = "SELECT COUNT(*) AS total FROM ( ";
                endCount = " ) as subquery";
            }
            else
            {//De lo contrario paginamos
                if (filtros.tamanioPagina != null)
                    paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
            }
        }
        
        //Arma la Query con el paginado y los filtros correspondientes
        //
        // La columna "saldo" debe mostrar el saldo ACUMULADO del cliente hasta ese
        // movimiento (como un extracto bancario), no el monto individual del
        // movimiento. Por eso cada subquery del UNION ahora expone ese monto como
        // "movimiento" (con signo: debe suma, haber resta), y una capa intermedia
        // calcula el acumulado real con una window function, siempre en orden
        // cronológico (fecha ASC, orden_tipo ASC) - independiente del orden en que
        // se muestre después (DESC para la grilla, ASC para el reporte impreso).
        // El filtro de fechas/proceso se aplica recién en la capa más externa, para
        // no alterar el acumulado histórico real aunque se esté filtrando la vista.
        query = count +
            `SELECT *
                FROM (
                    SELECT
                        m.*,
                        SUM(m.movimiento) OVER (
                            ORDER BY m.fecha ASC, m.orden_tipo ASC
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                        ) AS saldo
                    FROM (
                        -- ================= SALDO INICIAL =================
                        SELECT
                            0 AS id,
                            0 AS nroProceso,
                            'INICIAL' AS proceso,
                            '' AS fecha,

                            'SALDO ANTERIOR' AS comprobante,

                            'INICIAL' AS tipo,

                            CASE
                                WHEN c.inicialHIstorico > 0 THEN c.inicialHIstorico
                                ELSE 0
                            END AS debe,

                            CASE
                                WHEN c.inicialHIstorico < 0 THEN ABS(c.inicialHIstorico)
                                ELSE 0
                            END AS haber,

                            c.inicialHIstorico AS movimiento,

                            'INICIAL' AS estado,
                            '' AS referencia,
                            '' AS observaciones,
                            0 AS orden_tipo

                        FROM clientes c
                        WHERE c.id = ${filtros.cliente}
                        AND c.fechaBaja IS NULL

                        UNION ALL

                        -- ================= VENTAS (DEBE) =================
                        SELECT
                            v.id,
                            v.nroProceso,
                            tp.descripcion AS proceso,
                            CONCAT(DATE(v.fecha), ' ', TIME_FORMAT(v.hora, '%H:%i:%s')) AS fecha,
                            CASE
                                WHEN v.idTComprobante NOT IN (99, 100) THEN
                                    CONCAT(
                                        tc.descripcion, ' ',
                                        LPAD(COALESCE(vf.ptoVenta, 0), 4, '0'), '-',
                                        LPAD(COALESCE(vf.ticket, 0), 8, '0')
                                    )
                                ELSE
                                    CONCAT(
                                        tp.descripcion, ' ',
                                        LPAD(9999, 4, '0'), '-',
                                        LPAD(COALESCE(v.nroProceso, 0), 8, '0')
                                    )
                            END AS comprobante,
                            tc.descripcion AS tipo,
                            v.total AS debe,
                            0 AS haber,
                            v.total AS movimiento,
                            CASE
                                WHEN COALESCE(p.totalPagos, 0) >= v.total THEN 'PAGADA'
                                ELSE 'CON DEUDA'
                            END AS estado,
                            '--' AS referencia,
                            '' AS observaciones,
                            1 AS orden_tipo
                        FROM ventas v
                        LEFT JOIN ventas_factura vf ON vf.idVenta = v.id
                        LEFT JOIN tipos_comprobantes tc ON tc.id = v.idTComprobante
                        LEFT JOIN procesos_venta tp ON tp.id = v.idProceso
                        LEFT JOIN (
                            SELECT
                                vp.idVenta,
                                SUM(vp.monto) AS totalPagos
                            FROM ventas_pagos vp
                            JOIN metodos_pago mp ON mp.id = vp.idMetodo
                            -- Por tipo, no por id: (9, 12) son ids fijos de "Saldo a
                            -- favor"/"Cuenta Corriente" válidos solo para la empresa 1.
                            -- metodos_pago está scopeada por empresa, así que en el
                            -- resto de las empresas esos ids no existen o pertenecen a
                            -- otro método, y el pago CC se contaba como plata real acá,
                            -- mostrando 'PAGADA' en vez de 'CON DEUDA'. Bug real:
                            -- Venta #87 (empresa 6) y #120 (empresa 6), corregido 07/2026.
                            WHERE mp.tipo NOT IN ('SALDO_FAVOR', 'CUENTA_CORRIENTE')
                            GROUP BY vp.idVenta
                        ) p ON p.idVenta = v.id
                        WHERE v.fechaBaja IS NULL
                        AND v.idCliente = ${filtros.cliente}
                        AND v.idTComprobante NOT IN (3, 8, 13, 100)

                        UNION ALL

                        -- ================= NOTAS / A FAVOR =================
                        SELECT
                            v.id,
                            v.nroProceso,
                            tp.descripcion AS proceso,
                            CONCAT(DATE(v.fecha), ' ', TIME_FORMAT(v.hora, '%H:%i:%s')) AS fecha,
                            CASE
                                WHEN v.idTComprobante = 100 THEN
                                    CONCAT(
                                        tc.descripcion, ' ',
                                        LPAD(12, 4, '0'), '-',
                                        LPAD(COALESCE(v.nroProceso, 0), 8, '0')
                                    )
                                ELSE
                                    CONCAT(
                                        tc.descripcion, ' ',
                                        LPAD(COALESCE(vf.ptoVenta, 0), 4, '0'), '-',
                                        LPAD(COALESCE(vf.ticket, 0), 8, '0')
                                    )
                            END,
                            tc.descripcion,
                            0,
                            v.total,
                            -v.total AS movimiento,
                            'A FAVOR',
                            CONCAT(v.tipoRelacionado, ' # ', v.nroRelacionado),
                            '' AS observaciones,
                            3 AS orden_tipo
                        FROM ventas v
                        LEFT JOIN ventas_factura vf ON vf.idVenta = v.id
                        LEFT JOIN tipos_comprobantes tc ON tc.id = v.idTComprobante
                        LEFT JOIN procesos_venta tp ON tp.id = v.idProceso
                        WHERE v.fechaBaja IS NULL
                        AND v.idCliente = ${filtros.cliente}
                        AND v.idTComprobante IN (3, 8, 13, 100)

                        UNION ALL

                        -- ================= RECIBOS =================
                        SELECT
                            r.id,
                            r.id AS nroProceso,
                            'RECIBO' AS tipo,
                            CONCAT(DATE(r.fecha), ' ', TIME_FORMAT(r.hora, '%H:%i:%s')) AS fecha,

                            CONCAT(
                                'RECIBO # ',
                                LPAD(r.ptoVenta, 4, '0'), '-',
                                LPAD(r.id, 8, '0')
                            ) AS descripcion,

                            'RECIBO' AS proceso,
                            0,
                            r.total,
                            -r.total AS movimiento,
                            '',

                            CASE
                                WHEN COUNT(DISTINCT v.id) = 1 THEN
                                    MAX(CONCAT(pv.descripcion, ' # ', v.nroProceso))
                                WHEN COUNT(DISTINCT v.id) > 1 THEN
                                    CONCAT('VARIAS VENTAS (', COUNT(DISTINCT v.id), ')')
                                ELSE
                                    ''
                            END AS referencia,
                            r.observaciones AS observaciones,
                            2 AS orden_tipo

                        FROM recibos r
                        LEFT JOIN ventas_pagos vp ON vp.idRecibo = r.id
                        LEFT JOIN ventas v ON v.id = vp.idVenta
                        LEFT JOIN procesos_venta pv ON pv.id = v.idProceso

                        WHERE r.fechaBaja IS NULL
                        AND r.idCliente = ${filtros.cliente}

                        GROUP BY r.id, r.fecha, r.hora, r.total
                    ) m
                ) movimientos
                WHERE 1 = 1
                ${filtro}
                ORDER BY
                    fecha ${esReporte ? 'ASC' : 'DESC'},
                    orden_tipo ${esReporte ? 'ASC' : 'DESC'}
            ` +
            paginado +
            endCount;

        return query;

    } catch (error) {
        throw error;
    }
}

async function ObtenerVentasImpagas(connection, idCliente:number){
    try {
        // El JOIN excluye los pagos tipo CUENTA_CORRIENTE (no es plata real, es
        // justamente la deuda que esta función tiene que exponer para poder
        // cobrarla). Sin este filtro, una venta 100% financiada a CC calculaba
        // pagado=total -> deuda=0 y EntregaDinero la saltaba en silencio, aunque
        // impaga=1 - la deuda quedaba invisible para el circuito de cobro.
        // Bug real: Venta #109, cliente Club Náutico San Isidro, corregido 07/2026.
        const consulta = " SELECT v.id, v.total, IFNULL(SUM(vp.monto), 0) AS pagado " +
                         " FROM ventas v " +
                         " LEFT JOIN ventas_pagos vp " +
                         "   ON vp.idVenta = v.id " +
                         "   AND vp.idMetodo NOT IN (SELECT id FROM metodos_pago WHERE tipo = 'CUENTA_CORRIENTE') " +
                         " WHERE v.impaga = 1 " +
                         " AND v.idCliente = ? " +
                         " GROUP BY v.id " +
                         " ORDER BY v.fecha ASC ";

        const [rows] = await connection.query(consulta, [idCliente])
        return [rows][0];

    } catch (error) {
        throw error; 
    }
}

export const CuentasRepo = new CuentasRepository();