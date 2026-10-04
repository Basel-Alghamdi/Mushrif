import { firstName } from "../../lib/format";

/** Title-only starters; uploading stays on the composer's paperclip. */
const SUGGESTIONS = [
  { title: "وضع الفريق الآن", prompt: "أعطيني ملخص وضع الفريق الآن بالأرقام" },
  { title: "من لم تفعّل حسابها؟", prompt: "من المشرفات اللواتي لم يفعّلن حساباتهن بعد؟" },
  { title: "من ملفها ناقص؟", prompt: "من ملفها ناقص؟ وما الذي ينقص كل واحدة؟" },
  { title: "جهّزي رسالة تذكير", prompt: "جهّزي رسالة تذكير للمشرفات اللواتي لم يكملن ملفاتهن" },
];

type Props = { name: string; onPrompt: (text: string) => void; disabled: boolean };

export function ChatEmptyState({ name, onPrompt, disabled }: Props) {
  return (
    <div className="chat-empty">
      <h1>مرحباً {firstName(name)}</h1>
      <p>أقرأ كل ما أرسلته المشرفات، وأعبّئ بياناتهن من أي ملف ترفعينه.</p>
      <div className="chat-suggestions">
        {SUGGESTIONS.map(item => (
          <button key={item.title} className="chip chat-suggestion" disabled={disabled} onClick={() => onPrompt(item.prompt)}>{item.title}</button>
        ))}
      </div>
    </div>
  );
}
