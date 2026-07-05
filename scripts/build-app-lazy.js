process.env.LUMINA_LAZY = '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
require('./build-app.js');