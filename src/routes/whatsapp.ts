import { Router, Request, Response } from 'express';
import { sendWhatsAppMessage, getClientStatus, hasValidSession } from '../services/whatsappService';

const router = Router();

// Get WhatsApp status
router.get('/status', (req: Request, res: Response) => {
  res.json({
    status: 'success',
    data: {
      clientStatus: getClientStatus(),
      hasSession: hasValidSession(),
      timestamp: new Date().toISOString()
    }
  });
});

// Send WhatsApp message
router.post('/send', async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, message } = req.body;
    
    if (!to || !message) {
      res.status(400).json({
        status: 'error',
        message: 'Phone number (to) and message are required'
      });
      return;
    }

    // Format phone number (remove + if present and add country code if needed)
    let formattedNumber = to.replace('+', '');
    if (!formattedNumber.includes('@c.us')) {
      formattedNumber += '@c.us';
    }

    const result = await sendWhatsAppMessage(formattedNumber, message);
    
    res.json({
      status: 'success',
      message: 'Message sent successfully',
      data: {
        messageId: result.id._serialized,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to send message'
    });
  }
});

export default router; 