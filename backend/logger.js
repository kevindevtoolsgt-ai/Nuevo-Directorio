const winston = require('winston');
const path = require('path');

// Directorio para los logs
const logDir = 'logs';
const filename = path.join(logDir, 'app.log');

// Asegura que el directorio de logs exista
const fs = require('fs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logger = winston.createLogger({
    // Nivel de log mínimo a registrar.
    // 'info': registrará info, warn, error.
    // 'debug': registrará todo.
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    
    // Formato del log
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }), // Para que los errores muestren el stack trace
        winston.format.splat(),
        winston.format.json() // Formato JSON para facilitar el análisis por máquinas
    ),

    // Dónde guardar los logs (transportes)
    transports: [
        // Guardar logs de nivel 'info' y superiores en `logs/app.log`
        new winston.transports.File({ 
            filename,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true,
        }),
    ],

    // Transporte para excepciones no capturadas
    exceptionHandlers: [
        new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') })
    ],

    // No salir del proceso después de loguear una excepción no capturada
    exitOnError: false, 
});

// Si no estamos en producción, también loguear a la consola con un formato más legible
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

module.exports = logger;