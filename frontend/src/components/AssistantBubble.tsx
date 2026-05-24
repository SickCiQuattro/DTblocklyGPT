import React from 'react';
import { Avatar } from 'antd';
import { Bot } from 'lucide-react';
import { formatTimeFrontend } from 'utils/date';
import dayjs from 'dayjs';

interface AssistantBubbleProps {
  text: string;
  timestamp: string | null;
  avatarUrl?: string;
}

export const AssistantBubble: React.FC<AssistantBubbleProps> = ({ text, timestamp }) => {
  const time = timestamp ? formatTimeFrontend(timestamp) : dayjs().format('HH:mm');

  return (
    <div
      style={{
        margin: '8px 0',
        maxWidth: '85%',
        alignSelf: 'flex-start',
        background: 'rgba(16, 185, 129, 0.08)',
        border: '1px solid rgba(16, 185, 129, 0.15)',
        borderRadius: '16px 16px 16px 4px',
        padding: '12px 16px',
        boxShadow: '0 2px 8px rgba(16, 185, 129, 0.04)',
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Avatar
              icon={<Bot size={16} style={{ color: '#10b981' }} />}
              size={24}
              style={{ background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            />
            <span style={{ fontWeight: 600, fontSize: '13px', color: '#064e3b' }}>Robot</span>
          </div>
          <span style={{ fontSize: '11px', color: '#10b981', opacity: 0.8 }}>{time}</span>
        </div>
        <div style={{ fontSize: '14px', color: '#064e3b', lineHeight: '1.5', wordBreak: 'break-word', maxInlineSize: '65ch' }}>
          {text}
        </div>
      </div>
    </div>
  );
};