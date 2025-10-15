// Importar Joi, una biblioteca para la validación de esquemas de datos.
const Joi = require('joi');

/**
 * Esquema de validación para el registro de nuevos usuarios.
 * - username: Debe ser alfanumérico, entre 3 y 30 caracteres, y es requerido.
 * - password: Debe seguir un patrón simple de letras y números, y es requerido.
 */
const registerSchema = Joi.object({ // Se quita .strict() para permitir el campo 'role'
    username: Joi.string().alphanum().min(3).max(30).required(),
    password: Joi.string()
        .min(8)
        .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$'))
        .required()
        .messages({
            'string.pattern.base': 'La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula, un número y un símbolo.'
        }),
    role: Joi.string().valid('admin', 'user', 'staff_manager').required(),
});

/**
 * Esquema de validación para el login de usuarios.
 * - username: Es requerido.
 * - password: Es requerido.
 */
const loginSchema = Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required(),
});

/**
 * Esquema de validación para la creación de un nuevo miembro del personal.
 * - nombre: Requerido.
 * - correo: Requerido y debe ser un formato de email válido.
 * - Los demás campos son opcionales y pueden ser nulos o una cadena vacía.
 *   .allow(null, '') se usa para campos que no son estrictamente requeridos en el formulario.
 */
const personalSchema = Joi.object({
    nombre: Joi.string().required(),
    correo: Joi.string().email().required(),
    puesto_id: Joi.number().integer().allow(null, '').optional(), // puesto_id es opcional en el form
    descripcion: Joi.string().allow(null, ''),
    fotoUrl: Joi.string().uri({ allowRelative: true }).allow(null, ''),
    showInCarousel: Joi.string().valid('0', '1').optional(), // Acepta '0' o '1'
    fecha_nacimiento: Joi.string().allow(null, '').optional(),
    personal_extension_id: Joi.number().integer().allow(null, '').optional(),
});

/**
 * Esquema de validación para la actualización de un miembro del personal.
 * Es similar a `personalSchema`, pero todos los campos son opcionales,
 * permitiendo actualizaciones parciales.
 */
const personalUpdateSchema = Joi.object({
    nombre: Joi.string().allow(null, ''),
    correo: Joi.string().email().allow(null, ''),
    puesto_id: Joi.number().integer().allow(null, '').optional(),
    descripcion: Joi.string().allow(null, ''),
    fotoUrl: Joi.string().uri({ allowRelative: true }).allow(null, ''),
    showInCarousel: Joi.string().valid('0', '1').optional(),
    fecha_nacimiento: Joi.string().allow(null, '').optional()
}).unknown(true); // Permite otros campos (como personal_extension_id) pero no los valida.

/**
 * Middleware de validación de alto nivel.
 * Es una función que recibe un esquema de Joi y devuelve un middleware de Express.
 * Este middleware valida el `req.body` de la petición contra el esquema proporcionado.
 * @param {Joi.Schema} schema - El esquema de Joi a validar.
 * @returns {function} Un middleware de Express.
 */
const validate = (schema) => (req, res, next) => {
    let body = req.body;

    // Si la petición es multipart/form-data, excluimos el campo 'photo' que maneja multer.
    if (req.is('multipart/form-data')) {
        const { photo, ...rest } = req.body;
        body = rest;
    }
    const { error } = schema.validate(body);

    if (error) {
        // Si hay un error de validación, se envía una respuesta 400 con el detalle.
        return res.status(400).json({ message: error.details[0].message });
    }
    
    // Si la validación es exitosa, se pasa al siguiente middleware.
    next();
};

/**
 * Middleware de validación específico para cuerpos de petición JSON.
 * Valida el `req.body` directamente sin manejar multipart/form-data.
 * @param {Joi.Schema} schema - El esquema de Joi a validar.
 * @returns {function} Un middleware de Express.
 */
const validateJson = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body);

    if (error) {
        // Si hay un error de validación, se envía una respuesta 400 con el detalle.
        return res.status(400).json({ message: error.details[0].message });
    }
    
    // Si la validación es exitosa, se pasa al siguiente middleware.
    next();
};

// Exporta el middleware y los esquemas para ser usados en otras partes de la aplicación (ej. server.js).
module.exports = {
    validate,
    validateJson,
    registerSchema,
    loginSchema,
    personalSchema,
    personalUpdateSchema,
};