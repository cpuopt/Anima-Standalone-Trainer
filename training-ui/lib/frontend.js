const fs = require('fs');
const path = require('path');
const express = require('express');

function mountFrontend(app, directory = path.join(__dirname, '..', 'frontend', 'dist')) {
    app.get(/^\/$/, (req, res) => res.redirect(302, '/ui/'));
    app.get(/^\/ui$/, (req, res) => res.redirect(302, '/ui/'));
    app.use('/ui', express.static(directory, { index: false, maxAge: 0 }));
    app.get(['/ui/', '/ui/*'], (req, res, next) => {
        // Missing assets must remain 404 instead of returning HTML to a script request.
        if (path.extname(req.path)) return next();
        const index = path.join(directory, 'index.html');
        if (!fs.existsSync(index)) {
            return res.status(503).type('text').send('Vue UI is not built. Run npm run build in training-ui.');
        }
        res.set('Cache-Control', 'no-store');
        res.sendFile(index);
    });
}
module.exports = { mountFrontend };
