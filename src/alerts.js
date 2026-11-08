// Telegram alerts: prop-rule warnings, a daily summary and a weekly summary.
// Pages Functions have no timer, so summaries are sent by the first connector upload after the
// chosen hour (any terminal sends at least once a minute while it runs). Each alert is sent once.

import { all, first, run, getSettings } from './db.js';
import { loadPropStatus } from './prop.js';
import { resolveScope, loadIdeas } from './ideas.js';
import { summary } from './stats.js';
import { bneDay, bneDayStart, addDays, bneParts } from './time.js';

const money = (v) => (v < 0 ? '−' : v > 0 ? '+' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rr = (v) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + 'R');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendTelegram(env, chatId, html) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set (see README → Alerts)');
  if (!chatId) throw new Error('No Telegram chat yet: message your bot, then press “Find my chat”');
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error('Telegram: ' + (j.description || res.status));
  return true;
}

/** The chat that most recently messaged the bot (the user presses Start on it first). */
export async function findChat(env) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set (see README → Alerts)');
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`);
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error('Telegram: ' + (j.description || res.status));
  const msgs = (j.result || []).map((u) => u.message || u.edited_message).filter(Boolean);
  if (!msgs.length) throw new Error('No messages found. Open your bot in Telegram, press Start (or send “hi”), then try again.');
  const m = msgs[msgs.length - 1];
  return { id: String(m.chat.id), name: m.chat.username || m.chat.first_name || m.chat.title || 'chat' };
}

async function once(db, key, now) {
  const r = await run(db, 'INSERT OR IGNORE INTO alerts_sent (key, time) VALUES (?, ?)', key, now);
  return r.meta.changes === 1;
}

const LEVEL_TEXT = { warn: 'Warning', danger: 'Danger', breached: 'LIMIT REACHED' };

export function ruleText(st, rule) {
  return `<b>${LEVEL_TEXT[rule.level]}: ${esc(st.name)}</b>\n${esc(rule.label)}: ${rule.pct.toFixed(0)}% used\n` +
    `Used ${money(-rule.used)} of ${money(rule.limit).replace('+', '')} · room ${money(rule.room).replace('+', '')}\n` +
    `Equity ${money(st.equity).replace('+', '')} · floor ${money(rule.floor).replace('+', '')}\n` +
    `<i>The journal only warns. Risk Guard Rail and the copier enforce your limits.</i>`;
}

/** Text summary of closed ideas in [from, to) for all real accounts. */
export async function summaryText(db, title, from, to) {
  const scope = await resolveScope(db, 0, {});
  const ideas = (await loadIdeas(db, { sample: 0, scope, from, to, includeOpen: false })).sort((a, b) => a.close_time - b.close_time);
  const s = summary(ideas);
  if (!ideas.length) return `<b>${esc(title)}</b>\nNo closed trades.`;
  const byAcct = {};
  for (const i of ideas) for (const a of i.accounts) byAcct[a.name] = (byAcct[a.name] || 0) + a.net;
  const best = [...ideas].sort((a, b) => (b.r ?? -99) - (a.r ?? -99))[0];
  const worst = [...ideas].sort((a, b) => (a.r ?? 99) - (b.r ?? 99))[0];
  const costs = s.commission + s.swap + s.fee;
  return `<b>${esc(title)}</b>\n` +
    `Net ${money(s.totalNet)} · ${s.count} idea${s.count > 1 ? 's' : ''} · ${s.wins}W ${s.losses}L` +
    (s.winRate != null ? ` · win rate ${Math.round(s.winRate * 100)}%` : '') + `\n` +
    `Expectancy ${rr(s.expectancyR)}` + (s.profitFactorInfinite ? ' · PF ∞' : s.profitFactor != null ? ` · PF ${s.profitFactor.toFixed(2)}` : '') +
    (costs ? ` · costs ${money(costs)}` : '') + `\n` +
    Object.entries(byAcct).map(([n, v]) => `${esc(n)} ${money(v)}`).join('\n') + `\n` +
    `Best: ${esc(best.symbol)} ${best.direction} ${rr(best.r)} (${money(best.net)})\n` +
    `Worst: ${esc(worst.symbol)} ${worst.direction} ${rr(worst.r)} (${money(worst.net)})`;
}

const fmtDay = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Called (in the background) after each connector upload. */
export async function afterUpload(env, db, accountId, now = Date.now()) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const set = (await getSettings(db)).raw;
  const chat = set.telegram_chat_id;
  if (!chat) return;

  // 1. prop-rule warnings for this account, once per level per firm day
  if (set.alert_rules !== '0') {
    const acct = await first(db, 'SELECT * FROM accounts WHERE id = ? AND is_sample = 0', accountId);
    if (acct) {
      const [st] = await loadPropStatus(db, [acct], Number(set.warn_pct) || 70, now);
      for (const rule of st.rules || []) {
        if (rule.level === 'ok') continue;
        const key = `rule:${acct.id}:${rule.key}:${st.reset}:${rule.level}`;
        if (await once(db, key, now)) await sendTelegram(env, chat, ruleText(st, rule)).catch((e) => console.error(e));
      }
    }
  }

  const today = bneDay(now);
  const { hour, weekday } = bneParts(now);
  const at = Number(set.alert_daily_hour ?? 7);

  // 2. daily summary of yesterday (Brisbane), after the chosen hour; not for Sundays and Mondays (no session the day before)
  if (set.alert_daily !== '0' && hour >= at) {
    const y = addDays(today, -1);
    const yw = bneParts(bneDayStart(y) + 12 * 3600000).weekday;
    if (yw >= 1 && yw <= 6 && await once(db, 'daily:' + y, now)) {
      const text = await summaryText(db, 'Trade Journal · ' + fmtDay(y), bneDayStart(y), bneDayStart(today));
      await sendTelegram(env, chat, text).catch((e) => console.error(e));
    }
  }

  // 3. weekly summary (Monday to Saturday morning), from Saturday at the chosen hour
  if (set.alert_weekly !== '0') {
    const back = (weekday + 1) % 7;               // days since the last Saturday (0 on Saturday)
    const sat = addDays(today, -back);
    const due = back > 0 || hour >= at;
    const monday = addDays(sat, -5);
    if (due && await once(db, 'weekly:' + monday, now)) {
      const text = await summaryText(db, `Week ${fmtDay(monday)} – ${fmtDay(addDays(sat, -1))}`, bneDayStart(monday), bneDayStart(sat) + at * 3600000);
      await sendTelegram(env, chat, text).catch((e) => console.error(e));
    }
  }
}
