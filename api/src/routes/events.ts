import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { verifyJWT, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { logEvent, EventPayload } from '../services/eventService';
import { isUuid } from '../services/eventPayload';
import { anonymizeRow, getExportSalt } from '../services/anonymizer';
import { ensureSpaceAccess } from '../services/accessControl';
import rateLimit from 'express-rate-limit';
import { rateLimitKey } from '../middleware/rateLimitKey';

const router = Router();

const eventRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many events submitted' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

// POST /api/events - batch submit events from frontend
router.post('/', verifyJWT, eventRateLimit, async (req: Request, res: Response) => {
  // Support both { events: [...] } wrapper and raw array/object formats
  const rawEvents = req.body.events ?? req.body;
  const events: Partial<EventPayload>[] = Array.isArray(rawEvents) ? rawEvents : [rawEvents];

  if (events.length === 0) {
    res.json({ ok: true, queued: 0 });
    return;
  }
  if (events.length > 50) {
    throw new ApiError(400, 'Maximum 50 events per batch');
  }

  // Stamp actor info from the verified JWT (cannot be spoofed by client)
  for (const event of events) {
    if (!event.event_type || !event.object_type || !event.object_id || !event.space_id) {
      throw new ApiError(400, `Missing required event fields: event_type, object_type, object_id, space_id`);
    }
    if (!isUuid(event.space_id)) {
      throw new ApiError(400, 'space_id must be a valid UUID');
    }
    // Events feed the research datasets (LSA/SNA/temporal). Without this check
    // any student can inject events into any space and corrupt the analyses.
    await ensureSpaceAccess(event.space_id, req.user!);

    logEvent({
      ...(event as EventPayload),
      actor_id: req.user!.id,
      actor_role: req.user!.role,
      session_id: event.session_id ?? (req.headers['x-session-id'] as string),
      client_version: event.client_version ?? (req.headers['x-client-version'] as string),
    });
  }

  res.json({ ok: true, queued: events.length });
});

// GET /api/events - query events (teacher/admin/researcher)
router.get('/', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const {
    space_id,
    event_type,
    actor_id,
    from,
    to,
    limit = '200',
    offset = '0',
  } = req.query;

  // space_id is mandatory: it is the only thing scoping this query, so omitting
  // it would page through every space on the platform.
  if (!space_id || typeof space_id !== 'string') {
    throw new ApiError(400, 'space_id is required');
  }
  await ensureSpaceAccess(space_id, req.user!);

  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  let query = supabase
    .from('events')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  query = query.eq('space_id', space_id);
  if (event_type) query = query.eq('event_type', event_type);
  if (actor_id) query = query.eq('actor_id', actor_id);
  if (from) query = query.gte('created_at', from as string);
  if (to) query = query.lte('created_at', to as string);

  const { data, count, error } = await query;
  if (error) throw new ApiError(500, error.message);

  res.json({ events: data, total: count });
});

// POST /api/events/export - generate CSV/JSON export (teacher/admin), supports anonymize flag
router.post('/export', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { space_id, from, to, format = 'json', anonymize = false } = req.body;
  if (!space_id) throw new ApiError(400, 'space_id is required');

  let query = supabase
    .from('events')
    .select('*')
    .eq('space_id', space_id)
    .order('created_at', { ascending: true });

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error) throw new ApiError(500, error.message);

  let rows = data ?? [];
  if (anonymize && rows.length > 0) {
    const salt = await getExportSalt(space_id);
    rows = rows.map(row => anonymizeRow(row, salt, ['actor_id', 'user_id'], ['session_id']));
  }

  if (format === 'csv') {
    if (rows.length === 0) {
      res.status(200).send('');
      return;
    }
    const headers = Object.keys(rows[0]).join(',');
    const csvRows = rows.map((row) =>
      Object.values(row)
        .map((v) => (typeof v === 'object' ? JSON.stringify(v) : v))
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="events_${space_id}.csv"`);
    res.send([headers, ...csvRows].join('\n'));
    return;
  }

  res.json({ events: rows, total: rows.length });
});

// POST /api/events/export/network - export knowledge network as JSON or GEXF (teacher/admin), supports anonymize flag
router.post('/export/network', verifyJWT, requireRole('teacher', 'admin'), async (req: Request, res: Response) => {
  const { space_id, format = 'json', anonymize = false } = req.body;
  if (!space_id) throw new ApiError(400, 'space_id is required');

  // Fetch notes in the space
  const { data: notes, error: notesError } = await supabase
    .from('notes')
    .select('id, title, author_id, type, created_at, users!author_id(name)')
    .eq('space_id', space_id)
    .is('deleted_at', null);

  if (notesError) throw new ApiError(500, notesError.message);

  const noteIds = (notes ?? []).map(n => n.id);
  if (noteIds.length === 0) {
    if (format === 'gexf') {
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="network_${space_id}.gexf"`);
      res.send('<?xml version="1.0" encoding="UTF-8"?><gexf xmlns="http://gexf.net/1.3"><graph defaultedgetype="directed"></graph></gexf>');
      return;
    }
    res.json({ nodes: [], edges: [] });
    return;
  }

  // Fetch relations between these notes
  const { data: relations, error: relError } = await supabase
    .from('relations')
    .select('id, source_note_id, target_note_id, relation_type, creator_id, created_at')
    .or(`source_note_id.in.(${noteIds.join(',')}),target_note_id.in.(${noteIds.join(',')})`);

  if (relError) throw new ApiError(500, relError.message);

  // Fetch metrics for these notes
  const { data: metrics } = await supabase
    .from('note_metrics_realtime')
    .select('*')
    .in('note_id', noteIds);

  const metricsMap: Record<string, any> = {};
  for (const m of metrics ?? []) {
    metricsMap[m.note_id] = m;
  }

  if (format === 'gexf') {
    // Generate GEXF XML for Gephi / SNA tools
    const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] ?? c));

    let gexf = '<?xml version="1.0" encoding="UTF-8"?>\n';
    gexf += '<gexf xmlns="http://gexf.net/1.3" version="1.3">\n';
    gexf += '  <meta><creator>HAKCC</creator></meta>\n';
    gexf += '  <graph defaultedgetype="directed">\n';

    // Node attributes
    gexf += '    <attributes class="node" mode="static">\n';
    gexf += '      <attribute id="0" title="author" type="string"/>\n';
    gexf += '      <attribute id="1" title="type" type="string"/>\n';
    gexf += '      <attribute id="2" title="heat_score" type="float"/>\n';
    gexf += '      <attribute id="3" title="build_on_count" type="integer"/>\n';
    gexf += '    </attributes>\n';

    // Edge attributes
    gexf += '    <attributes class="edge" mode="static">\n';
    gexf += '      <attribute id="0" title="relation_type" type="string"/>\n';
    gexf += '    </attributes>\n';

    // Nodes
    gexf += '    <nodes>\n';
    for (const note of notes ?? []) {
      const m = metricsMap[note.id];
      const authorName = (note.users as any)?.name ?? '';
      gexf += `      <node id="${note.id}" label="${escapeXml(note.title)}">\n`;
      gexf += '        <attvalues>\n';
      gexf += `          <attvalue for="0" value="${escapeXml(authorName)}"/>\n`;
      gexf += `          <attvalue for="1" value="${note.type}"/>\n`;
      gexf += `          <attvalue for="2" value="${m?.heat_score ?? 0}"/>\n`;
      gexf += `          <attvalue for="3" value="${m?.build_on_count ?? 0}"/>\n`;
      gexf += '        </attvalues>\n';
      gexf += '      </node>\n';
    }
    gexf += '    </nodes>\n';

    // Edges
    gexf += '    <edges>\n';
    for (const rel of relations ?? []) {
      gexf += `      <edge id="${rel.id}" source="${rel.source_note_id}" target="${rel.target_note_id}">\n`;
      gexf += '        <attvalues>\n';
      gexf += `          <attvalue for="0" value="${rel.relation_type}"/>\n`;
      gexf += '        </attvalues>\n';
      gexf += '      </edge>\n';
    }
    gexf += '    </edges>\n';

    gexf += '  </graph>\n</gexf>';

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="network_${space_id}.gexf"`);
    res.send(gexf);
    return;
  }

  // Default: JSON network format
  const exportSalt = anonymize ? await getExportSalt(space_id) : '';
  const nodes = (notes ?? []).map(n => ({
    id: n.id,
    title: n.title,
    authorId: anonymize ? anonymizeRow({ id: n.author_id }, exportSalt, ['id'], []).id : n.author_id,
    authorName: anonymize ? undefined : ((n.users as any)?.name ?? ''),
    type: n.type,
    createdAt: n.created_at,
    metrics: metricsMap[n.id] ? {
      heatScore: metricsMap[n.id].heat_score,
      buildOnCount: metricsMap[n.id].build_on_count,
      challengeCount: metricsMap[n.id].challenge_count,
      evidenceCount: metricsMap[n.id].evidence_count,
      synthesisCount: metricsMap[n.id].synthesis_count,
      uniqueContributorCount: metricsMap[n.id].unique_contributor_count,
      directInDegree: metricsMap[n.id].direct_in_degree,
      directOutDegree: metricsMap[n.id].direct_out_degree,
    } : null,
  }));

  const edges = (relations ?? []).map(r => ({
    id: r.id,
    source: r.source_note_id,
    target: r.target_note_id,
    relationType: r.relation_type,
    creatorId: anonymize ? anonymizeRow({ id: r.creator_id }, exportSalt, ['id'], []).id : r.creator_id,
    createdAt: r.created_at,
  }));

  res.json({ nodes, edges });
});

export default router;
