import type { Database } from './database.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Leaderboard, PublicParticipant, RankedParticipant } from '../shared/leaderboard.js';
import { projectWeek } from './challengeSeed.js';
import { LEVEL_XP, progression, TIME_ZONE } from './progression.js';
import { finalizeDuel } from './duels.js';
import { obj } from './workoutSchema.js';
export const isDemoUser = async (db: Database, id: string) => !!(await db.prepare('SELECT 1 FROM demo_users WHERE user_id=?').get(id));
// Resolve overdue duels before aggregating. Their event time remains ends_at,
// even if the first ranking request arrives in a later week.
async function settle(db: Database, now: string) {
    (await db.transaction(async () => {
        const pending = (await db.prepare("SELECT id FROM duels WHERE state IN ('invited','accepted','waiting') AND ends_at<=?").all(now)) as {
            id: string;
        }[];
        for (const row of pending)
            (await finalizeDuel(db, row.id, now));
    }).immediate());
}
export async function leaderboard(db: Database, userId: string | null, period: 'week' | 'all', mode: 'regular' | 'demo', offset = 0, limit = 10, now = new Date()): Promise<Leaderboard> {
    return (await db.transaction(async () => {
        (await settle(db, now.toISOString()));
        const week = projectWeek(now), demo = Number(mode === 'demo');
        const cte = `WITH scores AS (
    SELECT u.id,u.nickname,u.avatar,EXISTS(SELECT 1 FROM demo_users d WHERE d.user_id=u.id) AS "isDemo",
      SUM(r.amount) AS points,
      1 + CAST((SELECT COALESCE(SUM(x.amount),0) FROM reward_ledger x WHERE x.user_id=u.id AND x.currency='xp') / ${LEVEL_XP} AS INTEGER) AS level
    FROM users u JOIN reward_ledger r ON r.user_id=u.id
    WHERE r.currency='competition_points' AND r.source_type IN ('challenge','duel')
      AND EXISTS(SELECT 1 FROM demo_users d WHERE d.user_id=u.id)=?
      ${period === 'week' ? 'AND r.event_at>=? AND r.event_at<?' : ''}
    GROUP BY u.id
  ), ranked AS (SELECT *, RANK() OVER (ORDER BY points DESC) AS rank FROM scores)`;
        const args = period === 'week' ? [demo, week.startsAt, week.endsAt] : [demo];
        const map = (row: RankedParticipant) => ({ ...row, isDemo: Boolean(row.isDemo) });
        const rows = ((await db.prepare(`${cte} SELECT * FROM ranked ORDER BY points DESC,id LIMIT ? OFFSET ?`).all(...args, limit, offset)) as RankedParticipant[]).map(map);
        const own = userId ? (await db.prepare(`${cte} SELECT * FROM ranked WHERE id=?`).get(...args, userId)) as RankedParticipant | undefined : undefined;
        const total = ((await db.prepare(`${cte} SELECT COUNT(*) AS n FROM ranked`).get(...args)) as {
            n: number;
        }).n;
        return { period, mode, startsAt: period === 'week' ? week.startsAt : null, endsAt: period === 'week' ? week.endsAt : null, timeZone: TIME_ZONE, total, offset, limit, rows, me: own ? map(own) : null };
    }).immediate());
}
export async function publicParticipant(db: Database, id: string): Promise<PublicParticipant | null> {
    const user = (await db.prepare('SELECT id,nickname,avatar FROM users WHERE id=?').get(id)) as {
        id: string;
        nickname: string;
        avatar: string;
    } | undefined;
    if (!user)
        return null;
    (await settle(db, new Date().toISOString()));
    const p = (await progression(db, id));
    const results = (await db.prepare("SELECT r.source_type AS kind,r.amount AS points,r.event_at AS \"eventAt\",\n    CASE WHEN r.source_type='challenge' THEN json_extract(c.snapshot_json,'$.title') ELSE 'Дуэль' END AS title,\n    CASE WHEN r.source_type='duel' THEN json_extract(e.receipt_json,'$.outcome') ELSE 'completed' END AS outcome\n    FROM reward_ledger r\n    LEFT JOIN challenge_participations c ON r.source_type='challenge' AND r.source_id=c.id\n    LEFT JOIN duel_events e ON r.source_type='duel' AND r.source_id=e.duel_id AND r.user_id=e.user_id\n    WHERE r.user_id=? AND r.currency='competition_points' AND r.source_type IN ('challenge','duel')\n    ORDER BY r.event_at DESC,r.id DESC LIMIT 10").all(id)) as PublicParticipant['results'];
    return { ...user, isDemo: (await isDemoUser(db, id)), level: p.level, points: p.competitionPoints,
        achievements: p.achievements.flatMap(a => a.earnedAt ? [{ id: a.id, title: a.title, earnedAt: a.earnedAt }] : []), results };
}
export function registerLeaderboard(app: FastifyInstance, db: Database, optionalUser: (req: FastifyRequest) => Promise<{ id: string } | undefined>, fail: (status: number, code: string, message: string) => never) {
    app.get<{
        Querystring: {
            period?: 'week' | 'all';
            mode?: 'regular' | 'demo';
            offset?: string;
        };
    }>('/api/leaderboard', {
        schema: { querystring: { ...obj({ period: { enum: ['week', 'all'] }, mode: { enum: ['regular', 'demo'] }, offset: { type: 'string', pattern: '^(0|[1-9][0-9]{0,6})$' } }), required: [] } },
    }, async (req) => (await leaderboard(db, (await optionalUser(req))?.id ?? null, req.query.period ?? 'week', req.query.mode ?? 'regular', Number(req.query.offset ?? 0))));
    app.get<{
        Params: {
            id: string;
        };
    }>('/api/participants/:id', { schema: { params: obj({ id: { type: 'string', minLength: 1, maxLength: 128 } }), querystring: obj({}) } }, async (req) => {
        const participant = (await publicParticipant(db, req.params.id));
        if (!participant)
            fail(404, 'NOT_FOUND', 'Участник не найден.');
        return { participant };
    });
}
