const express = require('express');
const router = express.Router();
const { protect } = require('./auth');
const User = require('./User');

const LIST_TYPES = ['watched', 'watching', 'planned', 'onhold', 'dropped'];

function getDefaultLists() {
  return {
    watched: [],
    watching: [],
    planned: [],
    onhold: [],
    dropped: []
  };
}

function normalizeLists(lists = {}) {
  const normalized = getDefaultLists();
  LIST_TYPES.forEach(type => {
    normalized[type] = Array.isArray(lists[type]) ? lists[type] : [];
  });
  return normalized;
}

function sanitizeMoviePayload(movie = {}) {
  const imdbId = movie.imdbId || movie.imdbID || movie.id;
  if (!imdbId) {
    return null;
  }

  return {
    imdbId,
    title: movie.title || movie.originalTitle || movie.name || 'Untitled',
    poster: movie.poster || movie.poster_path || movie.posterPath || '',
    releaseDate: movie.releaseDate || movie.release_date || movie.year || '',
    rating: typeof movie.vote_average === 'number'
      ? Number(movie.vote_average)
      : typeof movie.rating === 'number'
        ? Number(movie.rating)
        : null,
    runtime: movie.runtime || movie.runtimeMinutes || '',
    overview: movie.plot || movie.overview || '',
    addedAt: new Date()
  };
}

router.get('/', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('lists');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ lists: normalizeLists(user.lists) });
  } catch (error) {
    console.error('Failed to load lists:', error);
    res.status(500).json({ message: 'Failed to load lists' });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const { listType, movie } = req.body || {};
    if (!LIST_TYPES.includes(listType)) {
      return res.status(400).json({ message: 'Invalid list type' });
    }

    const normalizedMovie = sanitizeMoviePayload(movie);
    if (!normalizedMovie) {
      return res.status(400).json({ message: 'Movie payload must include an imdbId' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    LIST_TYPES.forEach(type => {
      user.lists[type] = user.lists[type].filter(
        item => item.imdbId !== normalizedMovie.imdbId
      );
    });

    user.lists[listType].unshift(normalizedMovie);
    await user.save();

    res.json({ lists: normalizeLists(user.lists) });
  } catch (error) {
    console.error('Failed to update list:', error);
    res.status(500).json({ message: 'Failed to update list' });
  }
});

router.delete('/:listType/:imdbId', protect, async (req, res) => {
  try {
    const { listType, imdbId } = req.params;
    if (!imdbId) {
      return res.status(400).json({ message: 'Movie id is required' });
    }

    if (listType !== 'all' && !LIST_TYPES.includes(listType)) {
      return res.status(400).json({ message: 'Invalid list type' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (listType === 'all') {
      LIST_TYPES.forEach(type => {
        user.lists[type] = user.lists[type].filter(item => item.imdbId !== imdbId);
      });
    } else {
      user.lists[listType] = user.lists[listType].filter(item => item.imdbId !== imdbId);
    }

    await user.save();
    res.json({ lists: normalizeLists(user.lists) });
  } catch (error) {
    console.error('Failed to remove list item:', error);
    res.status(500).json({ message: 'Failed to remove movie from list' });
  }
});

module.exports = router;

