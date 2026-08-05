import { User, Users, Radio, Paperclip, Mic } from 'lucide-react';

export interface ConversationItemData {
  id: string;
  name: string;
  type: 'direct' | 'group' | 'broadcast';
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  lastSenderName?: string;
  subtitle?: string;
}

interface ConversationItemProps {
  conversation: ConversationItemData;
  selected: boolean;
  onSelect: (conv: ConversationItemData) => void;
}

function timeAgo(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then) || then <= 0) return '';
  const now = Date.now();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const TypeIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'direct': return <User size={10} />;
    case 'group': return <Users size={10} />;
    case 'broadcast': return <Radio size={10} />;
    default: return <User size={10} />;
  }
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (!parts.length) return '?';
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function hasAttachmentPreview(text: string): boolean {
  return /\b(file|attachment|pdf|doc|image|photo|video)\b/i.test(text);
}

function hasVoicePreview(text: string): boolean {
  return /\b(voice|audio)\b/i.test(text);
}

export function ConversationItem({ conversation, selected, onSelect }: ConversationItemProps) {
  const avatarText = conversation.type === 'group' ? <TypeIcon type={conversation.type} /> : initials(conversation.name);
  const previewHasAttachment = hasAttachmentPreview(conversation.lastMessage);
  const previewHasVoice = hasVoicePreview(conversation.lastMessage);

  return (
    <button
      onClick={() => onSelect(conversation)}
      className={`w-full text-left px-3 py-2 rounded-lg transition-colors cursor-pointer border ${
        selected
          ? 'bg-accent/12 border-accent/40'
          : 'hover:bg-white/5 border-border/60'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 w-10 h-10 rounded-full border border-border/70 flex items-center justify-center text-sm font-semibold ${selected ? 'bg-accent/20 text-accent border-accent/50' : 'bg-bg-secondary text-text-secondary'}`}>
          {avatarText}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium truncate">{conversation.name}</span>
            {timeAgo(conversation.lastMessageAt) && (
              <span className="text-[10px] text-text-secondary/60 shrink-0 ml-1">
                {timeAgo(conversation.lastMessageAt)}
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary/70 truncate mt-0.5 flex items-center gap-1.5">
            {previewHasAttachment && <Paperclip size={12} className="shrink-0" />}
            {!previewHasAttachment && previewHasVoice && <Mic size={12} className="shrink-0" />}
            {conversation.subtitle
              ? conversation.subtitle
              : `${conversation.type === 'group' && conversation.lastSenderName ? `${conversation.lastSenderName}: ` : ''}${conversation.lastMessage}`}
          </p>
        </div>

        {conversation.unreadCount > 0 && (
          <span className="mt-0.5 bg-accent text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {conversation.unreadCount}
          </span>
        )}
      </div>
    </button>
  );
}
