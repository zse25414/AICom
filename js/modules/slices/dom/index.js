/* Lumina: dom/index.js */
function $(id) {
    return document.getElementById(id);
}

function setElText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setElHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function setElStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
}

// Update dashboard numbers and lists
