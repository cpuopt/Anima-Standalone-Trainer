const path = require('path');

// Explicit legacy paths remain supported; an unconfigured installation never
// silently borrows the application's old root venv.
function environmentPath(root, config = {}, nativePath = value => value) {
  return require('./environment-manager').environmentPath(root, 'anima-lumina', config, nativePath);
}

module.exports = { environmentPath };
