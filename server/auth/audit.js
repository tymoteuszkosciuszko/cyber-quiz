// Audyt zdarzeń bezpieczeństwa (OWASP ASVS V7)

export function normalizeClientIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return null;
  let ip = rawIp.split(',')[0].trim();
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  // Prosta walidacja przed zapisem do typu INET w PostgreSQL
  if (/^[0-9a-fA-F:.]+$/.test(ip)) {
    return ip;
  }
  return null;
}

export function extractReqMeta(req) {
  const rawIp =
    req.ip ||
    req.headers?.['x-forwarded-for'] ||
    req.socket?.remoteAddress ||
    null;
  return {
    ip: normalizeClientIp(rawIp),
    userAgent: req.headers?.['user-agent']
      ? String(req.headers['user-agent']).slice(0, 300)
      : null,
  };
}

export async function logAudit(
  pool,
  {
    actorId = null,
    actorName = null,
    eventType,
    targetId = null,
    ip = null,
    userAgent = null,
    status = 'SUCCESS',
    metadata = null,
  }
) {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (actor_id, actor_name, event_type, target_id, ip_address, user_agent, status, metadata)
       VALUES ($1, $2, $3, $4, $5::inet, $6, $7, $8::jsonb)`,
      [
        actorId,
        actorName,
        eventType,
        targetId ? String(targetId) : null,
        normalizeClientIp(ip),
        userAgent ? String(userAgent).slice(0, 300) : null,
        status === 'FAILURE' ? 'FAILURE' : 'SUCCESS',
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (err) {
    console.error('[AUDIT_LOG_ERROR]', err.message);
  }
}

export async function listAuditLogs(
  pool,
  { limit = 50, offset = 0, eventType = '', status = '', actor = '' } = {}
) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const where = [];
  const params = [];

  if (eventType) {
    params.push(eventType);
    where.push(`event_type = $${params.length}`);
  }
  if (status === 'SUCCESS' || status === 'FAILURE') {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (actor) {
    params.push(`%${actor.trim()}%`);
    where.push(`actor_name ILIKE $${params.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM audit_logs ${whereSql}`,
    params
  );

  params.push(safeLimit, safeOffset);
  const { rows } = await pool.query(
    `SELECT id, created_at, actor_id, actor_name, event_type, target_id,
            host(ip_address) AS ip_address, user_agent, status, metadata
     FROM audit_logs
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    total: countRes.rows[0]?.total || 0,
    limit: safeLimit,
    offset: safeOffset,
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      actorId: r.actor_id,
      actorName: r.actor_name,
      eventType: r.event_type,
      targetId: r.target_id,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      status: r.status,
      metadata: r.metadata,
    })),
  };
}

