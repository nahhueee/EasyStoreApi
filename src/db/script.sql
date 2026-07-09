DROP DATABASE IF EXISTS dbeasystore;
CREATE DATABASE dbeasystore;

USE dbeasystore;

DROP TABLE IF EXISTS parametros;
CREATE TABLE parametros (
    clave VARCHAR(30) PRIMARY KEY,
    valor VARCHAR(50) NOT NULL DEFAULT ''
);

DROP TABLE IF EXISTS parametros_facturacion;
CREATE TABLE parametros_facturacion (
    condicion VARCHAR(50),
    puntoVta INT,
    cuil BIGINT,
    razon VARCHAR(100),
    direccion VARCHAR(250)
);

DROP TABLE IF EXISTS backups;
CREATE TABLE backups (
    nombre VARCHAR(30) PRIMARY KEY,
    fecha DATE
);

DROP TABLE IF EXISTS usuarios;
CREATE TABLE usuarios (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(30),
    nombre VARCHAR(100),
    email VARCHAR(100),
    pass VARCHAR(255),
    idCargo INT
);

DROP TABLE IF EXISTS cargos;
CREATE TABLE cargos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100)
);

DROP TABLE IF EXISTS clientes;
CREATE TABLE clientes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100),
    razonSocial VARCHAR(100),
    telefono VARCHAR(20),
    celular VARCHAR(20),
    contacto VARCHAR(100),
    email VARCHAR(100),
    idCondIva INT,  
    idTipoDocumento INT,
    documento BIGINT,
    idCondicionPago INT,
    idCategoria INT,
    idListaPrecio INT,
    inicial DECIMAL(10,2) DEFAULT 0,
    fechaAlta TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fechaBaja DATE
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS direcciones_cliente;
CREATE TABLE direcciones_cliente (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idCliente INT,
    resumen VARCHAR(300),
    codPostal VARCHAR(10),
    calle VARCHAR(150),
    numero VARCHAR(10),
    localidad VARCHAR(100),
    provincia VARCHAR(100),
    observaciones VARCHAR(300)
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS proveedores;
CREATE TABLE proveedores (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    razonSocial VARCHAR(100),
    telefono VARCHAR(20),
    celular VARCHAR(20),
    contacto VARCHAR(100),
    email VARCHAR(100),
    idCondIva INT,
    idTipoDocumento INT,
    documento BIGINT,
    fechaAlta TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fechaBaja DATE
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS direcciones_proveedor;
CREATE TABLE direcciones_proveedor (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idProveedor INT,
    resumen VARCHAR(300),
    codPostal VARCHAR(10),
    calle VARCHAR(150),
    numero VARCHAR(10),
    localidad VARCHAR(100),
    provincia VARCHAR(100),
    observaciones VARCHAR(300)
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS tipos_pago;
CREATE TABLE tipos_pago (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(15)
);

DROP TABLE IF EXISTS tipos_documento;
CREATE TABLE tipos_documento(
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);


DROP TABLE IF EXISTS ventas;
CREATE TABLE ventas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idProceso INT NOT NULL,
    nroProceso INT NOT NULL,
    idPunto INT NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hora VARCHAR(10),
    idCliente INT NOT NULL,
    idLista INT,
    idEmpresa INT,
    idTComprobante INT,
    idTDescuento INT,
    descuento DECIMAL(5,2),
    codPromocion INT,
    redondeo DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2),
    nroRelacionado INT,
    tipoRelacionado VARCHAR(20),
    estado VARCHAR (20),
    impaga INT DEFAULT 0,
    fechaBaja DATETIME
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_productos;
CREATE TABLE ventas_productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idVenta INT NOT NULL,
    idProducto INT NOT NULL,
    idLineaTalle INT NULL,
    cantidad INT NOT NULL,
    precio DECIMAL(10,2) NOT NULL,
    precioLista DECIMAL(10,2) NULL,
    total DECIMAL(10,2) NOT NULL,
    t1 INT,
    t2 INT,
    t3 INT,
    t4 INT,
    t5 INT,
    t6 INT,
    t7 INT,
    t8 INT,
    t9 INT,
    t10 INT,
    talles VARCHAR(100)
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_servicios;
CREATE TABLE ventas_servicios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idVenta INT NOT NULL,
    idServicio INT NOT NULL,
    cantidad INT NOT NULL,
    precio DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_pagos;
CREATE TABLE ventas_pagos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idVenta INT NOT NULL,
    idMetodo INT NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    idEntrega INT
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_factura;
CREATE TABLE ventas_factura (
    idVenta INT PRIMARY KEY,
    cae BIGINT,
    caeVto DATE,
    ticket INT,
    tipoFactura INT,
    neto DECIMAL(10,2),
    iva DECIMAL(10,2),
    dni BIGINT,
    tipoDni INT,
    ptoVenta INT,
    condReceptor INT DEFAULT 0
)
ENGINE=InnoDB;


DROP TABLE IF EXISTS ventas_entrega;
CREATE TABLE ventas_entrega (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idCliente INT NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_entrega_detalle;
CREATE TABLE ventas_entrega_detalle (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idEntrega INT NOT NULL,
    idVenta INT NOT NULL,
    idMetodoAplicado INT NOT NULL,
    montoAplicado DECIMAL(10,2) NOT NULL
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS etiquetas;
CREATE TABLE etiquetas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    tamanio VARCHAR(10),
    titulo VARCHAR(50),
    mOferta INT,
    mCodigo INT,
    mPrecio INT,
    mNombre INT,
    mVencimiento INT,
    bordeColor VARCHAR(10),
    bordeAncho VARCHAR(10),
    tituloColor VARCHAR(10),
    tituloAlineacion VARCHAR(10),
    ofertaFondo VARCHAR(10),
    ofertaAlineacion VARCHAR(10),
    nombreAlineacion VARCHAR(10),
    vencimientoAlineacion VARCHAR(10),
    precioAlineacion VARCHAR(10),
    precioColor VARCHAR(10)
);

DROP TABLE IF EXISTS productos;
CREATE TABLE productos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(4),
    nombre VARCHAR(100),
    idEmpresa INT,
    idProceso INT,
    idCliente INT,
    idTipo INT,
    idSubTipo INT,
    idGenero INT,
    idMaterial INT,
    idColor INT,
    idTemporada INT,
    moldeleria INT DEFAULT 0,
    topeDescuento DECIMAL(10,2) DEFAULT 0,
    imagen VARCHAR(300),
    fechaBaja DATE
);

DROP TABLE IF EXISTS productos_presupuesto;
CREATE TABLE productos_presupuesto (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(30) DEFAULT '',
    nombre VARCHAR(100),
    sugerido DECIMAL(10,2) DEFAULT 0
);

DROP TABLE IF EXISTS procesos;
CREATE TABLE procesos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    abreviatura VARCHAR(10)
);

DROP TABLE IF EXISTS procesos_venta;
CREATE TABLE procesos_venta (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    tipo VARCHAR(20)
);

DROP TABLE IF EXISTS puntos_venta;
CREATE TABLE puntos_venta (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS tipos_descuento;
CREATE TABLE tipos_descuento (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS tipos_producto;
CREATE TABLE tipos_producto (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    abreviatura VARCHAR(10)
);

DROP TABLE IF EXISTS subtipos_producto;
CREATE TABLE subtipos_producto (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    abreviatura VARCHAR(10)
);

DROP TABLE IF EXISTS generos;
CREATE TABLE generos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    abreviatura VARCHAR(10)
);

DROP TABLE IF EXISTS colores;
CREATE TABLE colores (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    hexa VARCHAR(10)
);

DROP TABLE IF EXISTS talles;
CREATE TABLE talles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(5),
    idLineaTalle INT NOT NULL
)

DROP TABLE IF EXISTS materiales;
CREATE TABLE materiales (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS temporadas;
CREATE TABLE temporadas (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    abreviatura VARCHAR(10)
);

DROP TABLE IF EXISTS materiales_colores;
CREATE TABLE materiales_colores (
    idColor INT,
    idMaterial INT
);

DROP TABLE IF EXISTS lineas_talle;
CREATE TABLE lineas_talle (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS metodos_pago;
CREATE TABLE metodos_pago (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    idFondo INT,
    idEmpresa INT
);

-- movimientos_fondos (tabla no incluida en este script — ver migraciones en db/tasks/)
-- Columna idEmpresa (INT NULL) agregada via 20260610000000_add_idEmpresa_movimientos_fondos.js
-- FK: fk_mf_empresa -> empresas(id)

DROP TABLE IF EXISTS colores_producto;
CREATE TABLE colores_producto (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idProducto INT,
    idColor INT
);

DROP TABLE IF EXISTS talles_producto;
CREATE TABLE talles_producto (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idProducto INT,
    idLineaTalle INT,
    talle VARCHAR(5),
    ubicacion INT,
    cantidad INT DEFAULT 0,
    precio DECIMAL(10,2),
    costo DECIMAL(10,2),
    codigo_barra VARCHAR(13)
);

DROP TABLE IF EXISTS condiciones_iva;
CREATE TABLE condiciones_iva (
    id INT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS tipos_comprobantes;
CREATE TABLE tipos_comprobantes (
    id INT  UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cod_arca VARCHAR(5),
    descripcion VARCHAR(20)
);

DROP TABLE IF EXISTS reglas_comprobante;
CREATE TABLE reglas_comprobante (
    id INT  UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    empresa_tipo VARCHAR(4), -- 'RI' | 'MONO'
    cliente_tipo INT, -- NULL = cualquiera
    idTipoComprobante INT
);

-- RI → RI = Factura A
INSERT INTO reglas_comprobante VALUES
(1, 'RI', 1, 1);

-- RI → MONO = Factura A
INSERT INTO reglas_comprobante VALUES
(2, 'RI', 6, 1);

-- RI → MONO SOCIAL = Factura A
INSERT INTO reglas_comprobante VALUES
(3, 'RI', 13, 1);

-- RI → cualquiera = Factura B
INSERT INTO reglas_comprobante VALUES
(4, 'RI', NULL, 6);

-- Monotributo → cualquiera = Factura C
INSERT INTO reglas_comprobante VALUES
(5, 'MONO', NULL, 11);

-- Cotización (todas las empresas, todos los clientes)
INSERT INTO reglas_comprobante VALUES
(6, 'RI', NULL, 99),
(7, 'MONO', NULL, 99);

DROP TABLE IF EXISTS condiciones_pago;
CREATE TABLE condiciones_pago (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS servicios;
CREATE TABLE servicios (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(30),
    descripcion VARCHAR(50),
    sugerido DECIMAL(10,2) DEFAULT 0,
    topeDescuento DECIMAL(5,2) DEFAULT 0
);

DROP TABLE IF EXISTS empresas;
CREATE TABLE empresas (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    razonSocial VARCHAR(100),
    condicion VARCHAR(50),
    abrevCondicion VARCHAR(4), 
    puntoVta INT,
    cuil BIGINT,
    IIBB VARCHAR(20),
    direccion VARCHAR(250)
);

DROP TABLE IF EXISTS ordenes_ingreso;
CREATE TABLE ordenes_ingreso(
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idProveedor INT,
    corte INT,
    fecha DATE,
    observaciones VARCHAR(300),
    usuario VARCHAR(30),
    estado VARCHAR(15),
    alta DATETIME
);

DROP TABLE IF EXISTS ordenes_productos;
CREATE TABLE ordenes_productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idOrden INT NOT NULL,
    idProducto INT NOT NULL,
    idLineaTalle INT NULL,
    cantidad INT NOT NULL,
    stockAplicado INT DEFAULT 0,
    t1 INT,
    t2 INT,
    t3 INT,
    t4 INT,
    t5 INT,
    t6 INT,
    t7 INT,
    t8 INT,
    t9 INT,
    t10 INT,
    talles VARCHAR(100)
)
ENGINE=InnoDB;

CREATE TABLE ordenes_productos_bajas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idOrden INT NOT NULL,
    idProducto INT NOT NULL,
    idLineaTalle INT NULL,
    t1 INT,
    t2 INT,
    t3 INT,
    t4 INT,
    t5 INT,
    t6 INT,
    t7 INT,
    t8 INT,
    t9 INT,
    t10 INT,
    talles VARCHAR(100),
    obs VARCHAR(250),
    usuarioBaja VARCHAR(30),
    fechaBaja DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

DROP TABLE IF EXISTS recepciones;
CREATE TABLE recepciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idOrden INT,
    usuario VARCHAR(30),
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

DROP TABLE IF EXISTS recepciones_talles_producto;
CREATE TABLE recepciones_talles_producto (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idRecepcion INT NOT NULL,
    idProducto INT NOT NULL,
    idLineaTalle INT NOT NULL,
    talle VARCHAR(10) NOT NULL,
    cantidad INT NOT NULL,
    original INT
)ENGINE=InnoDB;



INSERT INTO parametros(clave, valor) 
VALUES 
('version','1.1.2'),
('dni',''), 
('expresion',''), 
('backups', 'false'), 
('dias', 'Lunes, Martes, Viernes'), 
('hora', '20:30'), 
('avisoNvaVersion', 'true'),
('actualizado', 'false');

INSERT INTO tipos_pago(id, nombre) VALUES (NULL,'EFECTIVO'), (NULL,'TARJETA'), (NULL,'TRANSFERENCIA'), (NULL,'COMBINADO');
INSERT INTO cargos(id, nombre) VALUES (NULL,'ADMINISTRADOR'), (NULL,'EMPLEADO');
INSERT INTO `clientes` (`id`, `nombre`, `razonSocial`, `telefono`, `celular`, `contacto`, `email`, `idCondIva`, `idTipoDocumento`, `documento`, `idCondicionPago`, `idCategoria`, `fechaAlta`, `fechaBaja`) VALUES (NULL, 'CONSUMIDOR FINAL', 'CONSUMIDOR FINAL', '0', '0', 'CONSUMIDOR FINAL', NULL, '0', '0', '0', '0', '0', CURRENT_TIMESTAMP, NULL);
INSERT INTO usuarios(id, usuario, nombre, email, pass, idCargo) VALUES (NULL, 'ADMIN', 'ADMINISTRADOR', NULL, '$2b$10$ZJPupB8k/JvdKAzBeTw2BuBGLSeT4UG2TGI9QwEfjOE/78Eo.c0HC', 1); -- pass: 1235 (hash bcrypt)
INSERT INTO lineas_talle(descripcion)
VALUES
('XXP-PE-ME-GR-XXG'),
('4-6-8-10-12-14-16-18'),
('28-30-32-34-36-38-40-42-44-46'),
('XS-S-M-L-XL-XXL-3XL-4XL-5XL-6XL');

INSERT INTO condiciones_iva (id, descripcion) VALUES
(5, 'Consumidor Final'),
(1, 'IVA Responsable Inscripto'),
(6, 'Responsable Monotributo'),
(13, 'Monotributista Social'),
(15, 'IVA No Alcanzado');

INSERT INTO tipos_comprobantes (id, cod_arca, descripcion) VALUES
(1, 'A', 'FACTURA A'),
(6, 'B', 'FACTURA B'),
(11, 'C', 'FACTURA C'),
(99, 'X', 'COTIZACIÓN');

INSERT INTO condiciones_pago (id, descripcion) VALUES
(1, 'CONTADO'),
(2, 'CUENTA CORRIENTE'),
(3, 'PAGO DIGITAL'),
(4, 'OTRO');

INSERT INTO tipos_documento(id, descripcion) VALUES
(80, 'CUIT'),
(86, 'CUIL'),
(96, 'DNI');

INSERT INTO metodos_pago(id, descripcion) VALUES
(1, 'CONTADO'),
(2, 'TARJETA CREDITO'),
(3, 'TARJETA DEBITO'),
(4, 'MERCADO PAGO');

INSERT INTO procesos_venta(id, descripcion, tipo) VALUES
(1, 'FACTURA', 'factura'),
(2, 'COTIZACION', 'factura'),
(3, 'NOTA DE CREDITO', 'factura'),
(4, 'NOTA DE DEBITO', 'factura'),
(5, 'PRESUPUESTO', 'pre'),
(6, 'PEDIDO', 'pre'),
(7, 'NOTA DE EMPAQUE', 'pre');


INSERT INTO tipos_descuento(id, descripcion) VALUES
(1, 'PORCENTAJE'),
(2, 'VOUCHER'),
(3, 'PROMOCION');

INSERT INTO puntos_venta(id, descripcion) VALUES
(1, 'ECOMMERCE'),
(2, 'DIFUSION'),
(3, 'SHOWROOM'),
(4, 'MAYORISTA'),
(5, 'CON NOTA DE EMPAQUE');

INSERT INTO empresas(id, razonSocial, condicion, abrevCondicion, puntoVta, cuil, direccion) VALUES
(1, 'SUCEDE SRL', 'Responsable Inscripto', 'RI', 1, 30714907626, 'Mi direccion 285'),
(2, 'GABEL MARIELA', 'Monotributista', 'MONO',  1, 27411750723, 'Mi direccion 285'),
(3, 'OMAR CHAZA', 'Monotributista', 'MONO', 1, 27411750723, 'Mi direccion 285');

INSERT INTO `generos` (`id`, `descripcion`, `abreviatura`) VALUES
(1, 'HOMBRE', 'H'),
(2, 'DAMA', 'D'),
(4, 'NIÑO', 'NO'),
(5, 'NIÑA', 'NA');

INSERT INTO `materiales` (`id`, `descripcion`) VALUES
(1, 'SET LISO'),
(2, 'RUSTICO LISO');


INSERT INTO `materiales_colores` (`idColor`, `idMaterial`) VALUES
(1, 1),
(2, 1),
(3, 1),
(4, 1),
(5, 1),
(6, 1),
(7, 1),
(8, 1),
(9, 1),
(10, 1),
(11, 1),
(12, 1),
(13, 1),
(0, 0),
(4, 2),
(13, 2),
(14, 2),
(1, 2),
(7, 2),
(5, 2),
(12, 2);

INSERT INTO `subtipos_producto` (`id`, `descripcion`, `abreviatura`) VALUES
(1, 'MGA CORTA', 'MGA C'),
(2, 'MEDIO CIERRE', 'M/C');

INSERT INTO `temporadas` (`id`, `descripcion`, `abreviatura`) VALUES
(1, 'VERANO 2025', 'VER25'),
(2, 'INVIERNO 2025', 'INV25');

INSERT INTO `tipos_producto` (`id`, `descripcion`, `abreviatura`) VALUES
(1, 'CHOMBA', 'CHB'),
(2, 'BUZO', 'BZO'),
(3, 'PANTALON', 'PLON');

INSERT INTO `procesos` (`id`, `descripcion`, `abreviatura`) VALUES
(1, 'STOCK', 'STK'),
(2, 'PROJECTADO', 'PROJ'),
(3, 'PEDIDOS APROBADOS', 'APROB');


CREATE INDEX idx_ventas_impaga_cliente ON ventas (impaga, idCliente);
CREATE INDEX idx_ventas_pagos_venta ON ventas_pagos (idVenta);
CREATE INDEX idx_ventas_cliente_fecha ON ventas(idCliente, fecha);
CREATE INDEX idx_ventas_proceso ON ventas(idProceso);
CREATE INDEX idx_ventas_pagos_metodo ON ventas_pagos(idMetodo);

-- ============================================================
-- MODULO COMPRAS (Fase 1) - jun-2026
-- Fuente real: knex migration db/tasks/20260617141038_create_compras.js
-- Estas definiciones son documentación de referencia, no se ejecutan desde este script.
-- ============================================================

DROP TABLE IF EXISTS alicuotas_iva;
CREATE TABLE alicuotas_iva (
    id INT UNSIGNED PRIMARY KEY,
    descripcion VARCHAR(20) NOT NULL,
    tasa DECIMAL(5,4) NOT NULL,
    activa TINYINT DEFAULT 1
);

INSERT INTO alicuotas_iva (id, descripcion, tasa) VALUES
(1, '21%', 0.2100),
(2, '10,5%', 0.1050),
(3, '27%', 0.2700),
(4, '5%', 0.0500),
(5, '2,5%', 0.0250),
(6, 'Exento', 0.0000);

-- idCaja: punto desde el que se paga (analogo a ventas.idCaja).
-- idMetodoPago: FK a metodos_pago (filtrado a "todos menos DEBITO/CREDITO/SALDO_FAVOR/CUENTA_CORRIENTE" en F1), NULL pensado para Cuenta Corriente proveedor en F2.
-- idTipoComprobante: reutiliza tipos_comprobantes (id=99 = COTIZACION; impacta fondos/CC igual que el resto).
-- totalNeto/totalIva/totalIibb se recalculan en backend como SUM de las tablas hijas; tasaMunicipal/percepcionIva/retencionGanancia son ingreso manual.
-- total = totalNeto + totalIva + totalIibb + tasaMunicipal + percepcionIva + retencionGanancia.
DROP TABLE IF EXISTS compras;
CREATE TABLE compras (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idEmpresa INT UNSIGNED NOT NULL,
    idProveedor INT UNSIGNED NOT NULL,
    idCaja INT UNSIGNED NOT NULL,
    idMetodoPago INT UNSIGNED NULL,
    fecha DATE NOT NULL,
    idTipoComprobante INT UNSIGNED NOT NULL,
    nroComprobante VARCHAR(20),
    totalNeto DECIMAL(12,2) NOT NULL DEFAULT 0,
    totalIva DECIMAL(12,2) NOT NULL DEFAULT 0,
    totalIibb DECIMAL(12,2) NOT NULL DEFAULT 0,
    tasaMunicipal DECIMAL(12,2) NOT NULL DEFAULT 0,
    percepcionIva DECIMAL(12,2) NOT NULL DEFAULT 0,
    retencionGanancia DECIMAL(12,2) NOT NULL DEFAULT 0,
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    estado VARCHAR(15) NOT NULL DEFAULT 'Aprobada',
    usuario VARCHAR(15),
    alta TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    baja DATETIME NULL
);

-- Lineas de concepto libre (sin catalogo/stock): cantidad + concepto + importe. El IVA NO vive en la linea (ver compras_iva).
DROP TABLE IF EXISTS detalle_compras;
CREATE TABLE detalle_compras (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idCompra BIGINT UNSIGNED NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    importe DECIMAL(12,2) NOT NULL
);

-- IVA manual por alicuota (hasta 3 filas tipicas: 21/10,5/27). idAlicuota referencia alicuotas_iva (catalogo, no FK explicita).
DROP TABLE IF EXISTS compras_iva;
CREATE TABLE compras_iva (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idCompra BIGINT UNSIGNED NOT NULL,
    idAlicuota INT UNSIGNED NOT NULL,
    importe DECIMAL(12,2) NOT NULL
);

-- Percepcion de Ingresos Brutos por provincia. No existe catalogo de provincias en la DB: el FE renderiza la lista fija de 24 y se guarda como texto libre.
DROP TABLE IF EXISTS compras_percepciones_iibb;
CREATE TABLE compras_percepciones_iibb (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idCompra BIGINT UNSIGNED NOT NULL,
    provincia VARCHAR(100) NOT NULL,
    importe DECIMAL(12,2) NOT NULL
);


