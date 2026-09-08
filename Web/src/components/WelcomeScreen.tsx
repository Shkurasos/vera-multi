import React from 'react';
import { Box, Typography } from '@mui/material';
import { useChatStore } from '../store/chatStore';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';

export default function WelcomeScreen() {
  const { chats, setActiveChat } = useChatStore();
  const { theme } = useThemeStore();
  const navigate = useNavigate();

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: theme.bg,
      gap: 1.5,
    }}>
      {/* Иконка */}
      <Box sx={{
        width: 72, height: 72, borderRadius: '50%',
        bgcolor: theme.bgHeader,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        mb: 1,
      }}>
        <Typography sx={{ fontSize: 36 }}>💬</Typography>
      </Box>

      <Typography sx={{ fontSize: 20, fontWeight: 700, color: theme.text }}>
        Vera
      </Typography>
      <Typography sx={{ fontSize: 13, color: theme.textSec, textAlign: 'center', maxWidth: 280 }}>
        Выберите чат, чтобы начать общение
      </Typography>

      {/* Быстрый доступ к чатам */}
      {chats.length > 0 && (
        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0.5, width: '100%', maxWidth: 260 }}>
          {chats.slice(0, 3).map((chat) => (
            <Box
              key={chat.id}
              onClick={() => { setActiveChat(chat); navigate(`/chat/${chat.id}`); }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5,
                px: 2, py: 1, borderRadius: 2,
                bgcolor: theme.bgHeader, 
                border: `1px solid ${theme.border}`,
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': { 
                  bgcolor: theme.bgHover,
                  borderColor: theme.accent + '40',
                },
              }}
            >
              <Box sx={{
                width: 32, height: 32, borderRadius: '50%',
                bgcolor: theme.accent + '30',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, color: theme.text, fontWeight: 600, flexShrink: 0,
              }}>
                {(chat.name || '?')[0].toUpperCase()}
              </Box>
              <Typography sx={{ fontSize: 13, color: theme.text }} noWrap>
                {chat.name || 'Чат'}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
