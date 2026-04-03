// Utility functions for DOM querying, debouncing, and element utilities

// DOM querying function
function querySelector(selector) {
    return document.querySelector(selector);
}

function querySelectorAll(selectors) {
    return document.querySelectorAll(selectors);
}

// Debouncing function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const context = this;
        const later = () => {
            timeout = null;
            func.apply(context, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Element utilities
function addClass(element, className) {
    element.classList.add(className);
}

function removeClass(element, className) {
    element.classList.remove(className);
}

function toggleClass(element, className) {
    element.classList.toggle(className);
}

export { querySelector, querySelectorAll, debounce, addClass, removeClass, toggleClass };