// Wrapper: mappa /api/calendar/busy → events.js handler
// La netlify.toml redirect fa: /api/* → /.netlify/functions/:splat
// Quindi /api/calendar/busy arriva qui.
const events = require('../events');
exports.handler = events.handler;
