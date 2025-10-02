console.log("--- ¡HOLA! ESTOY EJECUTANDO EL SERVIDOR CORRECTO ---");
// --- IMPORTACIONES DE MÓDULOS ---
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
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
const { validate, registerSchema, loginSchema, personalSchema, personalUpdateSchema } = require('./validation'); // Esquemas y middleware de validación
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
      "worker-src": ["'self'", "blob:"],
      "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      "style-src-elem": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
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
    if (file.mimetype === 'text/csv') {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos CSV!'), false);
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
 * Debe usarse después de authenticateToken.
 */
const authorizeAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. Se requiere rol de administrador.' });
    }
    next();
};

// --- MIDDLEWARE DE LÍMITE DE TASA ---
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login requests per windowMs
    message: 'Demasiados intentos de login desde esta IP, por favor intente de nuevo después de 15 minutos.',
    standardHeaders: true,
    legacyHeaders: false,
});


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
        



/**
 * POST /api/login
 * Autentica a un usuario y devuelve un token JWT si las credenciales son correctas.
 */
        app.post('/api/login', loginLimiter, validate(loginSchema), async (req, res) => {
            const { username, password } = req.body;
            logger.info(`Intento de login para el usuario: ${username}`);

            try {
                const result = await getPool().query`SELECT * FROM Users WHERE username = ${username}`;
                const user = result.recordset[0];

                if (!user) {
                    logger.info(`Usuario no encontrado: ${username}`);
                    return res.status(401).json({ message: 'Credenciales inválidas.' });
                }

                logger.info(`Usuario encontrado: ${JSON.stringify(user)}`);
                logger.info(`Iniciando comparación de contraseña para el usuario: ${username}`);
                const isMatch = await bcrypt.compare(password, user.password);
                logger.info(`Comparación de contraseña terminada. Coincidencia: ${isMatch}`);

                if (isMatch) {
                    logger.info(`Login exitoso para el usuario: ${username}`);
                    const tokenPayload = { id: user.id, username: user.username, role: user.role };
                    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '15m' });
                    
                    res.cookie('authToken', token, {
                        httpOnly: true,
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: 'strict',
                        maxAge: 15 * 60 * 1000
                    });

                    // Adjuntar los datos iniciales del dashboard a la respuesta de login
                    const staffResult = await getPool().query`SELECT *, en_carrusel as showInCarousel FROM Personal`;
                    const staffData = staffResult.recordset;

                    res.json({
                        message: 'Login exitoso.',
                        user: tokenPayload,
                        staff: staffData
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
                const result = await getPool().request().query`
                    SELECT ID, Nombre, Puesto, Departamento, Extension, Correo, FotoUrl, en_carrusel, fecha_nacimiento, descripcion
                    FROM Personal
                    ORDER BY ID
                    OFFSET ${offset} ROWS
                    FETCH NEXT ${limit} ROWS ONLY;
                `;
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
            try {
                const searchTerm = req.query.q;
                if (!searchTerm) {
                    return res.status(400).json({ message: 'El término de búsqueda (q) es requerido.' });
                }

                const searchPattern = `%${searchTerm}%`; // For partial, case-insensitive matching

                const result = await getPool().query`
                    SELECT ID, Nombre, Puesto, Departamento, Extension, Correo, FotoUrl, en_carrusel, fecha_nacimiento, descripcion
                    FROM Personal
                    WHERE 
                        Nombre LIKE ${searchPattern} OR
                        Puesto LIKE ${searchPattern} OR
                        Departamento LIKE ${searchPattern} OR
                        Correo LIKE ${searchPattern} OR
                        Extension LIKE ${searchPattern}
                    ORDER BY Nombre;
                `;
                res.json(result.recordset);
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
                const result = await getPool().request().query`SELECT * FROM Personal WHERE en_carrusel = 1`;
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
                const result = await getPool().request().query`SELECT Nombre FROM Personal WHERE MONTH(fecha_nacimiento) = MONTH(GETDATE()) ORDER BY DAY(fecha_nacimiento)`;
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
        app.get('/api/personal', authenticateToken, async (req, res) => {
            try {
                const result = await getPool().query`SELECT *, en_carrusel as showInCarousel FROM Personal`;
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
        app.post('/api/personal', authenticateToken, authorizeAdmin, upload.single('photo'), validate(personalSchema), async (req, res) => {
            const { nombre, correo, extension, puesto, departamento, descripcion, showInCarousel, fecha_nacimiento } = req.body;
            let fotoUrl = req.body.fotoUrl || null;

            if (req.file) {
                fotoUrl = `/uploads/${req.file.filename}`;
            }

            try {
                const en_carrusel_value = showInCarousel === '1' ? 1 : 0;
                await getPool().query`INSERT INTO Personal (nombre, correo, extension, puesto, departamento, descripcion, fotoUrl, en_carrusel, fecha_nacimiento) VALUES (${nombre}, ${correo}, ${extension}, ${puesto}, ${departamento}, ${descripcion}, ${fotoUrl}, ${en_carrusel_value}, ${fecha_nacimiento || null})`;
                io.emit('staffUpdate'); // Notifica a los clientes conectados sobre el cambio
                res.status(201).json({ message: 'Miembro del personal creado exitosamente.' });
            } catch (err) {
                logger.error('Error creando miembro del personal:', err);
                res.status(500).json({ message: 'Error interno del servidor al crear miembro del personal.' });
            }
        });

        /**
         * PUT /api/personal/:id
         * Actualiza un miembro del personal existente (requiere rol de admin).
         */
        app.put('/api/personal/:id', authenticateToken, authorizeAdmin, upload.single('photo'), validate(personalUpdateSchema), async (req, res) => {
            const { id } = req.params;
            const updates = req.body;

            try {
                // 1. Obtener el registro actual de la base de datos
                const result = await getPool().query`SELECT * FROM Personal WHERE id = ${id}`;
                const currentData = result.recordset[0];

                if (!currentData) {
                    return res.status(404).json({ message: 'Miembro del personal no encontrado.' });
                }

                // 2. Manejar la URL de la foto
                let fotoUrl;
                if (req.file) {
                    // Si se sube un nuevo archivo, se usa esa URL
                    fotoUrl = `/uploads/${req.file.filename}`;
                    // Y se borra la foto antigua si existía
                    if (currentData.FotoUrl && fs.existsSync(path.join(uploadsDir, path.basename(currentData.FotoUrl)))) {
                        fs.unlink(path.join(uploadsDir, path.basename(currentData.FotoUrl)), (err) => {
                            if (err) logger.error("Error al borrar la foto antigua:", err);
                        });
                    }
                } else if (updates.fotoUrl !== undefined) {
                    // Si se proporciona 'fotoUrl' en el body (puede ser una nueva URL o null para borrarla)
                    fotoUrl = updates.fotoUrl;
                } else {
                    // Si no se proporciona ni archivo ni 'fotoUrl', mantener la foto actual
                    fotoUrl = currentData.FotoUrl;
                }

                // 3. Fusionar los datos, dando prioridad a los nuevos valores solo si fueron proporcionados
                const en_carrusel_value = updates.showInCarousel !== undefined 
                    ? (updates.showInCarousel === '1' ? 1 : 0) 
                    : currentData.en_carrusel;

                const fecha_nacimiento_value = updates.fecha_nacimiento !== undefined 
                    ? (updates.fecha_nacimiento || null) 
                    : currentData.fecha_nacimiento;

                // 4. Ejecutar el UPDATE con los datos fusionados
                await getPool().query`UPDATE Personal SET 
                    nombre = ${updates.nombre !== undefined ? updates.nombre : currentData.Nombre}, 
                    correo = ${updates.correo !== undefined ? updates.correo : currentData.Correo}, 
                    extension = ${updates.extension !== undefined ? updates.extension : currentData.Extension}, 
                    puesto = ${updates.puesto !== undefined ? updates.puesto : currentData.Puesto}, 
                    departamento = ${updates.departamento !== undefined ? updates.departamento : currentData.Departamento}, 
                    descripcion = ${updates.descripcion !== undefined ? updates.descripcion : currentData.Descripcion}, 
                    fotoUrl = ${fotoUrl}, 
                    en_carrusel = ${en_carrusel_value}, 
                    fecha_nacimiento = ${fecha_nacimiento_value} 
                    WHERE id = ${id}`;
                    
                io.emit('staffUpdate'); // Notifica a los clientes conectados
                res.json({ message: 'Miembro del personal actualizado exitosamente.' });
            } catch (err) {
                logger.error('Error actualizando miembro del personal:', err);
                res.status(500).json({ message: 'Error interno del servidor al actualizar miembro del personal.' });
            }
        });

        /**
         * DELETE /api/personal/:id
         * Elimina un miembro del personal (requiere rol de admin).
         */
        app.delete('/api/personal/:id', authenticateToken, authorizeAdmin, async (req, res) => {
            const { id } = req.params;
            try {
                await getPool().query`DELETE FROM Personal WHERE id = ${id}`;
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
        app.post('/api/personal/bulk-upload', authenticateToken, authorizeAdmin, uploadBulk.single('csvFile'), async (req, res) => {
            if (!req.file) {
                return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
            }

            const filePath = req.file.path;
            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '');

                if (lines.length <= 1) { // Solo cabeceras o vacío
                    fs.unlinkSync(filePath);
                    return res.status(400).json({ message: 'El archivo CSV está vacío o solo contiene cabeceras.' });
                }

                const headers = lines[0].split(',').map(header => header.trim());
                let successfulInserts = 0;
                let failedInserts = 0;

                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(',').map(value => {
                        const trimmedValue = value.trim();
                        // Sanitize values to prevent CSV injection
                        if ([ '=', '+', '-', '@' ].includes(trimmedValue.charAt(0))) {
                            return "'" + trimmedValue;
                        }
                        return trimmedValue;
                    });

                    if (values.length !== headers.length) {
                        logger.warn(`Omitiendo fila mal formada: ${lines[i]}`);
                        failedInserts++;
                        continue;
                    }
                    const record = headers.reduce((obj, header, index) => {
                        obj[header] = values[index] || null;
                        return obj;
                    }, {});

                    try {
                        const { nombre, correo, extension, puesto, departamento, descripcion, fotoUrl, en_carrusel, fecha_nacimiento } = record;
                        await getPool().query`INSERT INTO Personal (nombre, correo, extension, puesto, departamento, fotoUrl, descripcion, en_carrusel, fecha_nacimiento) VALUES (${nombre}, ${correo}, ${extension}, ${puesto}, ${departamento}, ${fotoUrl}, ${descripcion}, ${en_carrusel || 0}, ${fecha_nacimiento || null})`;
                        successfulInserts++;
                    } catch (err) {
                        logger.error('Error insertando registro:', record, err);
                        failedInserts++;
                    }
                }

                fs.unlinkSync(filePath); // Limpia el archivo subido
                io.emit('staffUpdate');
                res.status(200).json({ message: `Carga masiva completada. ${successfulInserts} registros insertados, ${failedInserts} fallidos.` });

            } catch (err) {
                logger.error('Error durante la carga masiva:', err);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
                res.status(500).json({ message: 'Error interno del servidor al procesar el archivo CSV.' });
            }
        });

        /**
         * GET /api/personal/template
         * Descarga una plantilla CSV para la carga masiva.
         */
        app.get('/api/personal/template', authenticateToken, authorizeAdmin, (req, res) => {
            const headers = "nombre,correo,extension,puesto,departamento,descripcion,fotoUrl";
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="plantilla_personal.csv"');
            res.status(200).send(headers);
        });


        // --- RUTAS DE GESTIÓN DE USUARIOS (protegidas) ---

        /**
         * GET /api/users
         * Obtiene la lista de usuarios (requiere rol de admin).
         */
        app.get('/api/users', authenticateToken, authorizeAdmin, async (req, res) => {
            try {
                const result = await getPool().query`SELECT id, username, role FROM Users`;
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
        app.delete('/api/users/:id', authenticateToken, authorizeAdmin, async (req, res) => {
            const { id } = req.params;
            const adminUserId = req.user.id;

            if (parseInt(id, 10) === adminUserId) {
                return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta de administrador.' });
            }

            try {
                const result = await getPool().query`DELETE FROM Users WHERE id = ${id}`;
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


        // --- RUTAS DE GESTIÓN DE DEPARTAMENTOS (protegidas) ---

        /**
         * GET /api/departments
         * Obtiene la lista de todos los departamentos.
         */
        app.get('/api/departments', authenticateToken, authorizeAdmin, async (req, res) => {
            try {
                const result = await getPool().query`SELECT id, name FROM Departments ORDER BY name`;
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
        app.post('/api/departments', authenticateToken, authorizeAdmin, async (req, res) => {
            const { name } = req.body;
            if (!name) {
                return res.status(400).json({ message: 'El nombre del departamento es requerido.' });
            }
            try {
                await getPool().query`INSERT INTO Departments (name) VALUES (${name})`;
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
        app.delete('/api/departments/:id', authenticateToken, authorizeAdmin, async (req, res) => {
            const { id } = req.params;
            try {
                // Verificar si algún miembro del personal está asignado a este departamento
                const staffCheck = await getPool().query`SELECT COUNT(*) as count FROM Personal WHERE Departamento = (SELECT name FROM Departments WHERE id = ${id})`;
                if (staffCheck.recordset[0].count > 0) {
                    return res.status(400).json({ message: 'No se puede eliminar el departamento porque tiene personal asignado.' });
                }

                const result = await getPool().query`DELETE FROM Departments WHERE id = ${id}`;
                if (result.rowsAffected[0] > 0) {
                    res.json({ message: 'Departamento eliminado exitosamente.' });
                } else {
                    res.status(404).json({ message: 'Departamento no encontrado.' });
                }
            } catch (err) {
                logger.error('Error eliminando departamento:', err);
                res.status(500).json({ message: 'Error interno del servidor al eliminar el departamento.' });
            }
        });


        // --- RUTAS DE GESTIÓN DE INFORMACIÓN IMPORTANTE (protegidas) ---

        /**
         * GET /api/important-info
         * Obtiene toda la información importante (requiere autenticación y rol de admin).
         */
        app.get('/api/important-info', authenticateToken, authorizeAdmin, async (req, res) => {
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
        app.post('/api/important-info', authenticateToken, authorizeAdmin, async (req, res) => {
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
        app.put('/api/important-info/:id', authenticateToken, authorizeAdmin, async (req, res) => {
            const { id } = req.params;
            const { title, content, extension } = req.body;
            if (!title) {
                return res.status(400).json({ message: 'El título es requerido.' });
            }
            try {
                const updated = await updateImportantInfo(parseInt(id), title, content, extension);
                if (updated) {
                    io.emit('importantInfoUpdate'); // Notifica a los clientes conectados
                    res.json({ message: 'Información importante actualizada exitosamente.' });
                } else {
                    res.status(404).json({ message: 'Información importante no encontrada.' });
                }
            } catch (err) {
                logger.error('Error al actualizar información importante:', err);
                res.status(500).json({ message: 'Error al actualizar información importante.' });
            }
        });

        /**
         * DELETE /api/important-info/:id
         * Elimina información importante (requiere autenticación y rol de admin).
         */
        app.delete('/api/important-info/:id', authenticateToken, authorizeAdmin, async (req, res) => {
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
        app.post('/api/theme', authenticateToken, authorizeAdmin, (req, res) => {
            const { theme } = req.body;
            if (['default', 'sunny', 'rainy', 'cloudy', 'light', 'dark'].includes(theme)) {
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
    })();
}

// Manejo de cierre de la aplicación para cerrar la conexión a la base de datos
process.on('SIGINT', async () => {
    logger.info('SIGINT recibido. Cerrando servidor y conexión a la base de datos...');
    await close();
    server.close(() => {
        logger.info('Servidor HTTP cerrado.');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    logger.info('SIGTERM recibido. Cerrando servidor y conexión a la base de datos...');
    await close();
    server.close(() => {
        logger.info('Servidor HTTP cerrado.');
        process.exit(0);
    });
});

// Exporta la app y el servidor para poder usarlos en las pruebas
module.exports = { app, server, io };
