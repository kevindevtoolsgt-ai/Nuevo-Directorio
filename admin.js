/**
 * admin.js (v4.8 - Debugging Animations)
 *
 * Lógica para el panel de administración. Animaciones desactivadas para depuración.
 */
document.addEventListener('DOMContentLoaded', () => {

    // Helper para escapar HTML
    const escapeHTML = (str) => {
        if (typeof str !== 'string') return str;
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    };

    // --- CONSTANTES Y ELEMENTOS DEL DOM ---
    const BASE_URL = 'http://localhost:8080';
    const API_URLS = {
        PERSONAL: `${BASE_URL}/api/personal`,
        DEPARTMENTS: `${BASE_URL}/api/departments`,
        USERS: `${BASE_URL}/api/users`,
        LOGIN: `${BASE_URL}/api/login`,
        LOGOUT: `${BASE_URL}/api/logout`,
        THEME: `${BASE_URL}/api/theme`,
        IMPORTANT_INFO: `${BASE_URL}/api/important-info`,
        REFRESH_TOKEN: `${BASE_URL}/api/refresh-token`
    };

    const authContainer = document.getElementById('auth-container');
    const adminDashboard = document.getElementById('admin-dashboard');
    const directoryGrid = document.getElementById('directory-grid');
    const userListGrid = document.getElementById('user-list-grid');
    const departmentListDiv = document.getElementById('department-list');
    const importantInfoListDiv = document.getElementById('important-info-list');
    const contentSections = document.querySelectorAll('.content-section');
    const navLinks = document.querySelectorAll('#sidebar .nav-link');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const staffForm = document.getElementById('staff-form');
    const importantInfoForm = document.getElementById('important-info-form');
    const staffModal = new bootstrap.Modal(document.getElementById('staff-modal'));
    const logoutBtn = document.getElementById('logout-btn');


    // --- ESTADO DE LA APLICACIÓN ---
    let staffData = [];
    let importantInfoData = [];
    let tokenRefreshInterval = null;

    // --- MANEJO DE ERRORES Y API ---

    const handleApiError = (error, context) => {
        const errorMessage = error.message || 'Ocurrió un error inesperado.';
        console.error(`Error al ${context}: ${errorMessage}`);
    };

    const apiFetch = async (url, options = {}) => {
        try {
            const headers = { ...options.headers };

            if (!(options.body instanceof FormData)) {
                headers['Content-Type'] = 'application/json';
            }

            const response = await fetch(url, { ...options, headers, credentials: 'include' });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    showLoginPage();
                    throw new Error('Sesión expirada o no autorizada.');
                }
                const errorData = await response.json().catch(() => null);
                throw new Error(errorData?.message || `El servidor respondió con un error ${response.status}.`);
            }
            return response;
        } catch (error) {
            throw error;
        }
    };

    // --- NAVEGACIÓN ---

    const showSection = (sectionId) => {
        contentSections.forEach(section => {
            section.style.display = section.id === sectionId ? 'block' : 'none';
        });
        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${sectionId.replace('-section', '')}`);
        });
    };

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = link.id.replace('nav-', '') + '-section';
            showSection(sectionId);
        });
    });


    // --- AUTENTICACIÓN Y REFRESCÓ DE TOKEN ---

    const stopTokenRefresh = () => {
        if (tokenRefreshInterval) {
            clearInterval(tokenRefreshInterval);
            tokenRefreshInterval = null;
        }
    };

    const refreshToken = async () => {
        try {
            await apiFetch(API_URLS.REFRESH_TOKEN, { method: 'POST' });
            console.log('Token de sesión refrescado exitosamente.');
        } catch (error) {
            console.error('Falló el refresco del token, se cerrará la sesión:', error.message);
            logout();
        }
    };

    const startTokenRefresh = () => {
        stopTokenRefresh();
        const fourteenMinutes = 14 * 60 * 1000;
        tokenRefreshInterval = setInterval(refreshToken, fourteenMinutes);
    };

    const showLoginPage = () => {
        stopTokenRefresh();
        authContainer.style.display = 'block';
        adminDashboard.style.display = 'none';
    };

    const showDashboard = async (initialStaffData = null) => {
        authContainer.style.display = 'none';
        adminDashboard.style.display = 'flex';
        startTokenRefresh();
        showSection('manage-staff-section');

        if (initialStaffData) {
            staffData = initialStaffData;
            renderDirectory(staffData);
        } else {
            await fetchStaff();
        }
    };

    const logout = async () => {
        stopTokenRefresh();
        try {
            await apiFetch(API_URLS.LOGOUT, { method: 'POST' });
        } catch (error) {
            handleApiError(error, 'cerrar sesión');
        } finally {
            showLoginPage();
        }
    };

    const handleLoginFormSubmit = async (e) => {
        e.preventDefault();
        loginError.textContent = '';

        const username = loginForm.username.value;
        const password = loginForm.password.value;

        try {
            const response = await fetch(API_URLS.LOGIN, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Credenciales incorrectas o error del servidor.' }));
                throw new Error(errorData.message || 'Credenciales incorrectas.');
            }

            const loginResponse = await response.json();
            await showDashboard(loginResponse.staff);

        } catch (error) {
            loginError.textContent = `Error: ${error.message}`;
            console.error('Ocurrió un error en el bloque catch.', error);
        }
    };

    const checkAuth = async () => {
        try {
            const response = await apiFetch(API_URLS.PERSONAL);
            const initialStaffData = await response.json();
            await showDashboard(initialStaffData);
        } catch (error) {
            showLoginPage();
        }
    };

    // --- GESTIÓN DE PERSONAL ---

    const renderDirectory = (data) => {
        directoryGrid.innerHTML = '';
        if (!data || data.length === 0) {
            directoryGrid.innerHTML = '<p class="col-12 text-center">No hay personal para mostrar.</p>';
            return;
        }

        const gridHtml = data.map((person) => {
            const safeFotoUrl = person.FotoUrl ? `${BASE_URL}${person.FotoUrl}` : '';
            const photoHtml = safeFotoUrl
                ? `<img src="${safeFotoUrl}" alt="Foto de ${escapeHTML(person.Nombre)}" class="card-img-top">`
                : `<div class="staff-photo-placeholder d-flex align-items-center justify-content-center bg-light rounded-circle" style="width: 150px; height: 150px; object-fit: cover; margin: 1rem auto 0.5rem auto; border: 3px solid var(--primary-color); box-shadow: var(--shadow-sm);"></div>`;

            return `
                <div class="col">
                    <div class="card h-100 text-center" data-id="${person.ID}">
                        ${photoHtml}
                        <div class="card-body">
                            <h5 class="card-title">${escapeHTML(person.Nombre)}</h5>
                            <p class="card-text text-muted">${escapeHTML(person.Puesto)}</p>
                            <p class="card-text"><small class="text-muted">${escapeHTML(person.Departamento)}</small></p>
                        </div>
                        <div class="card-footer">
                            <button class="btn btn-sm btn-outline-primary edit-btn" data-id="${person.ID}">Editar</button>
                            <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${person.ID}">Eliminar</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        directoryGrid.innerHTML = gridHtml;

        /* --- ANIMACIONES DESACTIVADAS PARA DEBUGGING ---
        // Animación de entrada para las tarjetas
        anime({
            targets: '#directory-grid .col',
            translateY: [30, 0],
            opacity: [0, 1],
            scale: [0.95, 1],
            delay: anime.stagger(50, { start: 50 }),
            duration: 600,
            easing: 'easeOutCubic',
            begin: (anim) => {
                anim.animatables.forEach(({ target }) => {
                    target.style.willChange = 'transform, opacity';
                });
            },
            complete: (anim) => {
                anim.animatables.forEach(({ target }) => {
                    target.style.willChange = 'auto';
                    target.style.transform = 'scale(1)';
                });
            }
        });

        // Efectos de hover para las tarjetas
        document.querySelectorAll('#directory-grid .card').forEach(card => {
            card.addEventListener('mouseenter', () => {
                anime({
                    targets: card,
                    scale: 1.03,
                    duration: 200,
                    easing: 'easeOutQuad',
                    begin: () => {
                        card.style.willChange = 'transform';
                    }
                });
            });
            card.addEventListener('mouseleave', () => {
                anime({
                    targets: card,
                    scale: 1,
                    duration: 200,
                    easing: 'easeOutQuad',
                    complete: () => {
                        card.style.willChange = 'auto';
                    }
                });
            });
        });
        */
    };


    const fetchStaff = async () => {
        try {
            const response = await apiFetch(API_URLS.PERSONAL);
            staffData = await response.json();
            renderDirectory(staffData);
        } catch (error) {
            handleApiError(error, 'obtener el listado de personal');
        }
    };

    const handleStaffFormSubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('staff-id').value;
        const formData = new FormData(staffForm);
        formData.set('showInCarousel', document.getElementById('show-in-carousel').checked ? '1' : '0');

        const url = id ? `${API_URLS.PERSONAL}/${id}` : API_URLS.PERSONAL;
        const method = id ? 'PUT' : 'POST';

        if (id) {
            formData.delete('id');
        }

        const rawDate = formData.get('fecha_nacimiento');
        if (rawDate) {
            formData.set('fecha_nacimiento', rawDate);
        }

        try {
            await apiFetch(url, {
                method: method,
                body: formData,
            });
            staffModal.hide();
            await fetchStaff();
        } catch (error) {
            handleApiError(error, 'guardar los datos del personal');
            alert(`Error al guardar: ${error.message}`);
        }
    };

    directoryGrid.addEventListener('click', (e) => {
        const target = e.target;
        const card = target.closest('.card');
        if (!card) return;

        const staffId = card.dataset.id;

        if (target.classList.contains('edit-btn')) {
            const person = staffData.find(p => p.ID == staffId);
            if (person) {
                document.getElementById('staff-id').value = person.ID;
                document.getElementById('nombre').value = person.Nombre;
                document.getElementById('puesto').value = person.Puesto;
                document.getElementById('departamento').value = person.Departamento;
                document.getElementById('correo').value = person.Correo;
                document.getElementById('extension').value = person.Extension;
                document.getElementById('fecha_nacimiento').value = person.fecha_nacimiento ? new Date(person.fecha_nacimiento).toISOString().split('T')[0] : '';
                document.getElementById('descripcion').value = person.Descripcion;
                document.getElementById('show-in-carousel').checked = person.showInCarousel;
                
                staffModal.show();
            }
        }

        if (target.classList.contains('delete-btn')) {
            if (confirm('¿Estás seguro de que quieres eliminar a este miembro del personal?')) {
                deleteStaff(staffId);
            }
        }
    });

    const deleteStaff = async (id) => {
        try {
            await apiFetch(`${API_URLS.PERSONAL}/${id}`, { method: 'DELETE' });
            await fetchStaff();
        } catch (error) {
            handleApiError(error, 'eliminar miembro del personal');
            alert(`Error al eliminar: ${error.message}`);
        }
    };

    // --- INICIALIZACIÓN ---
    loginForm.addEventListener('submit', handleLoginFormSubmit);
    staffForm.addEventListener('submit', handleStaffFormSubmit);
    logoutBtn.addEventListener('click', logout);

    checkAuth();
});