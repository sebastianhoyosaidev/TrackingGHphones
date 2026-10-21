// Portable npm start entry point: sets production mode without shell-specific
// environment assignment syntax, so it works in Windows, macOS, and Linux.
process.env.NODE_ENV = 'production';
require('./server.js');
