const BASE_URL = "https://brecho-system-resources.s3.us-east-1.amazonaws.com/cloths/";
let currentCategory = 'tops';
let draggedElement = null;

// Hierarquia de raridade com probabilidades (weights) proporcionais
const raritySettings = [
    { name: 'common', color: '#eeeeee', bgColor: '#ffffff', weight: 85 },  // 85% - Muito Comum
    { name: 'rare', color: '#b9d6f2', bgColor: '#f0f7ff', weight: 10 },    // 10% - Raro
    { name: 'epic', color: '#c3a6f2', bgColor: '#f8f4ff', weight: 4 },     // 4%  - Muito Difícil
    { name: 'legendary', color: '#efd469', bgColor: '#fffdf2', weight: 1 } // 1%  - Raríssimo
];

const categories = {
    tops: ["04", "14", "10", "23", "30", "40", "38"],
    pants: ["03", "26", "27"],
    shoes: ["37", "35", "32", "33", "22", "15", "17", "18", "02"],
    dresses: ["08","41","42","43","44","45"],
    coats: ["28","46","47","48","49","50"],
    hats: ["09", "01", "31", "24", "29","51","52","53"],
    bags: ["12", "25", "19","54","55","56"],
    watches: ["13","57","58","59" ],
    rings: ["21", "05", "06", "39"],
    acc: ["07", "16", "11", "34", "36", "20"]
};

// Sorteador baseado na hierarquia de pesos
function getRandomRarity() {
    const totalWeight = raritySettings.reduce((acc, curr) => acc + curr.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const rarity of raritySettings) {
        if (random < rarity.weight) return rarity;
        random -= rarity.weight;
    }
    return raritySettings[0];
}

function loadCategory(catName, event) {
    if(catName) currentCategory = catName;
    
    const grid = document.getElementById('inventory-grid');
    grid.innerHTML = '';

    if(event) {
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        event.currentTarget.classList.add('active');
        
        const previewImg = document.getElementById('big-preview-img');
        const placeholder = document.getElementById('placeholder');
        if(previewImg && placeholder) {
            previewImg.style.display = 'none';
            previewImg.src = '';
            previewImg.classList.remove('idle-animation');
            placeholder.style.display = 'block';
        }
    }

    const items = categories[currentCategory];

    items.forEach(itemId => {
        const slot = createSlot(false, itemId);
        grid.appendChild(slot);
    });

    fillEmptySlots();
}

function createSlot(isEmpty, itemId = null) {
    const slot = document.createElement('div');
    slot.className = isEmpty ? 'item-slot empty' : 'item-slot';
    slot.draggable = !isEmpty;

    if (!isEmpty) {
        const imgFullUrl = BASE_URL + itemId + ".png";
        const img = document.createElement('img');
        img.src = imgFullUrl;
        slot.appendChild(img);
        slot.onclick = () => setPreview(imgFullUrl);
        
        // Aplica a hierarquia: quanto mais raro, mais difícil de cair
        const rarity = getRandomRarity();
        applyRarityStyle(slot, rarity);
    }

    slot.addEventListener('dragstart', handleDragStart);
    slot.addEventListener('dragover', handleDragOver);
    slot.addEventListener('drop', handleDrop);
    slot.addEventListener('dragend', handleDragEnd);

    return slot;
}

function applyRarityStyle(slot, rarity) {
    // Comum: Mantém borda padrão quase invisível
    if (rarity.name === 'common') {
        slot.style.border = '2px solid #eeeeee'; 
        slot.style.background = '#ffffff';
    } else {
        // Hierárquicos: Ganham bordas coloridas suaves (2px) e fundo temático
        slot.style.border = `2px solid ${rarity.color}`;
        slot.style.background = rarity.bgColor;
    }
}

function handleDragStart(e) {
    if (this.classList.contains('empty')) return;
    draggedElement = this;
    this.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    e.stopPropagation();
    if (draggedElement !== this) {
        const tempHTML = this.innerHTML;
        const tempClass = this.className;
        const tempDraggable = this.draggable;
        const tempOnClick = this.onclick;
        const tempBorder = this.style.border;
        const tempBackground = this.style.background;

        this.innerHTML = draggedElement.innerHTML;
        this.className = draggedElement.className;
        this.draggable = draggedElement.draggable;
        this.onclick = draggedElement.onclick;
        this.style.border = draggedElement.style.border;
        this.style.background = draggedElement.style.background;

        draggedElement.innerHTML = tempHTML;
        draggedElement.className = tempClass;
        draggedElement.draggable = tempDraggable;
        draggedElement.onclick = tempOnClick;
        draggedElement.style.border = tempBorder;
        draggedElement.style.background = tempBackground;
    }
    return false;
}

function handleDragEnd() {
    this.style.opacity = '1';
    draggedElement = null;
}

function fillEmptySlots() {
    const grid = document.getElementById('inventory-grid');
    const wrapper = document.querySelector('.grid-wrapper');
    const title = document.querySelector('.grid-title');
    if (!grid || !wrapper) return;
    
    document.querySelectorAll('.item-slot.empty').forEach(el => el.remove());

    const gridStyle = window.getComputedStyle(grid);
    const columns = gridStyle.getPropertyValue('grid-template-columns').split(' ').length;
    
    const firstSlot = grid.querySelector('.item-slot:not(.empty)');
    const slotHeight = firstSlot ? firstSlot.offsetHeight : 120;
    const gap = parseInt(gridStyle.getPropertyValue('gap')) || 15;
    
    const availableHeight = wrapper.clientHeight - title.offsetHeight - 40; 
    const rowsThatFit = Math.floor((availableHeight + gap) / (slotHeight + gap));
    
    const maxTotalSlots = columns * rowsThatFit;
    const currentTotal = grid.children.length;
    
    if (currentTotal < maxTotalSlots) {
        const totalEmptyToCreate = maxTotalSlots - currentTotal;
        for (let i = 0; i < totalEmptyToCreate; i++) {
            const emptySlot = createSlot(true);
            grid.appendChild(emptySlot);
        }
    }
}

function setPreview(url) {
    const previewImg = document.getElementById('big-preview-img');
    const placeholder = document.getElementById('placeholder');
    if(!previewImg || !placeholder) return;

    previewImg.classList.remove('idle-animation');
    placeholder.style.display = 'none';
    previewImg.src = url;
    previewImg.style.display = 'block';
    
    previewImg.style.transition = '0.4s ease-out';
    previewImg.style.opacity = '0';
    previewImg.style.transform = 'scale(0.9) translateY(10px)';
    
    setTimeout(() => {
        previewImg.style.opacity = '1';
        previewImg.style.transform = 'scale(1) translateY(0)';
        setTimeout(() => {
            previewImg.style.transition = 'none'; 
            previewImg.classList.add('idle-animation');
        }, 400);
    }, 10);
}

window.onresize = () => {
    setTimeout(fillEmptySlots, 100);
};
window.onload = () => loadCategory('tops');