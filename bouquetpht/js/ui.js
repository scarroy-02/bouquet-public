// ========== UI Widgets: collapsible sections, floating panels ==========
// Same behavior as Bouquet2D's sidebar sections and plot windows.

export function initSections() {
    for (const header of document.querySelectorAll('.section-header')) {
        header.addEventListener('click', () => header.parentElement.classList.toggle('collapsed'));
    }
}

// Switch a panel to fixed positioning at its current place, so it can move freely.
function detach(panel) {
    const rect = panel.getBoundingClientRect();
    Object.assign(panel.style, {
        position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, right: 'auto', bottom: 'auto',
    });
    return rect;
}

export function makePanelDraggable(panel) {
    const header = panel.querySelector('.float-panel-header');
    header.addEventListener('mousedown', e => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        const rect = detach(panel);
        const startX = e.clientX, startY = e.clientY;
        const onMove = ev => {
            const left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, rect.left + ev.clientX - startX));
            const top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, rect.top + ev.clientY - startY));
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

export function makePanelResizable(panel) {
    const MIN_W = 220, MIN_H = 180;
    for (const handle of panel.querySelectorAll('.resize-handle')) {
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            e.stopPropagation();
            const dir = handle.dataset.dir;
            const rect = detach(panel);
            const startX = e.clientX, startY = e.clientY;
            panel.classList.add('resizing');
            const onMove = ev => {
                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                let w = rect.width, h = rect.height, left = rect.left, top = rect.top;
                if (dir.includes('e')) w = Math.max(MIN_W, rect.width + dx);
                if (dir.includes('s')) h = Math.max(MIN_H, rect.height + dy);
                if (dir.includes('w')) { w = Math.max(MIN_W, rect.width - dx); left = rect.left + rect.width - w; }
                if (dir.includes('n')) { h = Math.max(MIN_H, rect.height - dy); top = rect.top + rect.height - h; }
                Object.assign(panel.style, { width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px` });
            };
            const onUp = () => {
                panel.classList.remove('resizing');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }
}
