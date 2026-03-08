const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { logError } = require('../logger');

const router = express.Router();
router.use(requireAuth);

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;

router.get('/search', async (req, res) => {
  if (!GIPHY_API_KEY) {
    return res.status(500).json({ error: 'Giphy API key not configured' });
  }
  try {
    const q = req.query.q || '';
    const offset = req.query.offset || 0;
    const limit = 20;
    const url = q
      ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&rating=pg-13`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&offset=${offset}&rating=pg-13`;
    const response = await fetch(url);
    const data = await response.json();
    const gifs = (data.data || []).map((g) => ({
      id: g.id,
      title: g.title,
      url: g.images.fixed_height.url,
      preview: g.images.fixed_height_small.url || g.images.fixed_height.url,
      width: g.images.fixed_height.width,
      height: g.images.fixed_height.height,
    }));
    res.json({ gifs });
  } catch (err) {
    const safeErr = new Error(err.message?.replace(/api_key=[^&]+/, 'api_key=REDACTED') || 'Giphy request failed');
    logError('giphy-search', safeErr);
    res.status(500).json({ error: 'Failed to search GIFs' });
  }
});

module.exports = router;
