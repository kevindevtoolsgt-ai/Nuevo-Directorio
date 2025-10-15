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
    const BASE_URL = '';
    const API_URLS = {
        PERSONAL: `${BASE_URL}/api/personal`,
        DEPARTMENTS: `${BASE_URL}/api/departments`,
        USERS: `${BASE_URL}/api/users`,
        LOGIN: `${BASE_URL}/api/login`,
        REGISTER: `${BASE_URL}/api/register`,
        LOGIN_CHECK: `${BASE_URL}/api/login-check`, // <-- Añadir esta línea
        LOGOUT: `${BASE_URL}/api/logout`,
        THEME: `${BASE_URL}/api/theme`,
        PUESTOS: `${BASE_URL}/api/puestos`,
        EXTENSIONS: `${BASE_URL}/api/extensions`,
        EXTENSIONS_BULK: `${BASE_URL}/api/extensions/bulk-upload`,
        IMPORTANT_INFO: `${BASE_URL}/api/important-info`,
        REFRESH_TOKEN: `${BASE_URL}/api/refresh-token`
    };

    const authContainer = document.getElementById('auth-container');
    const adminDashboard = document.getElementById('admin-dashboard');
    const directoryGrid = document.getElementById('directory-grid');
    const userListGrid = document.getElementById('user-list-grid');
    const departmentListDiv = document.getElementById('department-list');
    const extensionListDiv = document.getElementById('extension-list');
    const puestoListDiv = document.getElementById('puesto-list');
    const importantInfoListDiv = document.getElementById('important-info-list');
    const contentSections = document.querySelectorAll('.content-section');
    const navLinks = document.querySelectorAll('#sidebar .nav-link');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const addUserForm = document.getElementById('add-user-form');
    const addExtensionForm = document.getElementById('add-extension-form');
    const addPuestoForm = document.getElementById('add-puesto-form');
    const staffForm = document.getElementById('staff-form');
    const importantInfoForm = document.getElementById('important-info-form');
    const staffModal = new bootstrap.Modal(document.getElementById('staff-modal'));
    const bulkUploadExtensionsForm = document.getElementById('bulk-upload-extensions-form');
    const bulkUploadForm = document.getElementById('bulk-upload-form');
    const themeSelect = document.getElementById('theme-select');
    const logoutBtn = document.getElementById('logout-btn');
    const cancelEditInfoBtn = document.getElementById('cancel-edit-info-btn');
    const searchInputAdmin = document.getElementById('searchInputAdmin');


    // --- ESTADO DE LA APLICACIÓN ---
    let staffData = [];
    let usersData = [];
    let extensionsData = [];
    let importantInfoData = [];
    let currentUserRole = null; // Variable para guardar el rol del usuario
    let tokenRefreshInterval = null;

    // --- MANEJO DE ERRORES Y API ---

    const handleApiError = (error, context) => {
        const errorMessage = error.message || 'Ocurrió un error inesperado.';
        // Mostramos el error en la consola para depuración, pero evitamos mostrar
        // un alert() genérico que pueda confundir al usuario, especialmente si
        // el error ocurre en una operación de fondo.
        // Los errores específicos (como en formularios) se manejarán en sus propios bloques catch.
        console.error(`Error en la operación de '${context}': ${errorMessage}`);
    };

    const apiFetch = async (url, options = {}) => {
        try {
            const headers = { ...options.headers };

            if (!(options.body instanceof FormData)) {
                headers['Content-Type'] = 'application/json';
            }

            const response = await fetch(url, { ...options, headers, credentials: 'include' });

            if (!response.ok) {
                // Si el token es inválido o no existe (401), sí cerramos sesión.
                if (response.status === 401) {
                    showLoginPage();
                    // Si es un error de permisos (403), dejamos que el error continúe
                    // para que la función que llama lo maneje (ej. mostrando un alert).
                    throw new Error('Sesión expirada o no autorizada.');
                }
                const errorData = await response.json().catch(() => ({ message: `Error del servidor con estado: ${response.status}` }));
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
            link.classList.toggle('active', link.id === `nav-${sectionId.replace('-section', '')}`);
        });

        if (sectionId === 'manage-departments-section') {
            fetchDepartments();
        } else if (sectionId === 'manage-extensions-section') {
            fetchExtensions();
            populateDepartmentDropdownForExtensions(); // Poblar el dropdown de departamentos para el form de extensiones
        } else if (sectionId === 'manage-puestos-section') {
            fetchPuestos();
            populatePuestoFormDropdowns();
        } else if (sectionId === 'manage-important-info-section') {
            fetchImportantInfo();
        } else if (sectionId === 'manage-users-section') {
            fetchUsers();
        }
    };

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = link.id.replace('nav-', '') + '-section'; // ej: 'nav-manage-staff' -> 'manage-staff-section'
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
        authContainer.classList.remove('d-none');
        adminDashboard.style.display = 'none';
        // Limpiar campos del formulario de login para una mejor experiencia de usuario
        loginForm.username.value = '';
        loginForm.password.value = '';
        if (loginError) loginError.textContent = '';
    };

    const showDashboard = async (initialData = null) => {
        authContainer.classList.add('d-none');
        adminDashboard.style.display = 'flex';
        startTokenRefresh();

        const setupUIForRole = (role) => {
            // Medida de seguridad: si el rol no es válido, no mostrar nada y cerrar sesión.
            if (!role || !['admin', 'staff_manager', 'user'].includes(role)) {
                console.error('Rol de usuario inválido o no definido. Cerrando sesión.');
                logout();
                return;
            }
            // Oculta o muestra las opciones de navegación según el rol del usuario.
            const navItems = {
                'nav-manage-staff': ['admin', 'staff_manager'],
                'nav-manage-users': ['admin'], // Solo los admins pueden ver esto
                'nav-manage-departments': ['admin'],
                'nav-manage-puestos': ['admin'],
                'nav-manage-extensions': ['admin'],
                'nav-bulk-upload': ['admin', 'staff_manager'],
                'nav-manage-important-info': ['admin'],
                'nav-appearance': ['admin']
            };

            for (const navId in navItems) {
                const element = document.getElementById(navId);
                if (element) {
                    const allowedRoles = navItems[navId];
                    element.style.display = allowedRoles.includes(role) ? 'block' : 'none';
                }
            }
        };

        setupUIForRole(currentUserRole);
        showSection('manage-staff-section');
        
        // Carga los datos iniciales necesarios para el rol del usuario.
        // Si initialData ya viene del login, lo usamos para evitar otra llamada a la API.
        const staffToRender = initialData?.staff;

        if (['admin', 'staff_manager'].includes(currentUserRole)) {
            if (staffToRender) {
                // Si los datos ya vinieron con el login/check, los usamos.
                staffData = staffToRender;
                filterStaff(); // Renderiza los datos inmediatamente.
            } else {
                // Si no, los pedimos a la API.
                await fetchStaff();
            }
        }

        if (currentUserRole === 'admin') {
            // Tareas adicionales solo para el admin.
            populateDepartmentDropdown();
            fetchImportantInfo();
        }
    };

    const filterStaff = () => {
        const searchTerm = searchInputAdmin.value.toLowerCase();
        const filtered = staffData.filter(person =>
            (person.nombre?.toLowerCase() || '').includes(searchTerm) ||
            (person.puesto?.toLowerCase() || '').includes(searchTerm) ||
            (person.departamento?.toLowerCase() || '').includes(searchTerm)
        );
        renderDirectory(filtered);
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
            const response = await apiFetch(API_URLS.LOGIN, {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            });

            const loginResponse = await response.json();
            currentUserRole = loginResponse.user?.role; // Guardar el rol del usuario

            // Pasamos los datos iniciales (staff) a showDashboard para que no tenga que volver a pedirlos.
            await showDashboard(loginResponse);

        } catch (error) {
            // apiFetch ya maneja los errores de red y de status. Aquí solo mostramos el mensaje.
            loginError.textContent = `Error: ${error.message}`;
            console.error('Ocurrió un error en el bloque catch.', error);
        }
    };

    const checkAuth = async () => {
        try {
            // Al recargar, el backend nos dará los datos si la cookie es válida.
            const response = await apiFetch(API_URLS.LOGIN_CHECK); // Necesitamos una ruta que devuelva el rol
            const authData = await response.json();
            currentUserRole = authData.user.role;
            await showDashboard(authData); // Pasamos el objeto completo
        } catch (error) {
            showLoginPage();
        }
    };

    // --- GESTIÓN DE PERSONAL ---

    const fetchStaff = async () => {
        try {
            const response = await apiFetch(API_URLS.PERSONAL);
            staffData = await response.json();
            filterStaff(); // Aplicar filtro inicial (si hay texto en la barra)
        } catch (error) {
            handleApiError(error, 'obtener el listado de personal');
        }
    };

    const renderDirectory = (data) => {
        directoryGrid.innerHTML = '';
        if (!data || data.length === 0) {
            directoryGrid.innerHTML = '<p class="col-12 text-center">No hay personal para mostrar.</p>';
            return;
        }

        const gridHtml = data.map((person) => {
            const safeFotoUrl = person.fotoUrl ? `${BASE_URL}${person.fotoUrl}` : '';
            const photoHtml = safeFotoUrl
                ? `<img src="${safeFotoUrl}" alt="Foto de ${escapeHTML(person.nombre)}" class="card-img-top">`
                : `<div class="staff-photo-placeholder d-flex align-items-center justify-content-center bg-light rounded-circle" style="width: 150px; height: 150px; object-fit: cover; margin: 1rem auto 0.5rem auto; border: 3px solid var(--primary-color); box-shadow: var(--shadow-sm);"></div>`;

            return `
                <div class="col">
                    <div class="card h-100 text-center" data-id="${person.id}">
                        ${photoHtml}
                        <div class="card-body">
                            <h5 class="card-title">${escapeHTML(person.nombre)}</h5>
                            <p class="card-text text-muted">${escapeHTML(person.puesto)}</p>
                            <p class="card-text"><small class="text-muted">${escapeHTML(person.departamento)}</small></p>
                        </div>
                        <div class="card-footer">
                            <button class="btn btn-sm btn-outline-primary edit-btn" data-id="${person.id}">Editar</button>
                            <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${person.id}">Eliminar</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        directoryGrid.innerHTML = gridHtml;

    };

    const handleStaffFormSubmit = async (e) => {
        e.preventDefault();
        const errorDiv = document.getElementById('staff-form-error');
        errorDiv.style.display = 'none'; // Ocultar errores previos

        const id = document.getElementById('staff-id').value;
        const formData = new FormData(staffForm);
        formData.set('showInCarousel', document.getElementById('show-in-carousel').checked ? '1' : '0');
 
        const url = id ? `${API_URLS.PERSONAL}/${id}` : API_URLS.PERSONAL;
        const method = id ? 'PUT' : 'POST';
 
        // El ID se pasa por la URL, no debe ir en el cuerpo de la petición. Lo eliminamos.
        formData.delete('id');
        // La URL de la foto tampoco debe ir en el FormData, ya que se maneja por separado.
        formData.delete('fotoUrl');
        // La extensión personal se maneja en una llamada separada, la eliminamos del formulario principal.
        formData.delete('personal_extension_id');
 
        // Si la fecha de nacimiento está vacía, la eliminamos del FormData para que el backend no intente procesar una cadena vacía.
        const rawDate = formData.get('fecha_nacimiento');
        if (!rawDate) {
            formData.delete('fecha_nacimiento');
        }
 
        // --- MANEJO DE LA EXTENSIÓN INDIVIDUAL ---
        if (id) {
            // Para EDITAR, la extensión individual se maneja en una llamada a la API separada para mayor claridad y atomicidad.
            const personalExtensionId = document.getElementById('personal_extension_id').value || null;
            try {
                await apiFetch(`${API_URLS.PERSONAL}/${id}/extension`, {
                    method: 'PUT',
                    body: JSON.stringify({ extension_id: personalExtensionId })
                });
            } catch (error) {
                errorDiv.textContent = `Error al asignar extensión: ${error.message}`;
                errorDiv.style.display = 'block';
                return; // Detener la ejecución si la extensión falla
            }
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
            // Mostrar el error específico dentro del modal.
            errorDiv.textContent = error.message;
            errorDiv.style.display = 'block';
        }
    };

    directoryGrid.addEventListener('click', (e) => {
        const target = e.target;
        const card = target.closest('.card');
        if (!card) return;

        const staffId = card.dataset.id;

        if (target.classList.contains('edit-btn')) {
            const person = staffData.find(p => p.id == staffId);
            if (person) {
                staffForm.reset(); // Limpiar el formulario antes de llenarlo
                document.getElementById('staffModalLabel').textContent = 'Editar Personal'; // Cambiar título

                document.getElementById('staff-id').value = person.id || '';
                document.getElementById('nombre').value = person.nombre || '';
                document.getElementById('correo').value = person.correo || '';
                // --- CORRECCIÓN ---
                // Llenar y seleccionar los dropdowns de puestos y extensiones.
                populatePuestosDropdown(person.puesto_id);
                populatePersonalExtensionDropdown(person.id, person.puesto_id); // Se necesita el puesto para derivar el departamento
                // Corregir formato de fecha para el input type="date"
                document.getElementById('fecha_nacimiento').value = person.fecha_nacimiento ? new Date(person.fecha_nacimiento).toISOString().split('T')[0] : '';
                document.getElementById('descripcion').value = person.descripcion || '';
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

    const populatePersonalExtensionDropdown = async (personalId = null, currentPuestoId = null) => {
        const extensionSelect = document.getElementById('personal_extension_id');
        if (!extensionSelect) return;

        try {
            const [extensionsRes, allPuestosRes] = await Promise.all([
                apiFetch(API_URLS.EXTENSIONS),
                apiFetch(API_URLS.PUESTOS) // Obtenemos todos los puestos para encontrar el departamento
            ]);
            const extensions = await extensionsRes.json();
            const allPuestos = await allPuestosRes.json();

            // Encontrar el departamento de la persona a través de su puesto actual
            const currentPuesto = allPuestos.find(p => p.id === currentPuestoId);
            const departmentId = currentPuesto ? currentPuesto.department_id : null;

            // La extensión de la persona puede venir de una asignación directa o de su puesto
            // Para este dropdown, solo nos interesa la asignación directa.
            const currentPersonalExtension = personalId ? extensions.find(ext => ext.personal_id === personalId) : null;
 
            extensionSelect.innerHTML = '<option value="">Sin Extensión Individual</option>';
 
            extensions.forEach(ext => {
                // --- LÓGICA DE FILTRADO MEJORADA ---
                // Una extensión es elegible si cumple estas condiciones:
                const isAssignedToPuesto = ext.puesto_id !== null;
                const isCurrentlyAssignedToThisPerson = currentPersonalExtension && ext.id === currentPersonalExtension.id;
                // 1. La extensión pertenece al mismo departamento que el puesto de la persona, O no tiene departamento asignado (es global).
                const belongsToCorrectDepartment = departmentId ? (ext.department_id === departmentId || ext.department_id === null) : true;
                // 2. No está asignada a OTRO puesto.
                // 3. O es la extensión que la persona actual ya tiene (para que no desaparezca de la lista al editar).
 
                if ((!isAssignedToPuesto && belongsToCorrectDepartment) || isCurrentlyAssignedToThisPerson) {
                    const option = document.createElement('option');
                    option.value = ext.id;
                    option.textContent = `${escapeHTML(ext.number)} (${ext.department_name || 'Global'}) ${ext.personal_name ? ` - Ocupada por: ${escapeHTML(ext.personal_name)}` : ''}`;
                    extensionSelect.appendChild(option);
                }
            });
            // Seleccionar la extensión actual de la persona, si tiene una.
            if (currentPersonalExtension) extensionSelect.value = currentPersonalExtension.id;
        } catch (error) {
            handleApiError(error, 'cargar el selector de extensiones personales');
        }
    };

    const populatePuestosDropdown = async (selectedPuestoId = null) => {
        try {
            const response = await apiFetch(API_URLS.PUESTOS);
            const puestos = await response.json();
            const puestoSelect = document.getElementById('puesto_id');
            puestoSelect.innerHTML = '<option value="">Seleccione un puesto...</option>';

            // Ahora simplemente listamos todos los puestos, ya que una persona no "bloquea" un puesto.
            puestos.forEach(puesto => {
                const option = document.createElement('option');
                option.value = puesto.id;
                option.textContent = `${puesto.name} (${puesto.department_name})`;
                puestoSelect.appendChild(option);
            });

            if (selectedPuestoId) puestoSelect.value = selectedPuestoId;
        } catch (error) {
            handleApiError(error, 'cargar el selector de puestos');
        }
    };
    const populateDepartmentDropdown = async () => {
        try {
            const response = await apiFetch(API_URLS.DEPARTMENTS);
            const departments = await response.json();
            const departmentSelect = document.getElementById('puesto-department');
            departmentSelect.innerHTML = '<option value="">Seleccione un departamento...</option>'; // Opción por defecto

            if (departments && departments.length > 0) {
                departments.forEach(dep => {
                    const option = document.createElement('option');
                    option.value = dep.id;   // Corrección: Usar siempre el ID como valor
                    option.textContent = escapeHTML(dep.name);
                    departmentSelect.appendChild(option);
                });
            }
        } catch (error) {
            handleApiError(error, 'cargar el selector de departamentos');
            // Opcional: Deshabilitar el selector si falla la carga
            document.getElementById('puesto-department').disabled = true;
        }
    };

    const populatePuestoExtensionsDropdown = (departmentId = null) => {
        const extSelect = document.getElementById('puesto-extension');
        extSelect.innerHTML = '<option value="">Sin Extensión</option>';
        
        // Usamos los datos de extensiones ya cargados en `extensionsData`
        if (!extensionsData) return;

        extensionsData.forEach(ext => {
            // Primero, verificamos si la extensión pertenece al departamento seleccionado (o si es global).
            const belongsToDepartment = departmentId ? (ext.department_id == departmentId || ext.department_id === null) : true;

            // Solo si pertenece al departamento, la procesamos.
            if (belongsToDepartment) {
                const option = document.createElement('option');
                option.value = ext.id;

                const departmentName = ext.department_name || 'Global';
                // Si la extensión está ocupada, la deshabilitamos y mostramos por quién.
                if (ext.is_occupied) {
                    option.disabled = true;
                    const occupier = ext.puesto_name || ext.personal_name;
                    option.textContent = `${escapeHTML(ext.number)} (${escapeHTML(departmentName)}) - Ocupada por: ${escapeHTML(occupier)}`;
                } else {
                    option.textContent = `${escapeHTML(ext.number)} (${escapeHTML(departmentName)}) - Disponible`;
                }
                extSelect.appendChild(option);
            }
        });
    };

    const populatePuestoFormDropdowns = async () => {
        try {
            // Ahora cargamos tanto departamentos como extensiones para asegurar que los datos estén listos.
            const [departmentsRes, extensionsRes] = await Promise.all([
                apiFetch(API_URLS.DEPARTMENTS),
                apiFetch(API_URLS.EXTENSIONS) // Aseguramos que extensionsData se cargue aquí.
            ]);
            const departments = await departmentsRes.json();
            extensionsData = await extensionsRes.json(); // Guardamos los datos de extensiones.
            
            const deptoSelect = document.getElementById('puesto-department');
            deptoSelect.innerHTML = '<option value="">Seleccione un departamento...</option>';
            departments.forEach(dep => {
                const option = document.createElement('option');
                option.value = dep.id;
                option.textContent = escapeHTML(dep.name);
                deptoSelect.appendChild(option);
            });
            
            // Llenar las extensiones inicialmente (sin filtro de departamento)
            populatePuestoExtensionsDropdown();

        } catch (error) {
            handleApiError(error, 'cargar desplegables para formulario de puestos');
        }
    };
    // --- GESTIÓN DE PUESTOS ---

    const renderPuestos = (puestos) => {
        puestoListDiv.innerHTML = '';
        if (!puestos || puestos.length === 0) {
            puestoListDiv.innerHTML = '<p>No hay puestos para mostrar.</p>';
            return;
        }
        const listHtml = puestos.map(p => `
            <div class="d-flex justify-content-between align-items-center p-2 border-bottom">
                <div>
                    <strong>${escapeHTML(p.name)}</strong> (${escapeHTML(p.department_name)})
                    <small class="text-muted ms-2">
                        Ext: ${p.extension_number || 'N/A'} | 
                        Ocupado por: ${p.personal_name ? `<strong>${escapeHTML(p.personal_name)}</strong>` : 'Nadie'}
                    </small>
                </div>
                <button class="btn btn-sm btn-outline-danger delete-puesto-btn" data-id="${p.id}" ${p.personal_name ? 'disabled' : ''}>Eliminar</button>
            </div>
        `).join('');
        puestoListDiv.innerHTML = listHtml;
    };

    const fetchPuestos = async () => {
        try {
            const response = await apiFetch(API_URLS.PUESTOS);
            const puestos = await response.json();
            renderPuestos(puestos);
        } catch (error) {
            handleApiError(error, 'obtener los puestos');
        }
    };

    addPuestoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('puesto-name').value.trim();
        const department_id = document.getElementById('puesto-department').value;
        const extension_id = document.getElementById('puesto-extension').value || null; // Obtener la extensión, o null si no se selecciona

        try {
            await apiFetch(API_URLS.PUESTOS, {
                method: 'POST',
                body: JSON.stringify({ name, department_id, extension_id })
            });
            addPuestoForm.reset();
            await fetchPuestos();
        } catch (error) {
            handleApiError(error, 'agregar puesto');
            alert(`Error al agregar puesto: ${error.message}`);
        }
    });

    puestoListDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-puesto-btn')) {
            const puestoId = e.target.dataset.id;
            if (confirm('¿Estás seguro de que quieres eliminar este puesto? Solo se puede eliminar si está vacante.')) {
                deletePuesto(puestoId);
            }
        }
    });

    const deletePuesto = async (id) => {
        try {
            await apiFetch(`${API_URLS.PUESTOS}/${id}`, { method: 'DELETE' });
            await fetchPuestos();
        } catch (error) {
            handleApiError(error, 'eliminar puesto');
            alert(`Error al eliminar puesto: ${error.message}`);
        }
    };

    // --- GESTIÓN DE EXTENSIONES ---

    const renderExtensions = (extensions) => {
        extensionListDiv.innerHTML = '';
        if (!extensions || extensions.length === 0) {
            extensionListDiv.innerHTML = '<p>No hay extensiones para mostrar.</p>';
            return;
        }

        const listHtml = extensions.map(ext => {
            let statusHtml;
            const isOccupied = ext.puesto_name || ext.personal_name;
            const departmentBadge = ext.department_name ? `<span class="badge bg-secondary ms-2">${escapeHTML(ext.department_name)}</span>` : '';

            if (isOccupied) {
                if (ext.puesto_name) {
                    statusHtml = `<span class="badge bg-warning text-dark">Ocupada</span> <small class="text-muted ms-2">Puesto: <strong>${escapeHTML(ext.puesto_name)}</strong></small>`;
                } else if (ext.personal_name) { // ext.personal_name ahora puede ser una lista de nombres
                    statusHtml = `<span class="badge bg-warning text-dark">Ocupada</span> <small class="text-muted ms-2">Persona(s): <strong>${escapeHTML(ext.personal_name)}</strong></small>`;
                } else {
                    statusHtml = `<span class="badge bg-danger">Ocupada</span> <small class="text-danger ms-2">Asignación inconsistente</small>`;
                }
            } else {
                statusHtml = `<span class="badge bg-success">Disponible</span>`;
            }

            return `
                <div class="d-flex justify-content-between align-items-center p-2 border-bottom ${isOccupied ? 'extension-occupied' : 'extension-available'}">
                    <div>
                        <strong>${escapeHTML(ext.number)}</strong>
                        ${statusHtml}
                    </div>
                    <button class="btn btn-sm btn-outline-danger delete-extension-btn" data-id="${ext.id}" ${isOccupied ? 'disabled' : ''} title="${isOccupied ? 'No se puede eliminar una extensión en uso' : 'Eliminar extensión'}">Eliminar</button>
                </div>
            `;
        }).join('');
        extensionListDiv.innerHTML = listHtml;
    };

    const fetchExtensions = async () => {
        try {
            const response = await apiFetch(API_URLS.EXTENSIONS);
            const extensions = await response.json(); // La respuesta de la API
            extensionsData = extensions; // Guardar los datos en la variable global
            renderExtensions(extensions);
        } catch (error) {
            handleApiError(error, 'obtener las extensiones');
        }
    };

    const addExtension = async (number) => {
        const department_id = document.getElementById('extension-department').value || null;
        try {
            await apiFetch(API_URLS.EXTENSIONS, {
                method: 'POST',
                body: JSON.stringify({ number, department_id })
            });
            await fetchExtensions();
        } catch (error) {
            handleApiError(error, 'agregar la extensión');
            alert(`Error al agregar extensión: ${error.message}`);
        }
    };

    const deleteExtension = async (id) => {
        try {
            await apiFetch(`${API_URLS.EXTENSIONS}/${id}`, { method: 'DELETE' });
            await fetchExtensions();
        } catch (error) {
            handleApiError(error, 'eliminar la extensión');
            alert(`Error al eliminar extensión: ${error.message}`);
        }
    };

    document.getElementById('add-extension-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const extensionNumberInput = document.getElementById('extension-number');
        const extensionNumber = extensionNumberInput.value.trim();
        if (extensionNumber) {
            await addExtension(extensionNumber); // La función addExtension ahora leerá el department_id
            extensionNumberInput.value = '';
            document.getElementById('extension-department').value = ''; // Limpiar también el selector
        }
    });

    const downloadExtensionsReport = () => {
        if (extensionsData.length === 0) {
            alert('No hay datos de extensiones para exportar.');
            return;
        }

        // Encabezados del CSV
        const headers = ['Numero', 'Estado', 'Ocupado Por', 'Tipo Asignacion', 'Departamento'];
        
        // Función para escapar comas y comillas en los datos del CSV
        const escapeCsvCell = (cell) => {
            if (cell === null || cell === undefined) return '';
            const str = String(cell);
            // Si la celda contiene comas, comillas dobles o saltos de línea, la encerramos en comillas dobles
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`; // Escapar comillas dobles internas duplicándolas
            }
            return str;
        };

        const csvRows = extensionsData.map(ext => {
            const isOccupied = ext.puesto_name || ext.personal_name;
            let estado = 'Disponible';
            let ocupadoPor = '';
            let tipoAsignacion = '';

            if (isOccupied) {
                estado = 'Ocupada';
                if (ext.puesto_name) {
                    ocupadoPor = ext.puesto_name;
                    tipoAsignacion = 'Puesto';
                } else if (ext.personal_name) {
                    ocupadoPor = ext.personal_name;
                    tipoAsignacion = 'Persona';
                }
            }
            
            const row = [ext.number, estado, ocupadoPor, tipoAsignacion, ext.department_name || 'N/A'];
            return row.map(escapeCsvCell).join(',');
        });

        const csvContent = [headers.join(','), ...csvRows].join('\n');
        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' }); // \uFEFF para BOM de UTF-8 (ayuda a Excel)
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `reporte_extensiones_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const populateDepartmentDropdownForExtensions = async () => {
        try {
            const response = await apiFetch(API_URLS.DEPARTMENTS);
            const departments = await response.json();
            const departmentSelect = document.getElementById('extension-department');
            // Mantener la opción por defecto "Global"
            departmentSelect.innerHTML = '<option value="">Global (Sin Departamento)</option>';

            if (departments && departments.length > 0) {
                departments.forEach(dep => {
                    const option = document.createElement('option');
                    option.value = dep.id;
                    option.textContent = escapeHTML(dep.name);
                    departmentSelect.appendChild(option);
                });
            }
        } catch (error) {
            handleApiError(error, 'cargar el selector de departamentos para extensiones');
            document.getElementById('extension-department').disabled = true;
        }
    };

    // --- GESTIÓN DE USUARIOS ---

    const renderUsers = (users) => {
        userListGrid.innerHTML = '';
        if (!users || users.length === 0) {
            userListGrid.innerHTML = '<p>No hay usuarios para mostrar.</p>';
            return;
        }

        const tableHtml = `
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Username</th>
                        <th>Rol</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(user => `
                        <tr>
                            <td>${user.id}</td>
                            <td>${escapeHTML(user.username)}</td>
                            <td>${escapeHTML(user.role)}</td>
                            <td>
                                <button class="btn btn-sm btn-outline-danger delete-user-btn" data-id="${user.id}">Eliminar</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        userListGrid.innerHTML = tableHtml;
    };

    const fetchUsers = async () => {
        try {
            const response = await apiFetch(API_URLS.USERS);
            usersData = await response.json();
            renderUsers(usersData);
        } catch (error) {
            handleApiError(error, 'obtener la lista de usuarios');
        }
    };

    const handleAddUserFormSubmit = async (e) => {
        e.preventDefault();
        const messageEl = document.getElementById('user-message');
        messageEl.textContent = '';
        messageEl.className = 'mt-3';

        const username = document.getElementById('new-username').value;
        const password = document.getElementById('new-password').value;
        const role = document.getElementById('new-user-role').value; // El valor ya es 'user' o 'admin'
        const submitButton = addUserForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;

        try {
            const response = await apiFetch(API_URLS.REGISTER, {
                method: 'POST',
                body: JSON.stringify({ username, password, role }),
            });
            const result = await response.json();
            
            messageEl.textContent = result.message;
            messageEl.classList.add('text-success');
            
            addUserForm.reset();
            await fetchUsers(); // Refrescar la lista de usuarios

        } catch (error) {
            handleApiError(error, 'agregar usuario');
            messageEl.textContent = `Error: ${error.message}`;
            messageEl.classList.add('text-danger');
        } finally {
            // Vuelve a habilitar el botón después de que la operación termine (éxito o error)
            submitButton.disabled = false;
        }
    };

    const validatePasswordRealtime = () => {
        const passwordInput = document.getElementById('new-password');
        const password = passwordInput.value;
        const submitButton = addUserForm.querySelector('button[type="submit"]');
        const messageEl = document.getElementById('user-message');

        // Expresión regular que coincide con la del backend
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

        if (passwordRegex.test(password)) {
            // La contraseña es válida
            passwordInput.classList.remove('is-invalid');
            passwordInput.classList.add('is-valid');
            submitButton.disabled = false;
            // Limpiar el mensaje de error si el campo ahora es válido
            if (messageEl.classList.contains('text-danger')) {
                messageEl.textContent = '';
                messageEl.className = 'mt-3';
            }
        } else {
            // La contraseña no es válida
            passwordInput.classList.remove('is-valid');
            passwordInput.classList.add('is-invalid');
            submitButton.disabled = true;
            // Mostrar el mensaje de ayuda como un error de validación
            messageEl.textContent = 'La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula, un número y un símbolo (@$!%*?&).';
            messageEl.className = 'mt-3 text-danger';
        }
    };

    // Añadir el listener para la validación en tiempo real
    const passwordInput = document.getElementById('new-password');
    if (passwordInput) {
        passwordInput.addEventListener('input', validatePasswordRealtime);
    }

    // --- GESTIÓN DE DEPARTAMENTOS ---

    const renderDepartments = (departments) => {
        departmentListDiv.innerHTML = '';
        if (!departments || departments.length === 0) {
            departmentListDiv.innerHTML = '<p>No hay departamentos para mostrar.</p>';
            return;
        }

        const listHtml = departments.map(dep => `
            <div class="d-flex justify-content-between align-items-center p-2 border-bottom">
                <span>${escapeHTML(dep.name)}</span>
                <button class="btn btn-sm btn-outline-danger delete-department-btn" data-id="${dep.id}">Eliminar</button>
            </div>
        `).join('');
        departmentListDiv.innerHTML = listHtml;
    };

    const fetchDepartments = async () => {
        try {
            const response = await apiFetch(API_URLS.DEPARTMENTS);
            const departments = await response.json();
            renderDepartments(departments);
        } catch (error) {
            handleApiError(error, 'obtener los departamentos');
        }
    };

    // --- GESTIÓN DE INFORMACIÓN IMPORTANTE ---

    const renderImportantInfo = (data) => {
        importantInfoListDiv.innerHTML = '';
        if (!data || data.length === 0) {
            importantInfoListDiv.innerHTML = '<p>No hay información importante para mostrar.</p>';
            return;
        }

        const listHtml = data.map(info => `
            <div class="d-flex justify-content-between align-items-center p-2 border-bottom">
                <span>${escapeHTML(info.title)}</span>
                <div>
                    <button class="btn btn-sm btn-outline-primary edit-info-btn" data-id="${info.id}">Editar</button>
                    <button class="btn btn-sm btn-outline-danger delete-info-btn" data-id="${info.id}">Eliminar</button>
                </div>
            </div>
        `).join('');
        importantInfoListDiv.innerHTML = listHtml;
    };

    const fetchImportantInfo = async () => {
        try {
            const response = await apiFetch(API_URLS.IMPORTANT_INFO);
            importantInfoData = await response.json();
            renderImportantInfo(importantInfoData);
        } catch (error) {
            handleApiError(error, 'obtener la información importante');
        }
    };

    const handleImportantInfoFormSubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('important-info-id').value;
        const title = document.getElementById('info-title').value;
        const extension = document.getElementById('info-extension').value;
        const content = document.getElementById('info-content').value;

        const url = id ? `${API_URLS.IMPORTANT_INFO}/${id}` : API_URLS.IMPORTANT_INFO;
        const method = id ? 'PUT' : 'POST';

        try {
            await apiFetch(url, {
                method: method,
                body: JSON.stringify({ title, extension, content }),
            });
            importantInfoForm.reset();
            document.getElementById('important-info-id').value = '';
            await fetchImportantInfo();
        } catch (error) {
            handleApiError(error, 'guardar la información importante');
            alert(`Error al guardar: ${error.message}`);
        }
    };

    importantInfoListDiv.addEventListener('click', (e) => {
        const target = e.target;
        const infoId = target.dataset.id;

        if (target.classList.contains('edit-info-btn')) {
            const info = importantInfoData.find(i => i.id == infoId);
            if (info) {
                document.getElementById('important-info-id').value = info.id;
                document.getElementById('info-title').value = info.title;
                document.getElementById('info-extension').value = info.extension || '';
                document.getElementById('info-content').value = info.content || '';
            }
        }

        if (target.classList.contains('delete-info-btn')) {
            if (confirm('¿Estás seguro de que quieres eliminar esta información?')) {
                deleteImportantInfo(infoId);
            }
        }
    });

    const deleteImportantInfo = async (id) => {
        try {
            await apiFetch(`${API_URLS.IMPORTANT_INFO}/${id}`, { method: 'DELETE' });
            // Mejora: Si el elemento eliminado es el que se está editando, limpiar el formulario.
            const currentlyEditingId = document.getElementById('important-info-id').value;
            if (currentlyEditingId === id) {
                importantInfoForm.reset();
                document.getElementById('important-info-id').value = '';
            }
            await fetchImportantInfo();
        } catch (error) {
            handleApiError(error, 'eliminar información importante');
            alert(`Error al eliminar: ${error.message}`);
        }
    };

    userListGrid.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-user-btn')) {
            const userId = e.target.dataset.id;
            if (confirm('¿Estás seguro de que quieres eliminar este usuario?')) {
                deleteUser(userId);
            }
        }
    });
    const addDepartment = async (departmentName) => {
        try {
            await apiFetch(API_URLS.DEPARTMENTS, {
                method: 'POST',
                body: JSON.stringify({ name: departmentName })
            });
            await fetchDepartments();
        } catch (error) {
            handleApiError(error, 'agregar el departamento');
            alert(`Error al agregar departamento: ${error.message}`);
        }
    };

    const deleteDepartment = async (id) => {
        try {
            await apiFetch(`${API_URLS.DEPARTMENTS}/${id}`, { method: 'DELETE' });
            await fetchDepartments();
        } catch (error) {
            handleApiError(error, 'eliminar el departamento');
            alert(`Error al eliminar departamento: ${error.message}`);
        }
    };

    const deleteUser = async (id) => {
        try {
            await apiFetch(`${API_URLS.USERS}/${id}`, { method: 'DELETE' });
            await fetchUsers(); // Refrescar la lista de usuarios
        } catch (error) {
            handleApiError(error, 'eliminar usuario');
            alert(`Error al eliminar usuario: ${error.message}`);
        }
    };
    document.getElementById('add-department-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const departmentNameInput = document.getElementById('department-name');
        const departmentName = departmentNameInput.value.trim();
        if (departmentName) {
            await addDepartment(departmentName);
            departmentNameInput.value = '';
        }
    });

    departmentListDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-department-btn')) {
            const departmentId = e.target.dataset.id;
            if (confirm('¿Estás seguro de que quieres eliminar este departamento?')) {
                deleteDepartment(departmentId);
            }
        }
    });

    extensionListDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-extension-btn')) {
            const extensionId = e.target.dataset.id;
            if (confirm('¿Estás seguro de que quieres eliminar esta extensión? Se desasignará de cualquier puesto al que esté vinculada.')) {
                deleteExtension(extensionId);
            }
        }
    });

    // --- CARGA MASIVA ---

    const handleBulkUpload = async (e) => {
        e.preventDefault();
        const formData = new FormData(bulkUploadForm);
        const messageEl = document.getElementById('bulk-upload-message');
        messageEl.textContent = 'Subiendo y procesando archivo...';

        try {
            const response = await apiFetch(`${API_URLS.PERSONAL}/bulk-upload`, {
                method: 'POST',
                body: formData,
            });
            const result = await response.json();
            
            // Si hay errores específicos de filas, los mostramos para facilitar la depuración.
            if (result.errors && result.errors.length > 0) {
                messageEl.textContent = `Proceso completado con errores: ${result.message}`;
                messageEl.className = 'mt-3 text-warning'; // Usar un color de advertencia
                console.warn('Errores detallados de la carga masiva:', result.errors);
            } else {
                messageEl.textContent = `Éxito: ${result.message}`;
                messageEl.className = 'mt-3 text-success';
            }

            await fetchStaff(); // Refrescar la lista de personal
        } catch (error) {
            handleApiError(error, 'realizar la carga masiva');
            messageEl.textContent = `Error: ${error.message}`;
            messageEl.className = 'mt-3 text-danger';
        }
    };

    const handleBulkUploadExtensions = async (e) => {
        e.preventDefault();
        const formData = new FormData(bulkUploadExtensionsForm);
        const messageEl = document.getElementById('bulk-upload-extensions-message');
        messageEl.textContent = 'Subiendo y procesando archivo...';
        messageEl.className = 'mt-3';

        try {
            const response = await apiFetch(API_URLS.EXTENSIONS_BULK, {
                method: 'POST',
                body: formData,
            });
            const result = await response.json();

            if (result.errors && result.errors.length > 0) {
                messageEl.textContent = `Proceso completado con advertencias: ${result.message}`;
                messageEl.className = 'mt-3 text-warning';
            } else {
                messageEl.textContent = `Éxito: ${result.message}`;
                messageEl.className = 'mt-3 text-success';
            }
            await fetchExtensions(); // Refrescar la lista de extensiones
        } catch (error) {
            handleApiError(error, 'realizar la carga masiva de extensiones');
            messageEl.textContent = `Error: ${error.message}`;
            messageEl.className = 'mt-3 text-danger';
        }
    };
    // --- APARIENCIA ---

    const handleThemeChange = async (e) => {
        const newTheme = e.target.value;
        try {
            await apiFetch(API_URLS.THEME, {
                method: 'POST',
                body: JSON.stringify({ theme: newTheme }),
            });
            alert('El tema global ha sido actualizado.');
        } catch (error) {
            handleApiError(error, 'actualizar el tema');
            alert(`Error al cambiar el tema: ${error.message}`);
        }
    };

    // --- INICIALIZACIÓN ---
    document.getElementById('add-staff-btn').addEventListener('click', () => {
        staffForm.reset();
        document.getElementById('staff-id').value = '';
        document.getElementById('staffModalLabel').textContent = 'Agregar Nuevo Personal';
        staffModal.show();
        // Poblar los dropdowns necesarios para el formulario de un nuevo miembro del personal.
        populatePuestosDropdown();
        populatePersonalExtensionDropdown();
    });
    loginForm.addEventListener('submit', handleLoginFormSubmit);
    addUserForm.addEventListener('submit', handleAddUserFormSubmit);
    // addPuestoForm ya tiene su listener más arriba, no es necesario duplicarlo.
    staffForm.addEventListener('submit', handleStaffFormSubmit);
    logoutBtn.addEventListener('click', logout);
    document.getElementById('download-extensions-report-btn').addEventListener('click', downloadExtensionsReport);
    importantInfoForm.addEventListener('submit', handleImportantInfoFormSubmit);
    bulkUploadExtensionsForm.addEventListener('submit', handleBulkUploadExtensions);
    bulkUploadForm.addEventListener('submit', handleBulkUpload);
    themeSelect.addEventListener('change', handleThemeChange);
    searchInputAdmin.addEventListener('input', filterStaff);
    cancelEditInfoBtn.addEventListener('click', () => {
        importantInfoForm.reset();
        document.getElementById('important-info-id').value = '';
    });

    // Event listener para filtrar las extensiones cuando se cambia el departamento en el form de puestos
    document.getElementById('puesto-department').addEventListener('change', (e) => {
        const selectedDepartmentId = e.target.value;
        populatePuestoExtensionsDropdown(selectedDepartmentId);
    });


    // Carga inicial de datos y comprobación de sesión
    checkAuth();
});
