// script.js
// Sends the uploaded image to https://example.com and expects the response format
// shown by you. Converts that response into the internal structure used by the UI.

window.currentFoodData = null; // make accessible to global functions below

document.addEventListener('DOMContentLoaded', function() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const loading = document.querySelector('.loading');
    const resultsSection = document.getElementById('resultsSection');
    const foodItemsContainer = document.getElementById('foodItems');
    const totalCaloriesElement = document.getElementById('totalCalories');
    const foodItemTemplate = document.getElementById('foodItemTemplate').innerHTML;

    // Drag and drop handlers
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        handleFile(file);
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        handleFile(file);
    });

    function handleFile(file) {
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        loading.classList.add('active');
        resultsSection.style.display = 'none';
        foodItemsContainer.innerHTML = '';

        fetch('https://calorie-backend-eta.vercel.app/', { // <-- send to example.com as requested
            method: 'POST',
            body: formData
        })
        .then(async response => {
            if (!response.ok) {
                const txt = await response.text().catch(() => '');
                throw new Error(`Server returned ${response.status} ${response.statusText} ${txt}`);
            }
            return response.json();
        })
        .then(data => {
            // Convert the returned structure into the UI's internal format
            // expected by displayResults (data.items = [...])
            const converted = convertResponseToItems(data);
            // store globally
            window.currentFoodData = { items: converted };
            displayResults(window.currentFoodData);
        })
        .catch(error => {
            console.error('Error:', error);
            showError('An error occurred while processing the image: ' + (error.message || 'Unknown'));
        })
        .finally(() => {
            loading.classList.remove('active');
        });
    }

    function convertResponseToItems(apiResponse) {
        // apiResponse is an object with keys = food names (e.g., "Bananas")
        // Each value contains `secondary` (array), `primary` (object), and `quantity` (number)
        const items = [];
        let idx = 0;
        for (const [name, payload] of Object.entries(apiResponse)) {
            idx++;
            const id = `${name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '')}_${Date.now()}_${idx}`;

            // Build serving_info map: use serving_description or measurement_description as key
            const servingInfo = {};
            const addServing = (serv) => {
                const key = serv.serving_description || serv.measurement_description || serv.serving_id || 'serving';
                // convert numeric strings to numbers where appropriate
                servingInfo[key] = {
                    serving_id: serv.serving_id ?? null,
                    serving_description: key,
                    metric_serving_amount: parseFloat(serv.metric_serving_amount) || null,
                    metric_serving_unit: serv.metric_serving_unit || null,
                    calories: Number(serv.calories) || 0,
                    carbohydrate: Number(serv.carbohydrate) || 0,
                    protein: Number(serv.protein) || 0,
                    fat: Number(serv.fat) || 0,
                    raw: serv // keep raw if needed
                };
            };

            if (Array.isArray(payload.secondary)) {
                payload.secondary.forEach(s => addServing(s));
            }
            if (payload.primary) {
                // ensure primary appears in servingInfo as well
                addServing(payload.primary);
            }

            const quantity = Number(payload.quantity) || 1;
            // Choose initial serving_size: prefer payload.primary.serving_description, fallback to first key
            const initialServingKey = (payload.primary && (payload.primary.serving_description || payload.primary.measurement_description))
                || Object.keys(servingInfo)[0];

            // compute aggregate nutrition for chosen serving and quantity
            const sel = servingInfo[initialServingKey];
            const calories = Math.round((sel?.calories || 0) * quantity);
            const protein = parseFloat(((sel?.protein || 0) * quantity).toFixed(1));
            const carbs = parseFloat(((sel?.carbohydrate || 0) * quantity).toFixed(1));
            const fat = parseFloat(((sel?.fat || 0) * quantity).toFixed(1));

            const item = {
                id,
                name,
                quantity,
                serving_info: servingInfo,
                serving_size: initialServingKey,
                is_primary: true, // UI treats this as included by default
                calories,
                protein,
                carbs,
                fat
            };

            items.push(item);
        }

        return items;
    }

    function displayResults(data) {
        foodItemsContainer.innerHTML = '';
        let totalCalories = 0;

        data.items.forEach(item => {
            const foodItem = createFoodItem(item);
            foodItemsContainer.appendChild(foodItem);
            if (item.is_primary) {
                totalCalories += Number(item.calories) || 0;
            }
        });

        totalCaloriesElement.textContent = totalCalories;
        resultsSection.style.display = 'block';
    }

    function createFoodItem(item) {
        // Create a temporary div to hold the template
        const tempDiv = document.createElement('div');

        // Start by replacing simple placeholders
        let html = foodItemTemplate
            .replace(/\${id}/g, item.id)
            .replace(/\${name}/g, escapeHtml(item.name))
            .replace(/\${quantity}/g, item.quantity)
            .replace(/\${serving_size}/g, escapeHtml(item.serving_size || ''))
            .replace(/\${calories}/g, item.calories)
            .replace(/\${protein}/g, item.protein)
            .replace(/\${carbs}/g, item.carbs)
            .replace(/\${fat}/g, item.fat)
            .replace(/\${is_primary}/g, item.is_primary ? 'checked' : '');

        // Remove the JS-expression placeholder for serving options (we'll populate the <select> later)
        html = html.replace(/\$\{Object\.entries\(serving_info\)[\s\S]*?\.join\(''\)\}/, '__SERVING_OPTIONS__');

        // Remove the inline non-primary JS ternary placeholder; we'll add the note if needed below
        html = html.replace(/\$\{!is_primary \? `[\s\S]*?` : ''\}/, '');

        tempDiv.innerHTML = html;

        // Get the food item element
        const foodItem = tempDiv.firstElementChild;

        // Set the primary class and checkbox state based on is_primary
        if (item.is_primary) {
            foodItem.classList.add('primary');
            const checkbox = foodItem.querySelector('.primary-checkbox');
            if (checkbox) {
                checkbox.checked = true;
            }
        } else {
            const checkbox = foodItem.querySelector('.primary-checkbox');
            if (checkbox) checkbox.checked = false;
        }

        // Store serving info as data attribute (stringified) for later use
        foodItem.dataset.servingInfo = JSON.stringify(item.serving_info || {});

        // Populate the serving-size-select options
        const select = foodItem.querySelector('.serving-size-select');
        if (select) {
            const optionsHTML = Object.keys(item.serving_info).map(size => {
                const selected = size === item.serving_size ? 'selected' : '';
                return `<option value="${escapeHtml(size)}" ${selected}>${escapeHtml(size)}</option>`;
            }).join('');
            select.innerHTML = optionsHTML;

            // attach onchange handler if not already wired inline
            select.onchange = function() {
                updateServingSize(item.id, this.value);
            };
        }

        // Wire quantity input + +/- buttons
        const minusBtn = foodItem.querySelector('.quantity-btn.minus');
        const plusBtn = foodItem.querySelector('.quantity-btn.plus');
        const qtyInput = foodItem.querySelector('.quantity-value');
        if (minusBtn) minusBtn.onclick = () => updateQuantity(item.id, -1);
        if (plusBtn) plusBtn.onclick = () => updateQuantity(item.id, 1);
        if (qtyInput) qtyInput.onchange = () => updateQuantity(item.id, 0);

        // Ensure the primary checkbox calls togglePrimary
        const checkbox = foodItem.querySelector('.primary-checkbox');
        if (checkbox) {
            checkbox.onchange = () => window.togglePrimary(item.id);
        }

        // If item is not primary, append the note
        if (!item.is_primary) {
            const nonPrimaryNote = document.createElement('p');
            nonPrimaryNote.className = 'non-primary-note';
            nonPrimaryNote.innerHTML = `<i class="fas fa-info-circle"></i> This item is not included in the total calories`;
            foodItem.appendChild(nonPrimaryNote);
        }

        return foodItem;
    }

    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${escapeHtml(message)}`;
        // clear previous errors
        const prev = resultsSection.querySelector('.error');
        if (prev) prev.remove();
        resultsSection.appendChild(errorDiv);
        resultsSection.style.display = 'block';
    }

    // Expose togglePrimary to the window (already used by template)
    window.togglePrimary = function(itemId) {
        const foodItem = document.querySelector(`.food-item[data-id="${itemId}"]`);
        if (!foodItem) return;
        const checkbox = foodItem.querySelector('.primary-checkbox');
        const isPrimary = !!checkbox && checkbox.checked;

        // Update the item in currentFoodData
        const item = window.currentFoodData && window.currentFoodData.items
            ? window.currentFoodData.items.find(it => it.id === itemId)
            : null;
        if (item) {
            item.is_primary = isPrimary;
        }

        // Update the UI
        foodItem.classList.toggle('primary', isPrimary);
        const nonPrimaryNote = foodItem.querySelector('.non-primary-note');
        if (nonPrimaryNote) {
            nonPrimaryNote.style.display = isPrimary ? 'none' : 'block';
        } else if (!isPrimary) {
            // create if missing
            const note = document.createElement('p');
            note.className = 'non-primary-note';
            note.innerHTML = `<i class="fas fa-info-circle"></i> This item is not included in the total calories`;
            foodItem.appendChild(note);
        }

        // Recalculate total calories
        updateTotalCalories();
    };

    // small helper
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});

// ------- Global functions (rely on window.currentFoodData) -------

function updateQuantity(itemId, change) {
    const foodItem = document.querySelector(`.food-item[data-id="${itemId}"]`);
    if (!foodItem) return;
    const quantityInput = foodItem.querySelector('.quantity-value');
    let currentVal = parseInt(quantityInput.value) || 0;
    let newQuantity = currentVal + change;
    if (change === 0) { // triggered by manual input
        newQuantity = parseInt(quantityInput.value) || 1;
    }
    if (newQuantity < 1) newQuantity = 1;
    quantityInput.value = newQuantity;

    // Get current serving size and update nutrition values
    const servingSize = foodItem.querySelector('.serving-size-select').value;
    const servingInfo = JSON.parse(foodItem.dataset.servingInfo || '{}');
    const selectedServing = servingInfo[servingSize];
    if (!selectedServing) return;

    const calories = Math.round((Number(selectedServing.calories) || 0) * newQuantity);
    const protein = (Number(selectedServing.protein) * newQuantity).toFixed(1);
    const carbs = (Number(selectedServing.carbohydrate) * newQuantity).toFixed(1);
    const fat = (Number(selectedServing.fat) * newQuantity).toFixed(1);

    const calEl = foodItem.querySelector('.nutrition-value.calories');
    const protEl = foodItem.querySelector('.nutrition-value.protein');
    const carbsEl = foodItem.querySelector('.nutrition-value.carbs');
    const fatEl = foodItem.querySelector('.nutrition-value.fat');

    if (calEl) calEl.textContent = calories;
    if (protEl) protEl.textContent = protein + 'g';
    if (carbsEl) carbsEl.textContent = carbs + 'g';
    if (fatEl) fatEl.textContent = fat + 'g';

    // Update the item in currentFoodData
    if (window.currentFoodData && window.currentFoodData.items) {
        const item = window.currentFoodData.items.find(i => i.id === itemId);
        if (item) {
            item.quantity = newQuantity;
            item.calories = calories;
            item.protein = parseFloat(protein);
            item.carbs = parseFloat(carbs);
            item.fat = parseFloat(fat);
        }
    }

    updateTotalCalories();
}

function updateServingSize(itemId, newServingSize) {
    const foodItem = document.querySelector(`.food-item[data-id="${itemId}"]`);
    if (!foodItem) return;
    const servingInfo = JSON.parse(foodItem.dataset.servingInfo || '{}');
    const selectedServing = servingInfo[newServingSize];
    if (!selectedServing) return;
    const quantity = parseInt(foodItem.querySelector('.quantity-value').value) || 1;

    const calories = Math.round((Number(selectedServing.calories) || 0) * quantity);
    const protein = (Number(selectedServing.protein) * quantity).toFixed(1);
    const carbs = (Number(selectedServing.carbohydrate) * quantity).toFixed(1);
    const fat = (Number(selectedServing.fat) * quantity).toFixed(1);

    const calEl = foodItem.querySelector('.nutrition-value.calories');
    const protEl = foodItem.querySelector('.nutrition-value.protein');
    const carbsEl = foodItem.querySelector('.nutrition-value.carbs');
    const fatEl = foodItem.querySelector('.nutrition-value.fat');

    if (calEl) calEl.textContent = calories;
    if (protEl) protEl.textContent = protein + 'g';
    if (carbsEl) carbsEl.textContent = carbs + 'g';
    if (fatEl) fatEl.textContent = fat + 'g';

    // Update the item in currentFoodData
    if (window.currentFoodData && window.currentFoodData.items) {
        const item = window.currentFoodData.items.find(i => i.id === itemId);
        if (item) {
            item.serving_size = newServingSize;
            item.calories = calories;
            item.protein = parseFloat(protein);
            item.carbs = parseFloat(carbs);
            item.fat = parseFloat(fat);
        }
    }

    updateTotalCalories();
}

function updateTotalCalories() {
    let totalCalories = 0;
    document.querySelectorAll('.food-item').forEach(item => {
        const checkbox = item.querySelector('.primary-checkbox');
        const isPrimary = checkbox ? checkbox.checked : true;
        if (isPrimary) {
            const cEl = item.querySelector('.nutrition-value.calories');
            const calories = cEl ? parseInt(cEl.textContent) || 0 : 0;
            totalCalories += calories;
        }
    });

    document.getElementById('totalCalories').textContent = totalCalories;
}
