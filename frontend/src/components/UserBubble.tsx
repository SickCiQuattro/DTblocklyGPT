import React from 'react';
import { Avatar } from 'antd';
import { User } from 'lucide-react';
import { formatTimeFrontend } from 'utils/date';
import dayjs from 'dayjs';

interface UserBubbleProps {
  text: string;
  timestamp: string | null;
  user: string; // username
  avatarUrl?: string;
}

export const UserBubble: React.FC<UserBubbleProps> = ({ text, timestamp, user }) => {
  const time = timestamp ? formatTimeFrontend(timestamp) : dayjs().format('HH:mm');

  return (
    <div
      style={{
        margin: '8px 0',
        maxWidth: '85%',
        alignSelf: 'flex-end',
        background: 'rgba(79, 70, 229, 0.08)',
        border: '1px solid rgba(79, 70, 229, 0.15)',
        borderRadius: '16px 16px 4px 16px',
        padding: '12px 16px',
        boxShadow: '0 2px 8px rgba(79, 70, 229, 0.04)',
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Avatar
              icon={<User size={16} style={{ color: '#4f46e5' }} />}
              size={24}
              style={{ background: 'rgba(79, 70, 229, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            />
            <span style={{ fontWeight: 600, fontSize: '13px', color: '#1e1b4b' }}>{user}</span>
          </div>
          <span style={{ fontSize: '11px', color: '#6366f1', opacity: 0.8 }}>{time}</span>
        </div>
        <div style={{ fontSize: '14px', color: '#312e81', lineHeight: '1.5', wordBreak: 'break-word', maxInlineSize: '65ch' }}>
          {text}
        </div>
      </div>
    </div>
  );
};