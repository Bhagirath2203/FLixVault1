const express = require('express');
const router = express.Router();
const { protect } = require('./auth');
const User = require('./User');

const LIST_TYPES = ['watched', 'watching', 'planned', 'onhold', 'dropped'];

// Helper function to extract year from release date
function extractYear(releaseDate) {
  if (!releaseDate) return null;
  const yearMatch = releaseDate.match(/\b(\d{4})\b/);
  return yearMatch ? parseInt(yearMatch[1]) : null;
}

// Helper function to extract runtime in minutes
function extractRuntimeMinutes(runtime) {
  if (!runtime) return 0;
  if (typeof runtime === 'number') return runtime;
  
  // Handle formats like "120 min", "2h 30min", "120"
  const minutesMatch = runtime.match(/(\d+)\s*min/i);
  if (minutesMatch) return parseInt(minutesMatch[1]);
  
  const hoursMatch = runtime.match(/(\d+)\s*h/i);
  const minsMatch = runtime.match(/(\d+)\s*m/i);
  
  let totalMinutes = 0;
  if (hoursMatch) totalMinutes += parseInt(hoursMatch[1]) * 60;
  if (minsMatch) totalMinutes += parseInt(minsMatch[1]);
  
  if (totalMinutes > 0) return totalMinutes;
  
  // If it's just a number, assume it's minutes
  const numMatch = runtime.match(/(\d+)/);
  return numMatch ? parseInt(numMatch[1]) : 0;
}

// Calculate statistics from user's movie lists
async function calculateStatistics(userId) {
  try {
    const user = await User.findById(userId).select('lists');
    if (!user) {
      throw new Error('User not found');
    }

    const allMovies = [];
    LIST_TYPES.forEach(type => {
      if (Array.isArray(user.lists[type])) {
        user.lists[type].forEach(movie => {
          allMovies.push({ ...movie, listType: type });
        });
      }
    });

    // Basic counts
    const totalMovies = allMovies.length;
    const watchedCount = user.lists.watched?.length || 0;
    const watchingCount = user.lists.watching?.length || 0;
    const plannedCount = user.lists.planned?.length || 0;
    const onholdCount = user.lists.onhold?.length || 0;
    const droppedCount = user.lists.dropped?.length || 0;

    // Calculate total watch time (from watched list)
    const watchedMovies = user.lists.watched || [];
    let totalWatchTime = 0;
    watchedMovies.forEach(movie => {
      totalWatchTime += extractRuntimeMinutes(movie.runtime);
    });

    // Average rating
    const moviesWithRatings = allMovies.filter(m => m.rating && typeof m.rating === 'number');
    const averageRating = moviesWithRatings.length > 0
      ? moviesWithRatings.reduce((sum, m) => sum + m.rating, 0) / moviesWithRatings.length
      : 0;

    // Year distribution
    const yearDistribution = {};
    allMovies.forEach(movie => {
      const year = extractYear(movie.releaseDate);
      if (year) {
        yearDistribution[year] = (yearDistribution[year] || 0) + 1;
      }
    });

    // Decade distribution
    const decadeDistribution = {};
    Object.keys(yearDistribution).forEach(year => {
      const decade = Math.floor(parseInt(year) / 10) * 10;
      decadeDistribution[decade] = (decadeDistribution[decade] || 0) + yearDistribution[year];
    });

    // Movies by month (when added)
    const monthlyDistribution = {};
    allMovies.forEach(movie => {
      if (movie.addedAt) {
        const date = new Date(movie.addedAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyDistribution[monthKey] = (monthlyDistribution[monthKey] || 0) + 1;
      }
    });

    // Movies added this month
    const currentMonth = new Date().toISOString().slice(0, 7);
    const moviesThisMonth = monthlyDistribution[currentMonth] || 0;

    // Movies added this year
    const currentYear = new Date().getFullYear();
    const moviesThisYear = Object.keys(monthlyDistribution)
      .filter(key => key.startsWith(currentYear.toString()))
      .reduce((sum, key) => sum + monthlyDistribution[key], 0);

    // Rating distribution
    const ratingDistribution = {
      '9+': 0,
      '8-9': 0,
      '7-8': 0,
      '6-7': 0,
      '5-6': 0,
      '<5': 0
    };
    moviesWithRatings.forEach(movie => {
      const rating = movie.rating;
      if (rating >= 9) ratingDistribution['9+']++;
      else if (rating >= 8) ratingDistribution['8-9']++;
      else if (rating >= 7) ratingDistribution['7-8']++;
      else if (rating >= 6) ratingDistribution['6-7']++;
      else if (rating >= 5) ratingDistribution['5-6']++;
      else ratingDistribution['<5']++;
    });

    // List distribution
    const listDistribution = {
      watched: watchedCount,
      watching: watchingCount,
      planned: plannedCount,
      onhold: onholdCount,
      dropped: droppedCount
    };

    // Most common years
    const sortedYears = Object.entries(yearDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([year, count]) => ({ year: parseInt(year), count }));

    // Most common decades
    const sortedDecades = Object.entries(decadeDistribution)
      .sort((a, b) => b[1] - a[1])
      .map(([decade, count]) => ({ decade: parseInt(decade), count }));

    // Average runtime
    const moviesWithRuntime = allMovies.filter(m => m.runtime);
    const totalRuntime = moviesWithRuntime.reduce((sum, m) => sum + extractRuntimeMinutes(m.runtime), 0);
    const averageRuntime = moviesWithRuntime.length > 0
      ? totalRuntime / moviesWithRuntime.length
      : 0;

    // Account age
    const accountAge = user.createdAt ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0;

    return {
      overview: {
        totalMovies,
        watchedCount,
        watchingCount,
        plannedCount,
        onholdCount,
        droppedCount,
        totalWatchTime: Math.round(totalWatchTime),
        averageRating: averageRating.toFixed(1),
        averageRuntime: Math.round(averageRuntime),
        moviesThisMonth,
        moviesThisYear,
        accountAge
      },
      distributions: {
        yearDistribution,
        decadeDistribution,
        monthlyDistribution,
        ratingDistribution,
        listDistribution
      },
      topStats: {
        mostCommonYears: sortedYears,
        mostCommonDecades: sortedDecades
      }
    };
  } catch (error) {
    console.error('Error calculating statistics:', error);
    throw error;
  }
}

// GET /api/stats - Get user statistics
router.get('/', protect, async (req, res) => {
  try {
    const stats = await calculateStatistics(req.user._id);
    res.json(stats);
  } catch (error) {
    console.error('Failed to load statistics:', error);
    res.status(500).json({ message: 'Failed to load statistics', error: error.message });
  }
});

module.exports = router;

