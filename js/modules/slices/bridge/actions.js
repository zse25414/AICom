/* Lumina: bridge/actions.js — delegated UI actions */

const __luminaActions = Object.create(null);

function registerLuminaAction(name, fn) {
    if (typeof fn === 'function') __luminaActions[name] = fn;
}
if (typeof window !== 'undefined') window.registerLuminaAction = registerLuminaAction;

function resolveArgFrom(el, spec) {
    if (!spec) return undefined;
    if (spec === 'checked') return el.checked;
    if (spec === 'src') return el.src;
    if (spec === 'value') return el.value;
    if (spec.startsWith('dataset.')) return el.dataset[spec.slice(8)];
    return el.getAttribute(spec);
}

function parseLuminaArg(raw, type) {
    if (raw === undefined || raw === '') return undefined;
    if (type === 'number') return Number(raw);
    if (type === 'boolean') return raw === 'true';
    if (type === 'json') {
        try { return JSON.parse(raw); } catch (_) { return undefined; }
    }
    return raw;
}

function buildLuminaCallArgs(el, event) {
    const args = [];
    if (el.dataset.luminaPassEvent !== undefined) {
        args.push(event);
    } else {
        if (el.dataset.luminaArgFrom !== undefined) {
            args.push(resolveArgFrom(el, el.dataset.luminaArgFrom));
        } else if (el.dataset.luminaArg !== undefined) {
            args.push(parseLuminaArg(el.dataset.luminaArg, el.dataset.luminaArgType));
        }
        if (el.dataset.luminaArg2From !== undefined) {
            args.push(resolveArgFrom(el, el.dataset.luminaArg2From));
        } else if (el.dataset.luminaArg2 !== undefined) {
            args.push(parseLuminaArg(el.dataset.luminaArg2, el.dataset.luminaArg2Type));
        }
        if (el.dataset.luminaArg3 !== undefined) {
            args.push(parseLuminaArg(el.dataset.luminaArg3, el.dataset.luminaArg3Type));
        }
    }
    return args;
}

async function invokeLuminaAction(name, event, args = []) {
    const fn = __luminaActions[name] || window[name];
    if (typeof fn !== 'function') {
        console.warn('[Lumina] action not found:', name);
        return;
    }
    const passEvent = args.length === 1 && args[0] === '__event__';
    const callArgs = passEvent ? [event] : args;
    return await fn(...callArgs);
}

async function runLuminaActionsFromElement(el, event) {
    if (el.dataset.luminaStop !== undefined) event.stopPropagation();

    if (el.dataset.luminaActions) {
        let chain;
        try {
            chain = JSON.parse(el.dataset.luminaActions);
        } catch (_) {
            console.warn('[Lumina] invalid data-lumina-actions');
            return;
        }
        for (const item of chain) {
            const [name, ...args] = item;
            await invokeLuminaAction(name, event, args);
        }
        return;
    }

    const name = el.dataset.luminaAction;
    if (!name) return;

    await invokeLuminaAction(name, event, buildLuminaCallArgs(el, event));
}

function parseChangeArgs(el) {
    if (!el.dataset.luminaChangeArgs) return buildLuminaCallArgs(el, null);
    let parsed;
    try {
        parsed = JSON.parse(el.dataset.luminaChangeArgs);
    } catch (_) {
        return buildLuminaCallArgs(el, null);
    }
    return parsed.map((item) => {
        if (item === '__target__') return el;
        if (item === '__checked__') return el.checked;
        return item;
    });
}

let __luminaDelegationReady = false;

function setupActionDelegation() {
    if (__luminaDelegationReady) return;
    __luminaDelegationReady = true;

    document.addEventListener('click', async (event) => {
        const dismissEl = event.target.closest('[data-lumina-dismiss]');
        if (dismissEl && event.target === dismissEl) {
            event.preventDefault();
            await invokeLuminaAction(dismissEl.dataset.luminaDismiss, event, ['__event__']);
            return;
        }

        const actionEl = event.target.closest('[data-lumina-action],[data-lumina-actions],[data-lumina-stop]');
        if (!actionEl) return;

        if (actionEl.dataset.luminaStop !== undefined && !actionEl.dataset.luminaAction && !actionEl.dataset.luminaActions) {
            event.stopPropagation();
            return;
        }

        if (actionEl.dataset.luminaAction || actionEl.dataset.luminaActions) {
            event.preventDefault();
            await runLuminaActionsFromElement(actionEl, event);
        }
    });

    document.addEventListener('change', async (event) => {
        const el = event.target.closest('[data-lumina-change]');
        if (!el) return;
        const name = el.dataset.luminaChange;
        if (!name) return;
        await invokeLuminaAction(name, event, parseChangeArgs(el));
    });

    document.addEventListener('keydown', async (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const el = event.target.closest('[data-lumina-keydown]');
        if (!el) return;
        event.preventDefault();
        const name = el.dataset.luminaKeydown;
        if (!name) return;
        await invokeLuminaAction(name, event, buildLuminaCallArgs(el, event));
    });

    document.addEventListener('submit', async (event) => {
        const form = event.target.closest('form[data-lumina-submit]');
        if (!form) return;
        event.preventDefault();
        await invokeLuminaAction(form.dataset.luminaSubmit, event, ['__event__']);
    });
}

/** Build data-lumina-action attributes for template strings */
function luminaAction(name, opts = {}) {
    const parts = [];
    if (opts.actions) {
        parts.push(`data-lumina-actions='${JSON.stringify(opts.actions)}'`);
        if (opts.stop) parts.push('data-lumina-stop');
        return parts.join(' ');
    }
    parts.push(`data-lumina-action="${name}"`);
    if (opts.arg !== undefined) {
        const type = opts.type || (typeof opts.arg === 'number' ? 'number' : typeof opts.arg === 'boolean' ? 'boolean' : undefined);
        parts.push(`data-lumina-arg="${String(opts.arg).replace(/"/g, '&quot;')}"`);
        if (type) parts.push(`data-lumina-arg-type="${type}"`);
    }
    if (opts.argFrom) parts.push(`data-lumina-arg-from="${opts.argFrom}"`);
    if (opts.passEvent) parts.push('data-lumina-pass-event');
    if (opts.stop) parts.push('data-lumina-stop');
    return parts.join(' ');
}

function luminaChange(name, args) {
    const json = JSON.stringify(args).replace(/'/g, '&#39;');
    return `data-lumina-change="${name}" data-lumina-change-args='${json}'`;
}

function luminaKeydown(name, opts = {}) {
    const parts = [`data-lumina-keydown="${name}"`];
    if (opts.arg !== undefined) {
        parts.push(`data-lumina-arg="${String(opts.arg).replace(/"/g, '&quot;')}"`);
        if (opts.type) parts.push(`data-lumina-arg-type="${opts.type}"`);
    }
    if (opts.passEvent) parts.push('data-lumina-pass-event');
    return parts.join(' ');
}