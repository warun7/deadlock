import { Router } from 'express';
import { redisService } from '../services/RedisService';

const router = Router();

/**
 * Admin endpoint to clear a specific match
 * GET /admin/clear-match/:matchId
 */
router.get('/clear-match/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    
    await redisService.deleteMatch(matchId);
    
    res.json({
      success: true,
      message: `Match ${matchId} cleared`,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Admin endpoint to clear ALL matches
 * GET /admin/clear-all-matches
 */
router.get('/clear-all-matches', async (req, res) => {
  try {
    const client = redisService.getClient();
    
    // Get all match keys
    const keys = await client.keys('match:*');
    const userMatchKeys = await client.keys('user:*:match');
    
    // Delete all
    if (keys.length > 0) {
      await client.del(...keys);
    }
    if (userMatchKeys.length > 0) {
      await client.del(...userMatchKeys);
    }
    
    res.json({
      success: true,
      message: `Cleared ${keys.length} matches and ${userMatchKeys.length} user mappings`,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Admin endpoint to view all active matches
 * GET /admin/matches
 */
router.get('/matches', async (req, res) => {
  try {
    const client = redisService.getClient();
    const keys = await client.keys('match:*');
    
    const matches = [];
    for (const key of keys) {
      const match = await client.hgetall(key);
      matches.push({
        id: key.replace('match:', ''),
        ...match,
      });
    }
    
    res.json({
      success: true,
      count: matches.length,
      matches,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
