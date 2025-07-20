/**
 * Configuration Index
 * Combines all config modules into a single export
 */

const api = require('./api');
const database = require('./database');

module.exports = {
  api,
  database
}; 