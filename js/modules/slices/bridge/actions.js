/* Lumina: bridge/actions.js — delegated UI actions */

function parseLuminaArg(raw, type) {
    if (raw === undefined || raw === '') return undefined;
    if (type === 'number') return Number(raw);
    if (type === 'boolean') return raw === 'true';
    return raw;
}

async function invokeLuminaAction(name, event, args = []) {
    const fn = window[name];
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

    const args = [];
    if (el.dataset.luminaPassEvent !== undefined) {
        args.push('__event__');
    } else if (el.dataset.luminaArg !== undefined) {
        args.push(parseLuminaArg(el.dataset.luminaArg, el.dataset.luminaArgType));
    }
    await invokeLuminaAction(name, event, args);
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

    document.addEventListener('submit', async (event) => {
        const form = event.target.closest('form[data-lumina-submit]');
        if (!form) return;
        event.preventDefault();
        await invokeLuminaAction(form.dataset.luminaSubmit, event, ['__event__']);
    });
}