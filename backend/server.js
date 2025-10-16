console.log("--- ¡HOLA! ESTOY EJECUTANDO EL SERVIDOR CORRECTO ---");
const logger = require('./logger');
const express = require('express');
const cors = require('cors'); // Middleware para habilitar Cross-Origin Resource Sharing
const helmet = require('helmet'); // Middleware para mejorar la seguridad de la aplicación Express
const http = require('http'); // Módulo para crear un servidor HTTP
const { Server } = require('socket.io'); // Módulo para la comunicación en tiempo real (websockets)
const { connect, sql, close, getPool, getImportantInfo, getImportantInfoById, addImportantInfo, updateImportantInfo, deleteImportantInfo } = require('./db'); // Funciones de conexión a la base de datos
const jwt = require('jsonwebtoken'); // Para crear y verificar JSON Web Tokens
const bcrypt = require('bcrypt'); // Para encriptar y comparar contraseñas
const multer = require('multer'); // Middleware para manejar la subida de archivos (multipart/form-data)
const path = require('path'); // Módulo para trabajar con rutas de archivos y directorios 
const fs = require('fs'); // Módulo para interactuar con el sistema de archivos
const { v4: uuidv4 } = require('uuid'); // Para generar IDs únicos
const { validate, validateJson, registerSchema, loginSchema, personalSchema, personalUpdateSchema } = require('./validation'); // Esquemas y middleware de validación
const rateLimit = require('express-rate-limit'); // Para limitar la tasa de peticiones
const cookieParser = require('cookie-parser');

// --- CONFIGURACIÓN INICIAL DE EXPRESS ---
const app = express();

// --- CONFIGURACIÓN DE CORS ---
const corsOptions = {
    origin: process.env.CORS_ORIGIN || 'http://localhost:8080',
    credentials: true,
};

app.use(cors(corsOptions));

// Middleware para parsear JSON en el cuerpo de las peticiones
app.use(express.json());

// Middleware para parsear cookies
app.use(cookieParser());

// Aplica cabeceras de seguridad HTTP básicas
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "script-src-elem": ["'self'", "https://cdn.socket.io", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      "connect-src": ["'self'", "ws://*:*"], // Permite conexiones al propio origen y a cualquier WebSocket
      "worker-src": ["'self'", "blob:"],
      "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      "style-src-elem": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "upgrade-insecure-requests": null, // Desactivar la actualización a HTTPS
    },
  },
}));

// --- CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS Y DIRECTORIOS ---

// Asegura que el directorio 'uploads' para subir archivos exista
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Sirve los archivos subidos de forma estática en la ruta /uploads
app.use('/uploads', express.static(uploadsDir));

// Sirve los archivos del frontend (ubicados en el directorio padre)
app.use(express.static(path.join(__dirname, '../')));

// --- CONFIGURACIÓN DEL SERVIDOR Y SOCKET.IO ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: corsOptions
});

// La conexión a la base de datos se iniciará junto con el servidor más adelante

// --- CONFIGURACIÓN DE SEGURIDAD (JWT) ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    logger.error('ERROR FATAL: La variable de entorno JWT_SECRET no está definida.');
    process.exit(1); // Termina la aplicación si el secreto de JWT no está configurado
}

// Variable global para el tema actual (podría moverse a la base de datos en el futuro)
let currentTheme = 'default';

// --- CONFIGURACIÓN DE SUBIDA DE ARCHIVOS (MULTER) ---

// File filter for image uploads
const imageFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos de imagen (jpeg, png, gif, webp)!'), false);
    }
};

// File filter for CSV uploads
const csvFilter = (req, file, cb) => {
    const allowedMimeTypes = ['text/csv', 'application/vnd.ms-excel', 'application/csv'];
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}. Solo se permiten archivos CSV.`), false);
    }
};

// Max file sizes
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CSV_SIZE = 1 * 1024 * 1024;   // 1MB

// Configuración de almacenamiento para fotos individuales
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Crea un nombre de archivo único y aleatorio para evitar adivinanzas y colisiones
        const randomName = uuidv4();
        const extension = path.extname(file.originalname);
        cb(null, randomName + extension);
    }
});
const upload = multer({
    storage: storage,
    fileFilter: imageFilter,
    limits: { fileSize: MAX_IMAGE_SIZE }
});

// Configuración de almacenamiento para carga masiva de CSV
const bulkStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const bulkDir = path.join(uploadsDir, 'bulk');
        if (!fs.existsSync(bulkDir)) {
            fs.mkdirSync(bulkDir, { recursive: true });
        }
        cb(null, bulkDir);
    },
    filename: (req, file, cb) => {
        // Usa un nombre de archivo único y aleatorio para CSV también
        const randomName = uuidv4();
        const extension = path.extname(file.originalname);
        cb(null, randomName + extension);
    }
});
const uploadBulk = multer({
    storage: bulkStorage,
    fileFilter: csvFilter,
    limits: { fileSize: MAX_CSV_SIZE }
});


// --- MIDDLEWARES DE AUTENTICACIÓN Y AUTORIZACIÓN ---

/**
 * Middleware para autenticar el token JWT.
 * Verifica que la petición tenga una cabecera de autorización válida.
 */
const authenticateToken = (req, res, next) => {
        const token = req.cookies.authToken;

    if (token == null) {
        return res.status(401).json({ message: 'Token no proporcionado.' }); // No autorizado
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token inválido o expirado.' }); // Prohibido
        }
        req.user = user; // Añade la información del usuario a la petición
        next(); // Pasa al siguiente middleware o ruta
    });
};

/**
 * Middleware para autorizar únicamente a usuarios con rol de 'admin'.
 * @deprecated Usar authorize(['admin']) en su lugar para mayor claridad.
 */
const authorizeAdmin = (req, res, next) => {
    return authorize(['admin'])(req, res, next);
};

/**
 * Middleware genérico para autorizar usuarios basados en roles.
 * @param {Array<string>} allowedRoles - Un array de roles permitidos (ej. ['admin', 'user']).
 */
const authorize = (allowedRoles) => (req, res, next) => {
    if (req.user && allowedRoles.includes(req.user.role)) {
        next(); // El rol del usuario está permitido, continuar.
    } else {
        res.status(403).json({ message: 'Acceso denegado. No tienes los permisos necesarios.' });
    }
};

// --- MIDDLEWARE DE LÍMITE DE TASA ---
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login requests per windowMs
    message: 'Demasiados intentos de login desde esta IP, por favor intente de nuevo después de 15 minutos.',
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Obtiene todos los datos del personal con sus puestos, departamentos y extensiones.
 * @returns {Promise<Array>} Una promesa que resuelve a un array con los datos del personal.
 */
async function getFullStaffData() {
    const staffResult = await getPool().request().query(/*sql*/`
        SELECT 
            per.id, per.nombre, per.correo, per.descripcion, per.fotoUrl, per.en_carrusel AS showInCarousel, per.fecha_nacimiento,
            pu.id as puesto_id,
            pu.name as puesto,
            dep.name as departamento,
            COALESCE(
                (SELECT STRING_AGG(e.number, ', ') FROM PersonalExtension p_ext JOIN Extensions e ON p_ext.extension_id = e.id WHERE p_ext.personal_id = per.id),
                (SELECT STRING_AGG(e.number, ', ') FROM PuestoExtension pu_ext JOIN Extensions e ON pu_ext.extension_id = e.id WHERE pu_ext.puesto_id = per.puesto_id)
            ) as extension
        FROM Personal per
        LEFT JOIN Puestos pu ON per.puesto_id = pu.id
        LEFT JOIN Departments dep ON pu.department_id = dep.id
    `);
    return staffResult.recordset;
}

// =============================================================================
// --- DEFINICIÓN DE RUTAS DE LA API ---
// =============================================================================


// --- RUTAS DE AUTENTICACIÓN ---
/**
 * POST /api/register
 * Registra un nuevo usuario.
 * IMPORTANTE: La creación de administradores debe ser un proceso manual y seguro,
 * por ejemplo, a través de un script de inicialización o modificando la base de datos directamente.
 * Esta ruta solo permite el registro de usuarios con el rol 'user' y requiere que un admin esté autenticado.
 */
        
        app.post('/api/register', authenticateToken, authorize(['admin']), validateJson(registerSchema), async (req, res) => {
            const { username, password, role } = req.body;

            // Forzar el rol a 'user' si no es un admin quien lo crea o si no se especifica.
            // En este caso, como solo un admin puede llegar aquí, le permitimos crear otros roles si es necesario.
            const userRole = (['admin', 'user', 'staff_manager'].includes(role)) ? role : 'user';

            try {
                const saltRounds = 10;
                const hashedPassword = await bcrypt.hash(password, saltRounds);

                const result = await getPool().request()
                    .input('username', sql.NVarChar, username)
                    .input('password', sql.NVarChar, hashedPassword)
                    .input('role', sql.NVarChar, userRole)
                    .query('INSERT INTO Users (username, password, role) VALUES (@username, @password, @role)');

                res.status(201).json({ message: `Usuario '${username}' creado exitosamente con el rol '${userRole}'.` });

            } catch (err) {
                // Error 2627 es violación de clave única (UNIQUE constraint) en SQL Server
                if (err.number === 2627) {
                    return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
                }
                logger.error('Error al registrar usuario:', err);
                res.status(500).json({ message: 'Error interno del servidor al registrar el usuario.' });
            }
        });


/**
 * POST /api/login
 * Autentica a un usuario y devuelve un token JWT si las credenciales son correctas.
 */
        app.post('/api/login', loginLimiter, validateJson(loginSchema), async (req, res) => {
            const { username, password } = req.body;
            logger.info(`Intento de login para el usuario: ${username}`);

            try {
                const result = await getPool().request().input('username', sql.NVarChar, username).query('SELECT * FROM Users WHERE username = @username');
                const user = result.recordset[0];

                if (!user) {
                    logger.info(`Usuario no encontrado: ${username}`);
                    return res.status(401).json({ message: 'Credenciales inválidas.' });
                }

                if (await bcrypt.compare(password, user.password)) {
                    logger.info(`Login exitoso para el usuario: ${username}`);
                    const tokenPayload = { id: user.id, username: user.username, role: user.role };
                    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '15m' });
                    
                    res.cookie('authToken', token, {
                        httpOnly: true,
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: 'strict',
                        maxAge: 15 * 60 * 1000
                    });

                    // Pre-cargar datos solo para roles autorizados para optimizar la carga inicial.
                    let initialData = {};
                    if (['admin', 'staff_manager'].includes(user.role)) {
                        initialData.staff = await getFullStaffData();
                    }

                    res.json({
                        message: 'Login exitoso.',
                        user: tokenPayload,
                        ...initialData // Añade los datos del personal si corresponde
                    });

                } else {
                    logger.info(`Contraseña incorrecta para el usuario: ${username}`);
                    res.status(401).json({ message: 'Credenciales inválidas.' });
                }
            } catch (err) {
                logger.error('Error durante el login:', err);
                res.status(500).json({ message: 'Error interno del servidor durante el login.' });
            }
        });

        app.post('/api/logout', (req, res) => {
            res.cookie('authToken', '', {
                httpOnly: true,
                expires: new Date(0)
            });
            res.status(200).json({ message: 'Logout exitoso.' });
        });


        /**
         * POST /api/refresh-token
         * Emite un nuevo token JWT para un usuario ya autenticado, extendiendo su sesión.
         */
        app.post('/api/refresh-token', authenticateToken, (req, res) => {
            const user = req.user;
            const tokenPayload = { id: user.id, username: user.username, role: user.role };
            const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '15m' });

            res.cookie('authToken', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 15 * 60 * 1000 // 15 minutos
            });

            res.json({ message: 'Token refrescado exitosamente.' });
        });

/**
 * GET /api/login-check
 * Verifica si el usuario tiene una sesión activa y devuelve sus datos y los datos iniciales.
 */
app.get('/api/login-check', authenticateToken, async (req, res) => {
    const user = req.user;
    const tokenPayload = { id: user.id, username: user.username, role: user.role };

    // Adjuntar los datos iniciales del dashboard, asegurando que se incluyan los datos relacionales.
    const staffData = await getFullStaffData();

    res.json({
        message: 'Sesión activa.',
        user: tokenPayload,
        staff: staffData
    });
});

        // --- RUTAS PÚBLICAS (no requieren autenticación) ---

        /**
         * GET /api/public/personal
         * Obtiene la lista completa del personal.
         */
        app.get('/api/public/personal', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 12; // Default limit
                const offset = (page - 1) * limit;

                // Fetch paginated data
                const result = await getPool().request().query(`
                    SELECT 
                        per.id, per.nombre, per.correo, per.descripcion, per.fotoUrl, per.en_carrusel, per.fecha_nacimiento,
                        pu.name as puesto,
                        dep.name as departamento,
                        COALESCE(
                            (SELECT STRING_AGG(e.number, ', ') FROM PersonalExtension p_ext JOIN Extensions e ON p_ext.extension_id = e.id WHERE p_ext.personal_id = per.id),
                            (SELECT STRING_AGG(e.number, ', ') FROM PuestoExtension pu_ext JOIN Extensions e ON pu_ext.extension_id = e.id WHERE pu_ext.puesto_id = pu.id)
                        ) as extension
                    FROM Personal per 
                    LEFT JOIN Puestos pu ON per.puesto_id = pu.id
                    LEFT JOIN Departments dep ON pu.department_id = dep.id
                    ORDER BY per.nombre
                    OFFSET ${offset} ROWS
                    FETCH NEXT ${limit} ROWS ONLY;`
                );
                res.json(result.recordset);
            } catch (err) {
                logger.error('Error obteniendo datos del personal público (paginado):', err.message, err.stack);
                res.status(500).json({ message: 'Error interno del servidor al obtener datos del personal.' });
            }
        });

        /**
         * GET /api/public/personal/count
         * Obtiene el conteo total de miembros del personal.
         */
        app.get('/api/public/personal/count', async (req, res) => {
            try {
                const result = await getPool().request().query`SELECT COUNT(ID) AS total FROM Personal`;
                res.json({ total: result.recordset[0].total });
            } catch (err) {
                logger.error('Error obteniendo el conteo total del personal:', err.message, err.stack);
                res.status(500).json({ message: 'Error interno del servidor al obtener el conteo del personal.' });
            }
        });

        /**
         * GET /api/public/personal/search
         * Busca personal por término de búsqueda en varios campos.
         */
        app.get('/api/public/personal/search', async (req, res) => {
            // La función searchPublicStaff ya está en db.js y maneja la lógica
            // de búsqueda insensible a tildes y mayúsculas.
            const { searchPublicStaff } = require('./db');

            try {
                const searchTerm = req.query.q;
                if (!searchTerm) {
                    return res.status(400).json({ message: 'El término de búsqueda (q) es requerido.' });
                }
                
                // El frontend ya envía el término normalizado (sin tildes, en minúsculas)
                const results = await searchPublicStaff(searchTerm);
                res.json(results);
            } catch (err) {
                logger.error('Error buscando personal:', err);
                res.status(500).json({ message: 'Error interno del servidor al buscar personal.' });
            }
        });

        /**
         * GET /api/public/personal/carousel
         * Obtiene solo el personal marcado para aparecer en el carrusel.
         */
        app.get('/api/public/personal/carousel', async (req, res) => {
            try {
                const result = await getPool().request().query`
                    SELECT
                        per.nombre,
                        p.name as puesto, -- El puesto puede ser NULL si no está asignado
                        per.fotoUrl
                    FROM Personal per
                    LEFT JOIN Puestos p ON per.puesto_id = p.id
                    WHERE per.en_carrusel = 1`;
                res.json(result.recordset);
            } catch (err) {
                logger.error('Error obteniendo datos del carrusel público:', err.message, err.stack);
                res.status(500).json({ message: 'Error interno del servidor al obtener datos del carrusel.' });
            }
        });

        /**
         * GET /api/public/personal/cumpleaneros
         * Obtiene el personal que cumple años en el mes actual.
         */
        app.get('/api/public/personal/cumpleaneros', async (req, res) => {
            try {
                const result = await getPool().request().query`SELECT nombre FROM Personal WHERE MONTH(fecha_nacimiento) = MONTH(GETDATE()) ORDER BY DAY(fecha_nacimiento)`;
                res.json(result.recordset);
            } catch (err) {
                logger.error('Error obteniendo datos de cumpleaños públicos:', err.message, err.stack);
                res.status(500).json({ message: 'Error interno del servidor al obtener datos de cumpleaños.' });
            }
        });


        // --- RUTAS DE GESTIÓN DE PERSONAL (protegidas) ---

        /**
         * GET /api/personal
         * Obtiene la lista completa del personal (requiere autenticación).
         */
        app.get('/api/personal', authenticateToken, authorize(['admin', 'staff_manager']), async (req, res) => {
            try {
                const result = await getPool().request().query(`
                    SELECT 
                        per.id, per.nombre, per.correo, per.descripcion, per.fotoUrl, per.en_carrusel, per.fecha_nacimiento,
                        per.puesto_id, pu.name as puesto,
                        dep.name as departamento,
                        COALESCE(
                            (SELECT STRING_AGG(e.number, ', ') FROM PersonalExtension p_ext JOIN Extensions e ON p_ext.extension_id = e.id WHERE p_ext.personal_id = per.id),
                            (SELECT STRING_AGG(e.number, ', ') FROM PuestoExtension pu_ext JOIN Extensions e ON pu_ext.extension_id = e.id WHERE pu_ext.puesto_id = per.puesto_id)
                        ) as extension
                    FROM Personal per
                    LEFT JOIN Puestos pu ON per.puesto_id = pu.id
                    LEFT JOIN Departments dep ON pu.department_id = dep.id
                `);
                result.recordset.sort((a, b) => a.nombre.localeCompare(b.nombre));
                res.json(result.recordset);
            } catch (err) {
                logger.error('Error obteniendo personal:', err);
                res.status(500).json({ message: 'Error interno del servidor al obtener personal.' });
            }
        });

        /**
         * POST /api/personal
         * Crea un nuevo miembro del personal (requiere rol de admin).
         */
        app.post('/api/personal', authenticateToken, authorize(['admin', 'staff_manager']), upload.single('photo'), validate(personalSchema), async (req, res) => {
            const { nombre, correo, puesto_id, descripcion, showInCarousel, fecha_nacimiento, personal_extension_id } = req.body;
            let fotoUrl = req.body.fotoUrl || null;
 
            if (req.file) { 
                fotoUrl = `/uploads/${req.file.filename}`;
            }
 
            const transaction = new sql.Transaction(getPool());
            try {
                await transaction.begin();
 
                const en_carrusel_value = showInCarousel === '1' ? 1 : 0;
                
                // Insertar la persona con su puesto_id y obtener su ID
                const personalResult = await transaction.request()
                    .input('nombre', sql.NVarChar, nombre)
                    .input('correo', sql.NVarChar, correo)
                    .input('descripcion', sql.NVarChar, descripcion)
                    .input('fotoUrl', sql.NVarChar, fotoUrl)
                    .input('en_carrusel', sql.Bit, en_carrusel_value)
                    .input('fecha_nacimiento', sql.Date, fecha_nacimiento || null)
                    .input('puesto_id', sql.Int, puesto_id || null) // Asegurarse que sea null si está vacío
                    .query('INSERT INTO Personal (nombre, correo, descripcion, fotoUrl, en_carrusel, fecha_nacimiento, puesto_id) OUTPUT INSERTED.id VALUES (@nombre, @correo, @descripcion, @fotoUrl, @en_carrusel, @fecha_nacimiento, @puesto_id)');
                
                const newPersonalId = personalResult.recordset[0].id;
 
                // Si se proporcionó una extensión individual, asignarla.
                if (personal_extension_id) {
                    await transaction.request()
                        .input('personal_id', sql.Int, newPersonalId)
                        .input('extension_id', sql.Int, personal_extension_id)
                        .query('INSERT INTO PersonalExtension (personal_id, extension_id) VALUES (@personal_id, @extension_id)');
                }
 
                await transaction.commit();
 
                const newStaffMember = { id: newPersonalId, nombre, correo, descripcion, fotoUrl, en_carrusel: en_carrusel_value, fecha_nacimiento, puesto_id };
                io.emit('staffUpdate'); // Notifica a los clientes conectados sobre el cambio
                res.status(201).json({ message: 'Miembro del personal creado exitosamente.', staff: newStaffMember });
            } catch (err) {
                await transaction.rollback();
                if (err.number === 2627 && err.message.toLowerCase().includes('correo')) {
                    return res.status(409).json({ message: 'El correo electrónico ya está en uso.' });
                }
                logger.error('Error creando miembro del personal:', err);
                res.status(500).json({ message: 'Error interno del servidor al crear miembro del personal.' });
            }
        });

        /**
         * PUT /api/personal/:id
         * Actualiza un miembro del personal existente (requiere rol de admin).
         */
        app.put('/api/personal/:id', authenticateToken, authorize(['admin', 'staff_manager']), upload.single('photo'), validate(personalUpdateSchema), async (req, res) => {
            const { id } = req.params;
            // No extraemos 'nombre', 'correo', etc. directamente, los tomaremos del body si existen.
            const { showInCarousel, fecha_nacimiento, puesto_id } = req.body;

            try {
                // 1. Obtener el registro actual de la base de datos
                const result = await getPool().request().input('id', sql.Int, id).query('SELECT * FROM Personal WHERE id = @id');
                let currentData = result.recordset[0];

                if (!currentData) {
                    return res.status(404).json({ message: 'Miembro del personal no encontrado.' });
                }

                // 2. Manejar la URL de la foto
                let fotoUrl;
                if (req.file) {
                    // Si se sube un nuevo archivo, se usa esa URL
                    fotoUrl = `/uploads/${req.file.filename}`;
                    // Y se borra la foto antigua si existía
                    if (currentData.fotoUrl) {
                        // Medida de seguridad: Limpiar el nombre del archivo para evitar Path Traversal.
                        const oldFileName = path.basename(currentData.fotoUrl);
                        const oldFilePath = path.join(uploadsDir, oldFileName);
                        // Verificar que el archivo realmente existe en el directorio de uploads antes de borrar.
                        if (fs.existsSync(oldFilePath)) {
                           fs.unlink(oldFilePath, (err) => {
                            if (err) logger.error("Error al borrar la foto antigua:", err);
                           });
                        }
                    }
                } else if (req.body.fotoUrl === 'null' || req.body.fotoUrl === '') {
                    fotoUrl = null; // Se quiere eliminar la foto sin reemplazarla.
                } else {
                    // Si no se proporciona ni archivo ni 'fotoUrl', mantener la foto actual
                    fotoUrl = req.body.fotoUrl !== undefined ? req.body.fotoUrl : currentData.fotoUrl;
                }

                // 3. Fusionar los datos de forma segura.
                const updatedData = Object.assign({}, currentData, {
                    nombre: req.body.nombre,
                    correo: req.body.correo, // <-- CORRECCIÓN: Usar el valor del body, no el de la variable
                    descripcion: req.body.descripcion,
                    fotoUrl: fotoUrl, // Usar la fotoUrl ya procesada
                    en_carrusel: showInCarousel !== undefined ? (showInCarousel === '1' ? 1 : 0) : currentData.en_carrusel,
                    fecha_nacimiento: fecha_nacimiento !== undefined ? (fecha_nacimiento || null) : currentData.fecha_nacimiento, // Si la fecha está vacía, se convierte en null
                    puesto_id: puesto_id !== undefined ? (puesto_id || null) : currentData.puesto_id,
                });
                
                // 4. Actualizar los datos de la persona
                await getPool().request()
                    .input('id', sql.Int, id)
                    .input('nombre', sql.NVarChar, updatedData.nombre)
                    .input('correo', sql.NVarChar, updatedData.correo)
                    .input('descripcion', sql.NVarChar, updatedData.descripcion)
                    .input('fotoUrl', sql.NVarChar, updatedData.fotoUrl)
                    .input('en_carrusel', sql.Bit, updatedData.en_carrusel)
                    .input('fecha_nacimiento', sql.Date, updatedData.fecha_nacimiento)
                    .input('puesto_id', sql.Int, updatedData.puesto_id)
                    .query(`UPDATE Personal SET 
                                nombre = @nombre, correo = @correo, descripcion = @descripcion, 
                                fotoUrl = @fotoUrl, en_carrusel = @en_carrusel, 
                                fecha_nacimiento = @fecha_nacimiento, puesto_id = @puesto_id 
                            WHERE id = @id`);
                
                io.emit('staffUpdate'); // Notifica a los clientes conectados
                // Devolver el objeto actualizado es una buena práctica para que el frontend pueda usarlo.
                res.json({ 
                    message: 'Miembro del personal actualizado exitosamente.',
                    staff: updatedData
                });
            } catch (err) {
                if (err.number === 2627 && err.message.toLowerCase().includes('correo')) {
                    return res.status(409).json({ message: 'El correo electrónico ya está en uso por otra persona.' });
                }
                logger.error('Error actualizando miembro del personal:', err);
                res.status(500).json({ message: 'Error interno del servidor al actualizar miembro del personal.' });
            }
        });

        /**
         * PUT /api/personal/:id/extension
         * Asigna o actualiza la extensión individual de una persona.
         */
        app.put('/api/personal/:id/extension', authenticateToken, authorize(['admin', 'staff_manager']), async (req, res) => {
            const { id } = req.params;
            const { extension_id } = req.body; // Puede ser un ID numérico o null/undefined

            const transaction = new sql.Transaction(getPool());
            try {
                await transaction.begin();
                const request = new sql.Request(transaction);

                // 1. Desasignar cualquier extensión individual que la persona ya tuviera.
                await request.input('personal_id_clear', sql.Int, id).query('DELETE FROM PersonalExtension WHERE personal_id = @personal_id_clear');

                // 2. Si se proporcionó una nueva extension_id, asignarla.
                if (extension_id) {
                    // Verificar que la extensión no esté ya ocupada por un PUESTO.
                    // Se permite que varias personas compartan la misma extensión individual.
                    const checkResult = await request
                        .input('extension_id_check', sql.Int, extension_id)
                        .query(`
                            SELECT COUNT(*) as puesto_count FROM PuestoExtension WHERE extension_id = @extension_id_check
                        `);
                    
                    if (checkResult.recordset[0].puesto_count > 0) {
                        throw new Error('La extensión seleccionada ya está asignada a un puesto y no puede ser asignada individualmente.');
                    }

                    await request.input('personal_id_assign', sql.Int, id).input('extension_id_assign', sql.Int, extension_id).query('INSERT INTO PersonalExtension (personal_id, extension_id) VALUES (@personal_id_assign, @extension_id_assign)');
                }

                await transaction.commit();
                io.emit('staffUpdate'); // Notificar a los clientes
                res.json({ message: 'Extensión personal actualizada exitosamente.' });
            } catch (err) {
                await transaction.rollback();
                logger.error('Error actualizando extensión personal:', err);
                res.status(err.message.includes('en uso') ? 409 : 500).json({ message: err.message || 'Error interno del servidor.' });
            }
        });

        /**
         * DELETE /api/personal/:id
         * Elimina un miembro del personal (requiere rol de admin).
         */
        app.delete('/api/personal/:id', authenticateToken, authorize(['admin', 'staff_manager']), async (req, res) => {
            const { id } = req.params;
             try {
                // 1. Obtener el registro para saber si tiene una foto asociada (el campo es 'fotoUrl')
                const result = await getPool().request().input('id', sql.Int, id).query('SELECT fotoUrl FROM Personal WHERE id = @id');
                const currentData = result.recordset[0];

                if (!currentData) {
                    return res.status(404).json({ message: 'Miembro del personal no encontrado.' });
                }

                // 2. Eliminar el registro de la base de datos
                await getPool().request().input('id', sql.Int, id).query('DELETE FROM Personal WHERE id = @id');

                // 3. Si tenía una foto, borrarla del sistema de archivos
                if (currentData.fotoUrl) {
                    // Medida de seguridad: Limpiar el nombre del archivo para evitar Path Traversal.
                    const fileNameToDelete = path.basename(currentData.fotoUrl);
                    const filePathToDelete = path.join(uploadsDir, fileNameToDelete);
                    if (fs.existsSync(filePathToDelete))
                        fs.unlinkSync(filePathToDelete);
                }

                io.emit('staffUpdate'); // Notifica a los clientes conectados
                res.json({ message: 'Miembro del personal eliminado exitosamente.' });
            } catch (err) {
                logger.error('Error eliminando miembro del personal:', err);
                res.status(500).json({ message: 'Error interno del servidor al eliminar miembro del personal.' });
            }
        });

        /**
         * POST /api/personal/bulk-upload
         * Carga masiva de personal desde un archivo CSV (requiere rol de admin).
         */
        app.post('/api/personal/bulk-upload', authenticateToken, authorize(['admin', 'staff_manager']), uploadBulk.single('csvFile'), async (req, res) => {
            if (!req.file) {
                return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
            }
        
            const filePath = req.file.path;
        
            try {
                // Envolver todo el procesamiento en una promesa para poder usar await
                const result = await new Promise((resolve, reject) => {
                    const csv = require('fast-csv');
                    const records = [];
        
                    fs.createReadStream(filePath)
                        .pipe(csv.parse({ headers: true, trim: true }))
                        .on('error', (err) => reject(new Error(`El archivo CSV está malformado. Error: ${err.message}`)))
                        .on('data', (row) => records.push(row))
                        .on('end', async () => {
                            let successfulInserts = 0;
                            let failedRows = 0;
                            const errors = [];
        
                            try {
                                if (records.length === 0) {
                                    throw new Error('El archivo CSV está vacío o no tiene datos.');
                                }
        
                                const transaction = new sql.Transaction(getPool());
                                await transaction.begin();
        
                                for (const [index, record] of records.entries()) {
                                    try {
                                        const { nombre, correo, puesto, departamento, extension, extension_individual, descripcion, fotoUrl, en_carrusel, fecha_nacimiento } = record;
                                        if (!nombre || !correo || !puesto || !departamento) {
                                            throw new Error(`Datos incompletos. Se requieren: nombre, correo, puesto, departamento.`);
                                        }
        
                                        let departmentId;
                                        let depResult = await transaction.request().input('depName', sql.NVarChar, departamento).query('SELECT id FROM Departments WHERE name = @depName');
                                        if (depResult.recordset.length > 0) {
                                            departmentId = depResult.recordset[0].id;
                                        } else {
                                            depResult = await transaction.request().input('depNameInsert', sql.NVarChar, departamento).query('INSERT INTO Departments (name) OUTPUT INSERTED.id VALUES (@depNameInsert)');
                                            departmentId = depResult.recordset[0].id;
                                        }
        
                                        let puestoId;
                                        let puestoResult = await transaction.request().input('puestoName', sql.NVarChar, puesto).input('depId', sql.Int, departmentId).query('SELECT id FROM Puestos WHERE name = @puestoName AND department_id = @depId');
                                        if (puestoResult.recordset.length > 0) {
                                            puestoId = puestoResult.recordset[0].id;
                                        } else {
                                            puestoResult = await transaction.request().input('puestoNameInsert', sql.NVarChar, puesto).input('depIdInsert', sql.Int, departmentId).query('INSERT INTO Puestos (name, department_id) OUTPUT INSERTED.id VALUES (@puestoNameInsert, @depIdInsert)');
                                            puestoId = puestoResult.recordset[0].id;
                                        }
        
                                        // --- Lógica para la extensión del PUESTO ---
                                        if (extension) {
                                            let extensionId;
                                            let extResult = await transaction.request().input('extNumber', sql.NVarChar, extension).query('SELECT id FROM Extensions WHERE number = @extNumber');
                                            if (extResult.recordset.length > 0) {
                                                extensionId = extResult.recordset[0].id;
                                            } else {
                                                extResult = await transaction.request().input('extNumberInsert', sql.NVarChar, extension).query('INSERT INTO Extensions (number) OUTPUT INSERTED.id VALUES (@extNumberInsert)');
                                                extensionId = extResult.recordset[0].id;
                                            }
                                            await transaction.request().input('puestoIdForExt', sql.Int, puestoId).input('extId', sql.Int, extensionId).query('MERGE PuestoExtension AS target USING (VALUES (@puestoIdForExt, @extId)) AS source (puesto_id, extension_id) ON target.puesto_id = source.puesto_id AND target.extension_id = source.extension_id WHEN NOT MATCHED THEN INSERT (puesto_id, extension_id) VALUES (source.puesto_id, source.extension_id);');
                                        }
        
                                        // --- Lógica para la extensión INDIVIDUAL de la PERSONA ---
                                        let individualExtensionId = null;
                                        if (extension_individual) {
                                            let extResult = await transaction.request().input('extIndNumber', sql.NVarChar, extension_individual).query('SELECT id FROM Extensions WHERE number = @extIndNumber');
                                            if (extResult.recordset.length > 0) {
                                                individualExtensionId = extResult.recordset[0].id;
                                            } else {
                                                // Si la extensión individual no existe, la creamos
                                                extResult = await transaction.request().input('extIndNumberInsert', sql.NVarChar, extension_individual).query('INSERT INTO Extensions (number) OUTPUT INSERTED.id VALUES (@extIndNumberInsert)');
                                                individualExtensionId = extResult.recordset[0].id;
                                            }
                                        }

                                        const enCarruselBit = en_carrusel === '1' || String(en_carrusel).toLowerCase() === 'true' ? 1 : 0;
                                        const fechaNacimientoDate = fecha_nacimiento || null;
        
                                        const personalResult = await transaction.request()
                                            .input('nombre_merge', sql.NVarChar, nombre)
                                            .input('correo_merge', sql.NVarChar, correo)
                                            .input('puesto_id_merge', sql.Int, puestoId)
                                            .input('descripcion_merge', sql.NVarChar, descripcion || null)
                                            .input('fotoUrl_merge', sql.NVarChar, fotoUrl || null)
                                            .input('en_carrusel_merge', sql.Bit, enCarruselBit)
                                            .input('fecha_nacimiento_merge', sql.Date, fechaNacimientoDate)
                                            .query(`
                                                MERGE Personal AS target USING (VALUES (@nombre_merge)) AS source (nombre) ON target.nombre = source.nombre
                                                WHEN MATCHED THEN UPDATE SET correo = @correo_merge, puesto_id = @puesto_id_merge, descripcion = @descripcion_merge, fotoUrl = @fotoUrl_merge, en_carrusel = @en_carrusel_merge, fecha_nacimiento = @fecha_nacimiento_merge
                                                WHEN NOT MATCHED THEN INSERT (nombre, correo, puesto_id, descripcion, fotoUrl, en_carrusel, fecha_nacimiento) VALUES (@nombre_merge, @correo_merge, @puesto_id_merge, @descripcion_merge, @fotoUrl_merge, @en_carrusel_merge, @fecha_nacimiento_merge)
                                                OUTPUT INSERTED.id;
                                            `);
                                        
                                        const newPersonalId = personalResult.recordset[0].id;

                                        // Si hay una extensión individual, la asignamos a la persona
                                        if (individualExtensionId) {
                                            await transaction.request().input('personalIdForExt', sql.Int, newPersonalId).input('extId', sql.Int, individualExtensionId).query('DELETE FROM PersonalExtension WHERE personal_id = @personalIdForExt; INSERT INTO PersonalExtension (personal_id, extension_id) VALUES (@personalIdForExt, @extId);');
                                        }

                                        successfulInserts++;
                                    } catch (rowError) {
                                        failedRows++;
                                        errors.push(`Error en fila ${index + 2} (${record.nombre || 'N/A'}): ${rowError.message}`);
                                    }
                                }
        
                                // --- LÓGICA MEJORADA: Commit de registros exitosos, rollback de errores individuales ---
                                // En lugar de un rollback total, hemos manejado los errores por fila.
                                // Ahora hacemos commit de todos los cambios que sí fueron exitosos.
                                await transaction.commit();

                                // Construir el mensaje de respuesta final
                                let responseMessage = `Carga completada. ${successfulInserts} registros procesados exitosamente.`;
                                if (failedRows > 0) {
                                    responseMessage += ` ${failedRows} registros fallaron.`;
                                }
                                resolve({ message: responseMessage, errors });
                            } catch (processError) {
                                if (transaction.active) await transaction.rollback(); // Asegurarse de hacer rollback en caso de un error inesperado
                                reject(processError); // Rechazar la promesa si hay un error general
                            }
                        });
                });
        
                // Si la promesa se resuelve, significa que todo fue bien.
                io.emit('staffUpdate');
                res.status(200).json(result);
        
            } catch (error) {
                // Este catch captura los errores de la promesa (reject)
                logger.error('Error durante la carga masiva:', error);
                const status = error.message.includes("malformado") ? 400 : 500;
                res.status(status).json({ message: error.message || 'Error interno del servidor.', errors: error.errors || [] });
            } finally {
                // Asegurarse de que el archivo temporal siempre se elimine.
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        });

        /**
         * GET /api/personal/template
         * Descarga una plantilla CSV para la carga masiva.
         */
        app.get('/api/personal/template', authenticateToken, authorize(['admin', 'staff_manager']), (req, res) => {
            const headers = "nombre,correo,puesto,departamento,extension,extension_individual,descripcion,fotoUrl,en_carrusel,fecha_nacimiento";
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="plantilla_personal.csv"');
            res.status(200).send(headers);
        });


        // --- RUTAS DE GESTIÓN DE USUARIOS (protegidas) ---

        /**
         * GET /api/users
         * Obtiene la lista de usuarios (requiere rol de admin).
         */
        app.get('/api/users', authenticateToken, authorize(['admin']), async (req, res) => {
            try {
                const result = await getPool().request().query('SELECT id, username, role FROM Users ORDER BY username');
                res.json(result.recordset);
            } catch (err) {
                logger.error('Error obteniendo usuarios:', err);
                res.status(500).json({ message: 'Error al obtener usuarios.' });
            }
        });

        /**
         * DELETE /api/users/:id
         * Elimina un usuario (requiere rol de admin).
         */
        app.delete('/api/users/:id', authenticateToken, authorize(['admin']), async (req, res) => {
            const { id } = req.params;
            const adminUserId = req.user.id;

            if (parseInt(id, 10) === adminUserId) {
                return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta de administrador.' });
            }

            try {
                const result = await getPool().request().input('id', sql.Int, id).query('DELETE FROM Users WHERE id = @id');
                if (result.rowsAffected[0] > 0) {
                    res.json({ message: 'Usuario eliminado exitosamente.' });
                } else {
                    res.status(404).json({ message: 'Usuario no encontrado.' });
                }
            } catch (err) {
                logger.error('Error eliminando usuario:', err);
                res.status(500).json({ message: 'Error interno del servidor al eliminar el usuario.' });
            }
        });

        // --- RUTAS DE GESTIÓN DE EXTENSIONES (protegidas) ---

        /**
         * GET /api/extensions
         * Obtiene la lista de todas las extensiones y a quién están asignadas.
         */
        app.get('/api/extensions', authenticateToken, authorize(['admin']), async (req, res) => {
            try {
                const result = await getPool().request().query(/*sql*/`
                    SELECT
                        e.id,
                        e.number,
                        puesto_info.puesto_name,
                        puesto_info.puesto_id,
                        personal_info.personal_name,
                        COALESCE(e.department_id, puesto_info.department_id, personal_info.department_id) as department_id,
                        COALESCE(dep.name, puesto_info.department_name, personal_info.department_name) as department_name,
                        CASE WHEN puesto_info.puesto_id IS NOT NULL OR personal_info.personal_name IS NOT NULL THEN 1 ELSE 0 END as is_occupied
                    FROM Extensions e
                    LEFT JOIN Departments dep ON e.department_id = dep.id
                    OUTER APPLY (
                        SELECT TOP 1 p.name as puesto_name, p.id as puesto_id, d.id as department_id, d.name as department_name
                        FROM PuestoExtension pe
                        JOIN Puestos p ON pe.puesto_id = p.id 
                        JOIN Departments d ON p.department_id = d.id -- CORRECCIÓN 1: Especificar p.department_id
                        WHERE pe.extension_id = e.id
                    ) AS puesto_info
                    OUTER APPLY (
                        SELECT 
                            STRING_AGG(per.nombre, ', ') as personal_name,
                            MIN(d.id) as department_id, MIN(d.name) as department_name -- CORRECCIÓN: Obtener ID y nombre del departamento
                        FROM PersonalExtension p_ext
                        JOIN Personal per ON p_ext.personal_id = per.id
                        LEFT JOIN Puestos p ON per.puesto_id = p.id
                        LEFT JOIN Departments d ON p.department_id = d.id
                        WHERE p_ext.extension_id = e.id
                    ) AS personal_info
                    ORDER BY CAST(e.number AS INT)
                `);
                res.json(result.recordset);
            } catch (err) {
                logger.error('Error obteniendo extensiones:', err);
                res.status(500).json({ message: 'Error al obtener extensiones.' });
            }
        });

        /**
         * POST /api/extensions
         * Crea una nueva extensión.
         */
        app.post('/api/extensions', authenticateToken, authorize(['admin']), async (req, res) => {
            const { number, department_id } = req.body;
            if (!number) {
                return res.status(400).json({ message: 'El número de extensión es requerido.' });
            }
            try {
                await getPool().request()
                    .input('number', sql.NVarChar, number)
                    .input('department_id', sql.Int, department_id || null)
                    .query('INSERT INTO Extensions (number, department_id) VALUES (@number, @department_id)');
                res.status(201).json({ message: 'Extensión agregada exitosamente.' });
            } catch (err) {
                if (err.number === 2627) { // Violación de clave única
                    return res.status(409).json({ message: 'La extensión ya existe.' });
                }
                logger.error('Error agregando extensión:', err);
                res.status(500).json({ message: 'Error al agregar la extensión.' });
            }
        });

        /**
         * DELETE /api/extensions/:id
         * Elimina una extensión.
         */
        app.delete('/api/extensions/:id', authenticateToken, authorize(['admin']), async (req, res) => {
            const { id } = req.params;
            try {
                const result = await getPool().request().input('id', sql.Int, id).query('DELETE FROM Extensions WHERE id = @id');
                if (result.rowsAffected[0] > 0) {
                    res.json({ message: 'Extensión eliminada exitosamente.' });
                } else {
                    res.status(404).json({ message: 'Extensión no encontrada.' });
                }
            } catch (err) {
                logger.error('Error eliminando extensión:', err);
                res.status(500).json({ message: 'Error interno del servidor al eliminar la extensión.' });
            }
        });

        /**
         * GET /api/extensions/template
         * Descarga una plantilla CSV para la carga masiva de extensiones.
         */
        app.get('/api/extensions/template', authenticateToken, authorize(['admin']), (req, res) => {
            const headers = "number,departamento";
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="plantilla_extensiones.csv"');
            res.status(200).send(headers);
        });

        /**
         * POST /api/extensions/bulk-upload
         * Carga masiva de extensiones desde un archivo CSV (requiere rol de admin).
         * El CSV debe tener una columna 'number' y opcionalmente 'departamento'.
         */
        app.post('/api/extensions/bulk-upload', authenticateToken, authorize(['admin', 'staff_manager']), uploadBulk.single('csvFile'), async (req, res) => {
            if (!req.file) {
                return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
            }

            const filePath = req.file.path;

            try {
                const result = await new Promise((resolve, reject) => {
                    const csv = require('fast-csv');
                    const records = [];

                    fs.createReadStream(filePath)
                        .pipe(csv.parse({ headers: true, trim: true }))
                        .on('error', (err) => reject(new Error(`El archivo CSV está malformado. Error: ${err.message}`)))
                        .on('data', (row) => records.push(row))
                        .on('end', async () => {
                            let successfulInserts = 0;
                            let skippedDuplicates = 0;
                            const errors = [];

                            try {
                                if (records.length === 0) {
                                    throw new Error('El archivo CSV está vacío o no tiene datos.');
                                }

                                const transaction = new sql.Transaction(getPool());
                                await transaction.begin();

                                for (const [index, record] of records.entries()) {
                                    const { number, departamento } = record;

                                    try {
                                    if (!number) {
                                        errors.push(`Fila ${index + 2}: Falta el número de extensión.`);
                                        continue;
                                    }

                                    // Verificar si la extensión ya existe
                                    const existingExt = await transaction.request().input('numberCheck', sql.NVarChar, number).query('SELECT id FROM Extensions WHERE number = @numberCheck');
                                    if (existingExt.recordset.length > 0) {
                                        skippedDuplicates++;
                                        continue; // Omitir duplicados
                                    }

                                    // --- LÓGICA MEJORADA PARA DEPARTAMENTOS ---
                                    let departmentId = null;
                                    if (departamento) {
                                        let depResult = await transaction.request().input('depName', sql.NVarChar, departamento).query('SELECT id FROM Departments WHERE name = @depName');
                                        if (depResult.recordset.length > 0) {
                                            departmentId = depResult.recordset[0].id;
                                        } else {
                                            depResult = await transaction.request().input('depNameInsert', sql.NVarChar, departamento).query('INSERT INTO Departments (name) OUTPUT INSERTED.id VALUES (@depNameInsert)');
                                            // Si el departamento se crea, obtenemos su nuevo ID
                                            departmentId = depResult.recordset[0].id;
                                        }
                                    }

                                    await transaction.request()
                                        .input('numberInsert', sql.NVarChar, number)
                                        .input('departmentIdInsert', sql.Int, departmentId)
                                        .query('INSERT INTO Extensions (number, department_id) VALUES (@numberInsert, @departmentIdInsert)');
                                    
                                    successfulInserts++;
                                    } catch (rowError) {
                                        // Capturar errores por fila sin detener toda la transacción
                                        errors.push(`Error en fila ${index + 2} (${number || 'N/A'}): ${rowError.message}`);
                                    }
                                }

                                // Si hubo errores en alguna fila, hacemos rollback. Si no, commit.
                                if (errors.length > 0) {
                                    await transaction.rollback();
                                    reject({ message: `Se encontraron ${errors.length} errores. Ninguna extensión fue guardada.`, errors });
                                } else {
                                    await transaction.commit();
                                    resolve({ message: `Carga completada. ${successfulInserts} extensiones agregadas, ${skippedDuplicates} omitidas (duplicadas).` });
                                }

                            } catch (processError) {
                            }
                        });
                });

                res.status(200).json(result);

            } catch (error) {
                logger.error('Error durante la carga masiva de extensiones:', error);
                const status = error.message.includes("malformado") ? 400 : 500;
                res.status(status).json({ message: error.message || 'Error interno del servidor.', errors: error.errors || [] });
            } finally {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        });

        // --- RUTAS DE GESTIÓN DE DEPARTAMENTOS (protegidas) ---

        /**
         * GET /api/departments
         * Obtiene la lista de todos los departamentos.
         */
        app.get('/api/departments', authenticateToken, authorize(['admin']), async (req, res) => {
            try {
                const result = await getPool().request().query('SELECT id, name FROM Departments ORDER BY name');
                res.json(result.recordset);
            } catch (err) {
                logger.error('Error obteniendo departamentos:', err);
                res.status(500).json({ message: 'Error al obtener departamentos.' });
            }
        });

        /**
         * POST /api/departments
         * Crea un nuevo departamento.
         */
        app.post('/api/departments', authenticateToken, authorize(['admin']), async (req, res) => {
            const { name } = req.body;
            if (!name) {
                return res.status(400).json({ message: 'El nombre del departamento es requerido.' });
            }
            try {
                await getPool().request().input('name', sql.NVarChar, name).query('INSERT INTO Departments (name) VALUES (@name)');
                res.status(201).json({ message: 'Departamento agregado exitosamente.' });
            } catch (err) {
                if (err.number === 2627) { // Violación de clave única
                    return res.status(409).json({ message: 'El departamento ya existe.' });
                }
                logger.error('Error agregando departamento:', err);
                res.status(500).json({ message: 'Error al agregar el departamento.' });
            }
        });

        /**
         * DELETE /api/departments/:id
         * Elimina un departamento (requiere rol de admin).
         */
        app.delete('/api/departments/:id', authenticateToken, authorize(['admin']), async (req, res) => {
            const { id } = req.params;
            try {
                const result = await getPool().request().input('id', sql.Int, id).query('DELETE FROM Departments WHERE id = @id');
                if (result.rowsAffected[0] > 0) {
                    res.json({ message: 'Departamento eliminado exitosamente.' });
                } else {
                    res.status(404).json({ message: 'Departamento no encontrado.' });
                }
            } catch (err) {
                // Error 547 indica una violación de la restricción FOREIGN KEY.
                if (err.number === 547) {
                    return res.status(409).json({ message: 'No se puede eliminar el departamento porque tiene puestos de trabajo asociados.' });
                }
                logger.error('Error eliminando departamento:', err);
                res.status(500).json({ message: 'Error interno del servidor al eliminar el departamento.' });
            }
        });

        /**
         * GET /api/puestos
         * Obtiene la lista de todos los puestos de trabajo existentes.
         */
        app.get('/api/puestos', authenticateToken, authorize(['admin']), async (req, res) => {
            try {
                const result = await getPool().request().query(`
                    SELECT 
                        p.id, p.name, p.department_id, d.name as department_name,
                        (SELECT STRING_AGG(e.number, ', ') FROM PuestoExtension pe JOIN Extensions e ON pe.extension_id = e.id WHERE pe.puesto_id = p.id) as extension_number,
                        (SELECT STRING_AGG(per.nombre, ', ') FROM Personal per WHERE per.puesto_id = p.id) as personal_name
                    FROM Puestos p
                    JOIN Departments d ON p.department_id = d.id
                    -- LEFT JOIN Personal per ON p.id = per.puesto_id -- Se cambia la lógica para mostrar todos los que ocupan el puesto
                    ORDER BY d.name, p.name
                `);
                res.json(result.recordset);
            } catch (err) {
                logger.error('Error obteniendo puestos:', err);
                res.status(500).json({ message: 'Error al obtener puestos.' });
            }
        });

        /**
         * POST /api/puestos
         * Crea un nuevo puesto.
         */
        app.post('/api/puestos', authenticateToken, authorize(['admin']), async (req, res) => {
            // Extraer y limpiar los datos del cuerpo de la petición.
            const { name: rawName, department_id, extension_id } = req.body;
            const name = rawName ? rawName.trim() : null;

            if (!name || !department_id) {
                return res.status(400).json({ message: 'El nombre del puesto y el departamento son requeridos.' });
            }

            const transaction = new sql.Transaction(getPool());
            try {
                await transaction.begin();

                // 1. Insertar el nuevo puesto y obtener su ID
                const puestoResult = await transaction.request()
                    .input('name', sql.NVarChar, name)
                    .input('department_id', sql.Int, department_id)
                    .query('INSERT INTO Puestos (name, department_id) OUTPUT INSERTED.id VALUES (@name, @department_id)');
                
                const newPuestoId = puestoResult.recordset[0].id;

                // 2. Si se proporcionó una extensión, crear la relación en la tabla PuestoExtension
                if (extension_id) {
                    await transaction.request()
                        .input('puesto_id', sql.Int, newPuestoId)
                        .input('extension_id', sql.Int, extension_id)
                        .query('INSERT INTO PuestoExtension (puesto_id, extension_id) VALUES (@puesto_id, @extension_id)');
                }

                await transaction.commit();
                res.status(201).json({ message: 'Puesto creado exitosamente.' });
            } catch (err) {
                await transaction.rollback();
                // Este bloque catch ahora es un seguro secundario. La verificación previa debería atrapar la mayoría de los casos.
                if (err.number === 2627 || (err.number === 2601 && err.message.includes('UQ_Puestos_Name_Department'))) {
                    return res.status(409).json({ message: 'Ya existe un puesto con ese nombre en el departamento seleccionado.' });
                }
                logger.error('Error creando puesto:', err);
                res.status(500).json({ message: 'Error al crear el puesto.' });
            }
        });

        /**
         * DELETE /api/puestos/:id
         * Elimina un puesto.
         */
        app.delete('/api/puestos/:id', authenticateToken, authorize(['admin']), async (req, res) => {
            const { id } = req.params;
            try {
                const result = await getPool().request().input('id', sql.Int, id).query('DELETE FROM Puestos WHERE id = @id');
                if (result.rowsAffected[0] > 0) {
                    res.json({ message: 'Puesto eliminado exitosamente.' });
                } else {
                    res.status(404).json({ message: 'Puesto no encontrado.' });
                }
            } catch (err) {
                // Error 547 también aplica aquí si un puesto está referenciado en otra tabla (aunque en el esquema actual no parece ser el caso, es buena práctica).
                if (err.number === 547) {
                    return res.status(409).json({ message: 'No se puede eliminar el puesto porque está en uso.' });
                }
                logger.error('Error eliminando puesto:', err);
                res.status(500).json({ message: 'Error al eliminar el puesto.' });
            }
        });



        // --- RUTAS DE GESTIÓN DE INFORMACIÓN IMPORTANTE (protegidas) ---

        /**
         * GET /api/important-info
         * Obtiene toda la información importante (requiere autenticación y rol de admin).
         */
        app.get('/api/important-info', authenticateToken, authorize(['admin']), async (req, res) => {
            try {
                const info = await getImportantInfo();
                res.json(info);
            } catch (err) {
                logger.error('Error al obtener información importante:', err);
                res.status(500).json({ message: 'Error al obtener información importante.' });
            }
        });

        /**
         * POST /api/important-info
         * Agrega nueva información importante (requiere autenticación y rol de admin).
         */
        app.post('/api/important-info', authenticateToken, authorize(['admin']), async (req, res) => {
            const { title, content, extension } = req.body;
            if (!title) {
                return res.status(400).json({ message: 'El título es requerido.' });
            }
            try {
                const newInfo = await addImportantInfo(title, content, extension);
                io.emit('importantInfoUpdate'); // Notifica a los clientes conectados
                res.status(201).json({ message: 'Información importante agregada exitosamente.', info: newInfo });
            } catch (err) {
                logger.error('Error al agregar información importante:', err);
                res.status(500).json({ message: 'Error al agregar información importante.' });
            }
        });

        /**
         * PUT /api/important-info/:id
         * Actualiza información importante existente (requiere autenticación y rol de admin).
         */
        app.put('/api/important-info/:id', authenticateToken, authorize(['admin']), async (req, res) => {
            const { id } = req.params;
            const { title, content, extension } = req.body;
            if (!title) {
                return res.status(400).json({ message: 'El título es requerido.' });
            }
             try {
                // 1. Verificar si la información existe primero
                const existingInfo = await getImportantInfoById(parseInt(id));
                if (!existingInfo) {
                    return res.status(404).json({ message: 'Información importante no encontrada.' });
                }

                // 2. Intentar la actualización
                await updateImportantInfo(parseInt(id), title, content, extension);

                // 3. Como ya verificamos que existe, podemos asumir que la operación fue exitosa
                // incluso si no se cambiaron filas (porque los datos eran los mismos).
                    io.emit('importantInfoUpdate'); // Notifica a los clientes conectados
                    res.json({ message: 'Información importante actualizada exitosamente.' });

            } catch (err) {
                logger.error('Error al actualizar información importante:', err);
                res.status(500).json({ message: 'Error al actualizar información importante.' });
            }
        });

        /**
         * DELETE /api/important-info/:id
         * Elimina información importante (requiere autenticación y rol de admin).
         */
        app.delete('/api/important-info/:id', authenticateToken, authorize(['admin']), async (req, res) => {
            const { id } = req.params;
            try {
                const deleted = await deleteImportantInfo(parseInt(id));
                if (deleted) {
                    io.emit('importantInfoUpdate'); // Notifica a los clientes conectados
                    res.json({ message: 'Información importante eliminada exitosamente.' });
                } else {
                    res.status(404).json({ message: 'Información importante no encontrada.' });
                }
            } catch (err) {
                logger.error('Error al eliminar información importante:', err);
                res.status(500).json({ message: 'Error al eliminar información importante.' });
            }
        });

        // --- RUTAS PÚBLICAS DE INFORMACIÓN IMPORTANTE (no requieren autenticación) ---

        /**
         * GET /api/public/important-info
         * Obtiene toda la información importante para la página pública.
         */
        app.get('/api/public/important-info', async (req, res) => {
            try {
                const info = await getImportantInfo();
                res.json(info);
            } catch (err) {
                logger.error('Error al obtener información importante pública:', err);
                res.status(500).json({ message: 'Error al obtener información importante.' });
            }
        });


        // --- RUTAS DE GESTIÓN DE APARIENCIA ---

        /**
         * GET /api/settings
         * Obtiene la configuración de apariencia actual.
         */
        app.get('/api/settings', (req, res) => {
            res.json({ theme: currentTheme });
        });



        /**
         * GET /api/theme
         * Obtiene el tema de apariencia actual.
         */
        app.get('/api/theme', (req, res) => {
            res.json({ theme: currentTheme });
        });

        /**
         * POST /api/theme
         * Establece un nuevo tema de apariencia.
         */
        app.post('/api/theme', authenticateToken, authorize(['admin']), (req, res) => {
            const { theme } = req.body;
            if (['default', 'sunny', 'rainy', 'cloudy', 'light', 'dark', 'christmas'].includes(theme)) {
                currentTheme = theme;
                io.emit('themeChange', currentTheme); // Notifica a los clientes sobre el cambio de tema
                res.json({ message: `Tema cambiado a ${theme}` });
            } else {
                res.status(400).json({ message: 'Tema inválido.' });
            }
        });


// --- ARRANQUE DEL SERVIDOR ---
const port = process.env.PORT || 3000;
const host = '0.0.0.0';

// Solo inicia el servidor y la conexión a la BD si el script se ejecuta directamente
if (process.env.NODE_ENV !== 'test') {
    (async () => {
        try {
            await connect(); // Conectar a la base de datos y esperar a que termine
            // --- MANEJO DE CONEXIONES DE SOCKET.IO ---
            io.on('connection', (socket) => {
                logger.info('Un usuario se ha conectado vía WebSocket.');
                socket.on('disconnect', () => {
                    logger.info('El usuario se ha desconectado.');
                });
            });
            server.listen(port, host, () => {
                logger.info(`Servidor corriendo en http://${host}:${port}`);
            });
        } catch (error) {
            logger.error('Error fatal durante el arranque del servidor: No se pudo conectar a la base de datos.', error);
            process.exit(1); // Termina el proceso con un código de error.
        }
    })();
}

// Manejo de cierre de la aplicación para cerrar la conexión a la base de datos
process.on('SIGINT', async () => {
    logger.info('SIGINT recibido. Cerrando servidor y conexión a la base de datos...');
    await close();
    io.close(); // Asegurarse de cerrar también socket.io
    server.close((err) => {
        logger.info('Servidor HTTP cerrado.');
        // No es necesario process.exit() aquí, el proceso terminará limpiamente.
    });
});

process.on('SIGTERM', async () => {
    logger.info('SIGTERM recibido. Cerrando servidor y conexión a la base de datos...');
    await close();
    io.close(); // Asegurarse de cerrar también socket.io
    server.close((err) => {
        logger.info('Servidor HTTP cerrado.');
        // No es necesario process.exit() aquí.
    });
});

// Exporta la app y el servidor para poder usarlos en las pruebas
module.exports = { app, server, io };
