import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';

const router = Router();

// GET /api/notifications — list current user's notifications (unread first, max 50)
router.get('/', verifyJWT, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { unread_only } = req.query;

  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (unread_only === 'true') {
    query = query.eq('read', false);
  }

  const { data, error } = await query;
  if (error) throw new ApiError(500, error.message);

  res.json({ notifications: data ?? [] });
});

// PATCH /api/notifications/read-all — mark all notifications as read
router.patch('/read-all', verifyJWT, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);

  if (error) throw new ApiError(500, error.message);
  res.json({ message: 'All notifications marked as read' });
});

// PATCH /api/notifications/:id/read — mark one notification as read
router.patch('/:id/read', verifyJWT, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data, error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Notification not found');

  res.json({ notification: data });
});

// POST /api/notifications — create a notification (teacher/admin only).
// Previously any authenticated user could push arbitrary notifications (incl.
// type:'teacher') to any user_id; restricted to staff to stop spoofing/spam.
router.post('/', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { user_id, type, title, message, link_type, link_id } = req.body;
  if (!user_id || !type || !title || !message) {
    throw new ApiError(400, 'user_id, type, title, message are required');
  }

  const { data, error } = await supabase
    .from('notifications')
    .insert({ user_id, type, title, message, link_type, link_id })
    .select()
    .single();

  if (error) throw new ApiError(500, error.message);
  res.status(201).json({ notification: data });
});

export default router;
