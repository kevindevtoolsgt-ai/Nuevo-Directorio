/**
 * snow.js
 * Lógica para crear un efecto de nieve en la página.
 * Se activa o desactiva según los eventos de Socket.IO.
 */

const snowContainer = document.createElement('div');
snowContainer.id = 'snow-container';
document.body.appendChild(snowContainer);

let isSnowing = false;
let lastSnowflakeTime = 0;

function createSnowflake() {
    const snowflake = document.createElement('div');
    snowflake.classList.add('snowflake');

    // --- Lógica mejorada para más variedad ---
    const randomType = Math.random();
    let animationClass = 'anim-straight';
    let duration = Math.random() * 5 + 8; // Duración entre 8 y 13 segundos
    let size = Math.random() * 3 + 3; // Tamaño entre 3px y 6px

    if (randomType > 0.66) {
        // Copos con balanceo (más grandes)
        animationClass = 'anim-sway';
    } else if (randomType > 0.33) {
        // Copos rápidos (más pequeños, para efecto de profundidad)
        animationClass = 'anim-fast';
        duration = Math.random() * 4 + 4; // Duración entre 4 y 8 segundos
        size = Math.random() * 2 + 1; // Tamaño entre 1px y 3px
    }
    // El resto (0 a 0.33) usará la animación recta por defecto.

    snowflake.classList.add(animationClass);
    snowflake.style.left = `${Math.random() * 100}vw`;
    snowflake.style.animationDuration = `${duration}s`;
    snowflake.style.width = `${size}px`;
    snowflake.style.height = `${size}px`;
    snowflake.style.opacity = Math.random();

    snowContainer.appendChild(snowflake);

    // Eliminar el copo de nieve después de que termine la animación para no sobrecargar el DOM
    setTimeout(() => snowflake.remove(), duration * 1000);
}

/**
 * Bucle de animación para crear copos de nieve.
 */
function snowLoop(timestamp) {
    if (!isSnowing) return;

    if (timestamp - lastSnowflakeTime > 150) { // Crear un copo más frecuentemente (cada 150ms)
        createSnowflake();
        lastSnowflakeTime = timestamp;
    }

    requestAnimationFrame(snowLoop);
}

/**
 * Inicia el efecto de nieve, creando copos a intervalos regulares.
 */
function startSnowEffect() {
    if (isSnowing) return;
    console.log('Activando efecto de nieve...');
    snowContainer.style.display = 'block';
    isSnowing = true;
    requestAnimationFrame(snowLoop);
}

/**
 * Detiene el efecto de nieve y limpia los copos existentes.
 */
function stopSnowEffect() {
    if (!isSnowing) return;
    console.log('Desactivando efecto de nieve...');
    isSnowing = false;
    snowContainer.innerHTML = ''; // Limpiar todos los copos
    snowContainer.style.display = 'none';
}

// Exportar las funciones para que puedan ser usadas en el script principal (script.js)
// Si estás usando módulos ES6 en tu script público, esta es la forma.
// Si no, puedes simplemente incluir este script antes de tu script principal y las funciones estarán disponibles globalmente.
export { startSnowEffect, stopSnowEffect };