const handler = require('../server.js');

module.exports = (req, res) => {
  console.log('VERCEL REQUEST:', req.method, req.url);
  return handler(req, res);
};