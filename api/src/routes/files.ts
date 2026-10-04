import { Router, Request, Response } from 'express';
import { verifyJWT } from '../middleware/auth';
import { getFilePath, getFileMime } from '../services/fileGenerator';

const router = Router();

router.get('/files/:fileId', verifyJWT, (req: Request, res: Response) => {
  const fileId = String(req.params.fileId);
  const filePath = getFilePath(fileId);
  if (!filePath) { res.status(404).json({ error: 'File not found or expired' }); return; }

  const fileName = (typeof req.query.name === 'string' ? req.query.name : '') || `download${filePath.slice(filePath.lastIndexOf('.'))}`;
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('Content-Type', getFileMime(filePath));
  res.sendFile(filePath);
});

export default router;
