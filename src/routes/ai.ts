import { Router, Request, Response } from 'express';
import { clearUserHistory, getUserHistory, getActiveConversationsCount } from '../services/openaiService';

const router = Router();

// Get AI service status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const activeConversations = await getActiveConversationsCount();
    
    res.json({
      status: 'success',
      data: {
        activeConversations,
        service: 'OpenAI GPT-3.5-turbo',
        currency: 'FCFA'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to get AI service status'
    });
  }
});

// Clear conversation history for a specific user
router.delete('/conversation/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required'
      });
    }
    
    await clearUserHistory(userId);
    
    return res.json({
      status: 'success',
      message: `Conversation history cleared for user: ${userId}`,
      currency: 'FCFA'
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Failed to clear conversation history'
    });
  }
});

// Get conversation history for a specific user
router.get('/conversation/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required'
      });
    }
    
    const history = await getUserHistory(userId);
    
    return res.json({
      status: 'success',
      data: {
        userId,
        messageCount: history.length,
        history, // No need to filter out 'system' role
        currency: 'FCFA'
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Failed to get conversation history'
    });
  }
});

export default router; 