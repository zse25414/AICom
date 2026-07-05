/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './lumina-ai.html',
        './js/**/*.js'
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'Noto Sans TC', 'system-ui', 'sans-serif']
            }
        }
    },
    plugins: []
};