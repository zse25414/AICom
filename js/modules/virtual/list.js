/**
 * Lumina — lightweight virtual list for long task lists
 */
const DEFAULT_ROW_HEIGHT = 76;
const DEFAULT_THRESHOLD = 36;
const DEFAULT_OVERSCAN = 4;

export function mountVirtualList(container, options) {
    const {
        items = [],
        renderRow,
        rowHeight = DEFAULT_ROW_HEIGHT,
        threshold = DEFAULT_THRESHOLD,
        overscan = DEFAULT_OVERSCAN
    } = options || {};

    if (!container || typeof renderRow !== 'function') {
        return { refresh() {} };
    }

    if (items.length <= threshold) {
        container.classList.remove('virtual-list-host');
        container.dataset.virtual = 'off';
        container.innerHTML = items.map((item, index) => renderRow(item, index)).join('');
        container.onscroll = null;
        return {
            refresh(nextItems) {
                mountVirtualList(container, { ...options, items: nextItems || [] });
            }
        };
    }

    container.classList.add('virtual-list-host');
    container.dataset.virtual = 'on';

    let list = items;
    let scrollTop = container.scrollTop || 0;

    function paint() {
        const viewport = container.clientHeight || 320;
        const totalHeight = list.length * rowHeight;
        const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
        const visible = Math.ceil(viewport / rowHeight) + overscan * 2;
        const end = Math.min(list.length, start + visible);
        const offsetY = start * rowHeight;

        container.innerHTML = `
            <div class="virtual-list-track" style="height:${totalHeight}px;position:relative;width:100%">
                <div class="virtual-list-window" style="position:absolute;left:0;right:0;top:0;transform:translateY(${offsetY}px)">
                    ${list.slice(start, end).map((item, index) => renderRow(item, start + index)).join('')}
                </div>
            </div>`;
    }

    let scrollRaf = null;
    container.onscroll = () => {
        scrollTop = container.scrollTop;
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
            scrollRaf = null;
            paint();
        });
    };

    paint();

    return {
        refresh(nextItems) {
            list = nextItems || list;
            scrollTop = container.scrollTop || 0;
            paint();
        }
    };
}

export const LuminaVirtual = { mountVirtualList };