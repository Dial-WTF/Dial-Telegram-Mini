const DEBUG = process.env.DEBUG_BOT === '1';
const DRY = process.env.BOT_DRY_RUN === '1';

async function call(method: string, payload: any): Promise<any> {
  if (DRY) {
    try { console.log(`[BOT_DRY_RUN] ${method}`, payload); } catch {}
    return { ok: true, result: { message_id: 1 } } as any;
  }
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  let json: any = { ok: res.ok };
  try { json = await res.json(); } catch {}
  if (DEBUG) {
    try { console.log(`[TG] ${method} ->`, json); } catch {}
  }
  return json;
}

export const tg = {
  sendMessage: (chat_id: number | string, text: string) => call('sendMessage', { chat_id, text }),
  sendPhoto: (chat_id: number | string, photo: string, caption?: string, reply_markup?: any) =>
    call('sendPhoto', { chat_id, photo, ...(caption ? { caption } : {}), ...(reply_markup ? { reply_markup } : {}) }),
  editCaption: (chat_id: number | string, message_id: number, caption: string, reply_markup?: any) =>
    call('editMessageCaption', { chat_id, message_id, caption, ...(reply_markup ? { reply_markup } : {}) }),
};


