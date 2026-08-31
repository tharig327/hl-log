'use strict';
// Photo upload/serve routes — merged from the standalone photo server.
// Same endpoints (/ping, /upload, /photo/:f, /rename) so the UI keeps working,
// now same-origin on the FloorSync server (no ngrok, no CORS).

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PHOTO_DIR = process.env.PHOTO_DIR || 'Z:\\FloorSync\\Photos';
const MAX_FILE_SIZE_MB = 10;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

let photosAvailable = false;
try {
  if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });
  photosAvailable = true;
} catch (e) {
  console.error(`[photos] disabled — photo directory unavailable (${PHOTO_DIR}): ${e.message}`);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PHOTO_DIR),
  filename: (req, file, cb) => {
    const ticketId = (req.body.ticketId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${ticketId}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    ALLOWED_TYPES.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  },
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 }
});

const sanitize = s => String(s || '').replace(/[^a-zA-Z0-9_\-\.]/g, '');

function registerPhotoRoutes(app) {
  app.get('/ping', (req, res) => {
    res.json({ ok: photosAvailable, dir: PHOTO_DIR });
  });

  app.post('/upload', (req, res) => {
    if (!photosAvailable) return res.status(503).json({ success: false, error: 'Photo storage unavailable.' });
    upload.single('photo')(req, res, err => {
      if (err) {
        const status = String(err.message).includes('File too large') ? 413 : 400;
        return res.status(status).json({ success: false, error: err.message });
      }
      if (!req.file) return res.status(400).json({ success: false, error: 'No file received.' });
      console.log(`[photos] upload ${req.file.filename} (${(req.file.size / 1024).toFixed(1)} KB) — ticket: ${req.body.ticketId || 'unknown'}`);
      res.json({ success: true, filename: req.file.filename });
    });
  });

  app.get('/photo/:filename', (req, res) => {
    const filepath = path.join(PHOTO_DIR, sanitize(req.params.filename));
    if (!photosAvailable || !fs.existsSync(filepath)) return res.status(404).json({ success: false, error: 'Not found.' });
    res.sendFile(filepath);
  });

  app.delete('/photo/:filename', (req, res) => {
    const filename = sanitize(req.params.filename);
    const filepath = path.join(PHOTO_DIR, filename);
    if (!photosAvailable || !fs.existsSync(filepath)) return res.status(404).json({ success: false, error: 'File not found.' });
    fs.unlink(filepath, err => {
      if (err) return res.status(500).json({ success: false, error: 'Could not delete file.' });
      console.log(`[photos] deleted ${filename}`);
      res.json({ success: true, filename });
    });
  });

  app.post('/rename', (req, res) => {
    const oldName = sanitize(req.body.oldName);
    const newName = sanitize(req.body.newName);
    if (!oldName || !newName) return res.status(400).json({ success: false, error: 'Missing names.' });
    const oldPath = path.join(PHOTO_DIR, oldName);
    const newPath = path.join(PHOTO_DIR, newName);
    if (!photosAvailable || !fs.existsSync(oldPath)) return res.status(404).json({ success: false, error: 'File not found.' });
    fs.rename(oldPath, newPath, err => {
      if (err) return res.status(500).json({ success: false, error: 'Rename failed.' });
      console.log(`[photos] renamed ${oldName} -> ${newName}`);
      res.json({ success: true, newName });
    });
  });

  console.log(photosAvailable
    ? `[photos] serving photos from ${PHOTO_DIR}`
    : '[photos] routes registered but storage unavailable');
}

module.exports = { registerPhotoRoutes };
