const fs = require('fs');
const path = require('path');
const express = require('express');

function mountFrontend(app, directory = path.join(__dirname, '..', 'frontend', 'dist'), legacyDirectory = path.join(__dirname, '..', 'public')) {
    app.get(/^\/$/, (req, res) => res.redirect(302, process.env.TRAINER_UI !== 'legacy' && fs.existsSync(path.join(directory, 'index.html')) ? '/ui/' : '/legacy/'));
    app.use('/legacy', express.static(legacyDirectory));
    app.get(/^\/ui$/, (req, res) => res.redirect(302, '/ui/'));
    app.use('/ui', express.static(directory, { index: false, maxAge: 0 }));
    app.get(['/ui/', '/ui/*'], (req, res, next) => {
        // Missing assets must remain 404 instead of returning HTML to a script request.
        if (path.extname(req.path)) return next();
        const index = path.join(directory, 'index.html');
        if (!fs.existsSync(index)) {
            return res.status(503).type('text').send('Vue UI is not built. Run npm run build in training-ui, or use the legacy UI at /legacy/.');
        }
        res.set('Cache-Control', 'no-store');
        res.sendFile(index);
    });
}
module.exports = { mountFrontend };
