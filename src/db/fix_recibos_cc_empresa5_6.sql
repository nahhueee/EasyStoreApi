-- Corrección de datos: recibos y movimientos de fondo indebidos generados por
-- pago en Cuenta Corriente en empresas != 1 (bug de IDs de método de pago
-- hardcodeados, ver ventasRepository.ts - ProcesarCobroVenta / RegistrarMovimientosVenta,
-- corregido el 07/2026 reemplazando comparaciones por id (12/13, válidos solo para
-- la empresa 1) por comparación de metodos_pago.tipo vía GetMetodoPago).
--
-- Casos confirmados:
--   Venta #87 (empresa 6) - ventas_pagos.id=133 - recibo #21 - movimiento #82
--   Venta #98 (empresa 5) - ventas_pagos.id=138 - recibo #30 - movimiento #106
--
-- Ambos recibos tienen una sola fila en ventas_pagos (confirmado antes de correr
-- esto), por eso se dan de baja enteros. Si aparece un caso con más de una fila
-- por recibo, NO reusar este script tal cual: hay que restar solo el monto de CC
-- del total del recibo y desenganchar únicamente esa fila.
--
-- movimientos_fondos es append-only (sin fechaBaja/anulado en el schema), por eso
-- se revierte con un asiento contrario en vez de tocar el original.

START TRANSACTION;

-- ===================== Venta #87 - Empresa 6 =====================

UPDATE recibos
SET fechaBaja = NOW(),
    observaciones = 'Baja: recibo generado por error - pago en Cta. Cte. no debia generar recibo (bug IDs de metodo de pago hardcodeados por empresa, corregido 07/2026)'
WHERE id = 21;

UPDATE ventas_pagos
SET idRecibo = NULL
WHERE id = 133;

INSERT INTO movimientos_fondos
    (idCaja, idFondo, idEmpresa, tipo, origen, idReferencia, monto, descripcion, usuario, observaciones)
VALUES
    (1, 4, 6, 'EGRESO', 'AJUSTE', 87, 2976300.00,
     'Correccion: reversa de movimiento #82 - INGRESO indebido por bug CC empresa 6, Venta #87',
     'REEMPLAZAR_USUARIO',
     'Ver movimiento #82 (original erroneo) y recibo #21 (dado de baja)');

-- ===================== Venta #98 - Empresa 5 =====================

UPDATE recibos
SET fechaBaja = NOW(),
    observaciones = 'Baja: recibo generado por error - pago en Cta. Cte. no debia generar recibo (bug IDs de metodo de pago hardcodeados por empresa, corregido 07/2026)'
WHERE id = 30;

UPDATE ventas_pagos
SET idRecibo = NULL
WHERE id = 138;

INSERT INTO movimientos_fondos
    (idCaja, idFondo, idEmpresa, tipo, origen, idReferencia, monto, descripcion, usuario, observaciones)
VALUES
    (1, 4, 5, 'EGRESO', 'AJUSTE', 98, 350000.00,
     'Correccion: reversa de movimiento #106 - INGRESO indebido por bug CC empresa 5, Venta #98',
     'REEMPLAZAR_USUARIO',
     'Ver movimiento #106 (original erroneo) y recibo #30 (dado de baja)');

-- ===================== Verificación antes de COMMIT =====================
-- Correr estos SELECT y confirmar visualmente antes de cerrar la transacción:
--
-- SELECT * FROM recibos WHERE id IN (21, 30);
-- SELECT * FROM ventas_pagos WHERE id IN (133, 138);
-- SELECT * FROM movimientos_fondos WHERE idReferencia IN (87, 98) AND origen = 'AJUSTE';

COMMIT;
-- Si algo no cierra o los SELECT de verificación no coinciden con lo esperado,
-- ROLLBACK; en vez de COMMIT.
