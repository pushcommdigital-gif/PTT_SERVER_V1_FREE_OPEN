/*
 * PushComm Community Edition
 * Copyright (C) 2026 PushComm Digital
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { useState, useEffect, useRef } from 'react';
import { Send, User, Users, Radio, Phone, Video, MoreVertical, Paperclip, Image, Mic, Square } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { useMessages } from '../../hooks/useMessages';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch, apiUpload } from '../../lib/api';
import type { ConversationItemData } from './ConversationItem';

interface MessageThreadProps {
  conversation: ConversationItemData;
}

function ConversationIcon({ type }: { type: ConversationItemData['type'] }) {
  if (type === 'group') return <Users size={14} className="text-accent" />;
  if (type === 'broadcast') return <Radio size={14} className="text-accent" />;
  return <User size={14} className="text-accent" />;
}

const MAX_RECORD_SEC = 30;

export function MessageThread({ conversation }: MessageThreadProps) {
  const { user } = useAuth();
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const queryParams = {
    page: 1,
    limit: 100,
    type: conversation.type,
    ...(conversation.type === 'direct' ? { targetUserId: conversation.id } : {}),
    ...(conversation.type === 'group' ? { targetGroupId: conversation.id } : {}),
  };

  const { messages, loading, error } = useMessages(queryParams);
  const sortedMessages = [...messages].reverse();

  useEffect(() => {
    const body =
      conversation.type === 'broadcast'
        ? null
        : JSON.stringify({
            type: conversation.type,
            targetUserId: conversation.type === 'direct' ? conversation.id : undefined,
            targetGroupId: conversation.type === 'group' ? conversation.id : undefined,
          });

    const url =
      conversation.type === 'broadcast'
        ? `/messages/${conversation.id}/read`
        : '/messages/mark-read';

    apiFetch(url, {
      method: 'PATCH',
      ...(body ? { body } : {}),
    }).catch(() => {
      // Opening the thread should never be blocked by a read-state update.
    });
  }, [conversation.id, conversation.type]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      await apiFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({
          type: conversation.type,
          targetUserId: conversation.type === 'direct' ? conversation.id : undefined,
          targetGroupId: conversation.type === 'group' ? conversation.id : undefined,
          body: newMessage.trim(),
        }),
      });
      setNewMessage('');
    } catch {
      // Error handled by apiFetch
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const stopRecording = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    setRecordSec(0);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert('Microphone access denied');
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    const mr = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (blob.size < 1000) return; // ignore too-short clips
      setSending(true);
      try {
        const formData = new FormData();
        formData.append('type', conversation.type);
        if (conversation.type === 'direct') formData.append('targetUserId', conversation.id);
        if (conversation.type === 'group') formData.append('targetGroupId', conversation.id);
        formData.append('file', blob, `voice.${mimeType.split('/')[1]}`);
        await apiUpload('/messages/audio', formData);
      } catch {
        // handled by apiUpload
      } finally {
        setSending(false);
      }
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setIsRecording(true);
    setRecordSec(0);

    // Auto-stop at MAX_RECORD_SEC
    recordTimerRef.current = setInterval(() => {
      setRecordSec((s) => {
        const next = s + 1;
        if (next >= MAX_RECORD_SEC) stopRecording();
        return next;
      });
    }, 1000);
  };

  const uploadImage = async (file: File) => {
    if (sending) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    setSending(true);
    try {
      const formData = new FormData();
      formData.append('type', conversation.type);
      if (conversation.type === 'direct') formData.append('targetUserId', conversation.id);
      if (conversation.type === 'group') formData.append('targetGroupId', conversation.id);
      formData.append('file', file, file.name || 'image.jpg');
      await apiUpload('/messages/attachment', formData);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setSending(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-border/80 flex items-center gap-2 bg-bg-primary/30">
        <div className="w-8 h-8 rounded-full bg-bg-secondary border border-border flex items-center justify-center">
          <ConversationIcon type={conversation.type} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{conversation.name}</p>
          <p className="text-xs text-text-secondary capitalize">{conversation.type} conversation</p>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-md text-text-secondary hover:text-white hover:bg-white/10 cursor-pointer" title="Voice Call">
            <Phone size={14} />
          </button>
          <button className="p-1.5 rounded-md text-text-secondary hover:text-white hover:bg-white/10 cursor-pointer" title="Video Call">
            <Video size={14} />
          </button>
          <button className="p-1.5 rounded-md text-text-secondary hover:text-white hover:bg-white/10 cursor-pointer" title="More">
            <MoreVertical size={14} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-900/60 border-b border-red-700/60 text-xs text-red-300 font-mono break-all">
          Error loading messages: {error}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 min-h-0 slim-scroll">
        {loading && messages.length === 0 ? (
          <div className="flex justify-center py-8">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedMessages.length === 0 ? (
          <p className="text-center text-xs text-text-secondary/50 py-8">
            No messages yet. Start the conversation!
          </p>
        ) : (
          sortedMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isSent={msg.senderId === user?.id}
              showSender={conversation.type === 'group'}
            />
          ))
        )}
      </div>

      <div className="border-t border-border/80 p-3 bg-bg-primary/30">
        {isRecording ? (
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-red-400 font-mono flex-1">
              Recording {recordSec}s / {MAX_RECORD_SEC}s
            </span>
            <button
              onClick={stopRecording}
              className="p-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white cursor-pointer flex items-center gap-1 text-xs"
              title="Stop Recording"
            >
              <Square size={12} />
              Stop
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 mb-2">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void uploadImage(file);
              }}
            />
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={sending}
              className="p-1.5 rounded-md text-text-secondary hover:text-white hover:bg-white/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Attach Image"
            >
              <Paperclip size={14} />
            </button>
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={sending}
              className="p-1.5 rounded-md text-text-secondary hover:text-white hover:bg-white/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Photo"
            >
              <Image size={14} />
            </button>
            <button
              onClick={toggleRecording}
              className="p-1.5 rounded-md text-text-secondary hover:text-accent hover:bg-accent/10 cursor-pointer"
              title="Voice Message"
            >
              <Mic size={14} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? 'Recording audio...' : 'Type a message...'}
            disabled={isRecording}
            rows={1}
            className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-text-secondary/40 focus:outline-none focus:ring-1 focus:ring-accent resize-none max-h-28 disabled:opacity-40"
          />
          <button
            onClick={handleSend}
            disabled={!newMessage.trim() || sending || isRecording}
            className="p-2 rounded-lg bg-accent hover:bg-accent-hover text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title="Send"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
